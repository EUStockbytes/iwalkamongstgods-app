const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function planFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID) return 'divine';
  if (priceId === process.env.STRIPE_ANNUAL_PRICE_ID) return 'annual';
  return 'free';
}

async function updateProfileFromSubscription(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = status === 'active' || status === 'trialing'
    ? planFromPriceId(priceId)
    : 'free';

  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;

  if (!email) {
    console.warn('Stripe customer has no email', customerId);
    return;
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('profiles')
    .update({
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      subscription_current_period_end: currentPeriodEnd
    })
    .eq('email', email);

  if (error) {
    console.error('Supabase profile update failed:', error);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await updateProfileFromSubscription(event.data.object);
        break;

      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await updateProfileFromSubscription(subscription);
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler failed:', err);
    return res.status(500).send('Webhook handler failed');
  }
};
