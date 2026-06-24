const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buffer } = require('micro');

const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function planFromMetadataOrPrice(metadataPlan, priceId) {
  if (metadataPlan === 'annual') return 'annual';
  if (metadataPlan === 'monthly') return 'divine';
  if (priceId === process.env.STRIPE_TEST_MONTHLY_PRICE_ID) return 'divine';
  if (priceId === process.env.STRIPE_TEST_ANNUAL_PRICE_ID) return 'annual';
  return 'free';
}

async function updateProfile({ email, plan, customerId, subscriptionId, status, currentPeriodEnd }) {
  if (!email) throw new Error('No email resolved for Supabase update');

  const { data, error } = await supabase
    .from('profiles')
    .update({
      plan,
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscriptionId || null,
      subscription_status: status || null,
      subscription_current_period_end: currentPeriodEnd || null
    })
    .eq('email', email)
    .select();

  console.log('IWAG TEST SUPABASE UPDATE:', {
    email,
    plan,
    rowsUpdated: data?.length || 0,
    data,
    error
  });

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`No Supabase profile matched email: ${email}`);
  }
}

async function updateProfileFromSubscription(subscription, fallbackEmail = null, fallbackPlan = null) {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;

  const customer =
    subscription.customer
      ? await stripe.customers.retrieve(subscription.customer)
      : null;

  const metadataPlan =
    subscription.metadata?.plan ||
    fallbackPlan ||
    null;

  const plan =
    subscription.status === 'active' || subscription.status === 'trialing'
      ? planFromMetadataOrPrice(metadataPlan, priceId)
      : 'free';

  const email =
    customer?.email ||
    fallbackEmail ||
    subscription.metadata?.email ||
    null;

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  console.log('IWAG TEST SUBSCRIPTION TRACE:', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    customerEmail: customer?.email,
    fallbackEmail,
    resolvedEmail: email,
    metadataPlan,
    priceId,
    status: subscription.status,
    resolvedPlan: plan
  });

  await updateProfile({
    email,
    plan,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  console.log('IWAG TEST WEBHOOK HIT');

  const sig = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_TEST_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('IWAG TEST SIGNATURE ERROR:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('IWAG TEST EVENT:', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('IWAG TEST CHECKOUT SESSION:', {
        id: session.id,
        customer: session.customer,
        subscription: session.subscription,
        customer_email: session.customer_email,
        customer_details_email: session.customer_details?.email,
        metadata: session.metadata
      });

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.metadata?.email ||
        null;

      const metadataPlan = session.metadata?.plan || null;
      const plan = planFromMetadataOrPrice(metadataPlan, session.metadata?.price_id);

      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await updateProfileFromSubscription(subscription, email, metadataPlan);
      } else {
        await updateProfile({
          email,
          plan,
          customerId: session.customer,
          subscriptionId: null,
          status: 'paid',
          currentPeriodEnd: null
        });
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await updateProfileFromSubscription(event.data.object);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('IWAG TEST WEBHOOK FAILED:', err.message);
    return res.status(500).send(err.message);
  }
};
