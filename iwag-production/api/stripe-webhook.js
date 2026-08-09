const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buffer } = require('micro');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROFILE_FIELDS = 'id,email,plan,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end';
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function planFromSubscription(subscription) {
  if (!ENTITLED_STATUSES.has(subscription.status)) return null;

  const priceId = subscription.items?.data?.[0]?.price?.id;

  if (priceId === process.env.STRIPE_ANNUAL_PRICE_ID) return 'annual';
  if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID) return 'divine';

  throw new Error(`Active Stripe subscription ${subscription.id} has an unknown IWAG price`);
}

async function findExactlyOneProfile(column, value, caseInsensitive = false) {
  let query = supabase.from('profiles').select(PROFILE_FIELDS);
  query = caseInsensitive ? query.ilike(column, value) : query.eq(column, value);

  const { data, error } = await query.limit(2);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length !== 1) throw new Error(`Multiple Supabase profiles matched ${column}`);
  return data[0];
}

async function resolveProfile({ userId, customerId, email }) {
  if (isUuid(userId)) {
    const profile = await findExactlyOneProfile('id', userId);
    if (profile) return profile;
  }

  if (customerId) {
    const profile = await findExactlyOneProfile('stripe_customer_id', customerId);
    if (profile) return profile;
  }

  if (email) {
    const profile = await findExactlyOneProfile('email', email.trim(), true);
    if (profile) return profile;
  }

  throw new Error('No Supabase profile matched Stripe subscription identity');
}

async function retrieveCustomerEmail(customerId) {
  if (!customerId) return null;
  const customer = await stripe.customers.retrieve(customerId);
  return customer && !customer.deleted ? customer.email : null;
}

async function collectCustomerIds(profile, eventCustomerId) {
  const customerIds = new Set();
  if (eventCustomerId) customerIds.add(eventCustomerId);
  if (profile.stripe_customer_id) customerIds.add(profile.stripe_customer_id);

  if (profile.email) {
    for await (const customer of stripe.customers.list({ email: profile.email, limit: 100 })) {
      customerIds.add(customer.id);
    }
  }

  return customerIds;
}

async function collectSubscriptions(customerIds, eventSubscription) {
  const subscriptions = new Map();
  if (eventSubscription) subscriptions.set(eventSubscription.id, eventSubscription);

  for (const customerId of customerIds) {
    try {
      for await (const subscription of stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100
      })) {
        subscriptions.set(subscription.id, subscription);
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }

  return [...subscriptions.values()];
}

function chooseEntitledSubscription(subscriptions) {
  const entitled = subscriptions
    .map(subscription => ({ subscription, plan: planFromSubscription(subscription) }))
    .filter(candidate => candidate.plan)
    .sort((a, b) => {
      const planDifference = Number(b.plan === 'annual') - Number(a.plan === 'annual');
      if (planDifference !== 0) return planDifference;
      return (b.subscription.created || 0) - (a.subscription.created || 0);
    });

  return entitled[0] || null;
}

function subscriptionPeriodEnd(subscription) {
  return subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
}

async function updateProfile(profile, values) {
  const { data, error } = await supabase
    .from('profiles')
    .update(values)
    .eq('id', profile.id)
    .select('id');

  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error(`Expected one Supabase profile update for ${profile.id}; updated ${data?.length || 0}`);
  }
}

async function reconcileProfileFromSubscription(eventSubscription, fallbackIdentity = {}) {
  const eventCustomerId = typeof eventSubscription.customer === 'string'
    ? eventSubscription.customer
    : eventSubscription.customer?.id;
  const customerEmail = fallbackIdentity.email ||
    eventSubscription.metadata?.email ||
    await retrieveCustomerEmail(eventCustomerId);
  const userId = fallbackIdentity.userId || eventSubscription.metadata?.userId;

  const profile = await resolveProfile({
    userId,
    customerId: eventCustomerId,
    email: customerEmail
  });
  const customerIds = await collectCustomerIds(profile, eventCustomerId);
  const subscriptions = await collectSubscriptions(customerIds, eventSubscription);
  const entitled = chooseEntitledSubscription(subscriptions);

  if (entitled) {
    const customerId = typeof entitled.subscription.customer === 'string'
      ? entitled.subscription.customer
      : entitled.subscription.customer?.id;

    await updateProfile(profile, {
      plan: entitled.plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: entitled.subscription.id,
      subscription_status: entitled.subscription.status,
      subscription_current_period_end: subscriptionPeriodEnd(entitled.subscription)
    });
  } else {
    await updateProfile(profile, {
      plan: 'free',
      stripe_customer_id: profile.stripe_customer_id || eventCustomerId || null,
      stripe_subscription_id: null,
      subscription_status: 'inactive',
      subscription_current_period_end: null
    });
  }

  console.log('IWAG SUBSCRIPTION RECONCILED:', {
    profileId: profile.id,
    plan: entitled?.plan || 'free',
    subscriptionId: entitled?.subscription.id || null,
    checkedCustomerCount: customerIds.size
  });
}

async function handler(req, res) {
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
  } catch (error) {
    console.error('IWAG WEBHOOK SIGNATURE FAILED:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await reconcileProfileFromSubscription(event.data.object);
        break;

      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await reconcileProfileFromSubscription(subscription, {
            userId: session.client_reference_id || session.metadata?.userId,
            email: session.customer_details?.email || session.customer_email || session.metadata?.email
          });
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('IWAG WEBHOOK HANDLER FAILED:', error);
    return res.status(500).send('Webhook handler failed');
  }
}

// Vercel must leave the request stream untouched so Stripe receives the exact signed bytes.
handler.config = { api: { bodyParser: false } };
module.exports = handler;
module.exports.config = handler.config;
