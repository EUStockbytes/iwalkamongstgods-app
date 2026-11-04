const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function pickPrice(plan) {
  if (plan !== 'monthly' && plan !== 'annual') {
    throw new Error('Invalid membership plan');
  }

  const price = plan === 'annual'
    ? process.env.STRIPE_ANNUAL_PRICE_ID
    : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!price || !price.startsWith('price_')) {
    throw new Error(`Invalid live Stripe price ID for ${plan}. Got: ${price ? price.slice(0, 8) : 'missing'}`);
  }

  return price;
}

function bearerToken(req) {
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

async function authenticatedUser(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,plan,stripe_customer_id,stripe_subscription_id,subscription_status')
    .eq('id', userId)
    .limit(2);

  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error(`Expected exactly one Supabase profile for authenticated user ${userId}`);
  }
  return data[0];
}

async function findStripeCustomers(profile, userEmail) {
  const customers = new Map();

  if (profile.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
      if (customer && !customer.deleted) customers.set(customer.id, customer);
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }

  if (userEmail) {
    for await (const customer of stripe.customers.list({ email: userEmail, limit: 100 })) {
      customers.set(customer.id, customer);
    }
  }

  return [...customers.values()];
}

async function findEntitledSubscription(customers) {
  for (const customer of customers) {
    for await (const subscription of stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 100
    })) {
      if (subscription.status === 'active' || subscription.status === 'trialing') {
        return subscription;
      }
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in again before starting Checkout.' });

    const { plan } = req.body || {};
    const price = pickPrice(plan);
    const profile = await loadProfile(user.id);
    const email = profile.email || user.email;
    if (!email) return res.status(400).json({ error: 'Your IWAG account has no email address.' });

    const customers = await findStripeCustomers(profile, email);
    const activeSubscription = await findEntitledSubscription(customers);
    if (activeSubscription) {
      return res.status(409).json({
        code: 'subscription_active',
        error: 'Your IWAG membership is already active. No new subscription was created.'
      });
    }

    const existingCustomer = customers.find(customer => customer.id === profile.stripe_customer_id) || customers[0];
    const metadata = {
      email,
      userId: user.id,
      plan,
      price_id: price
    };
    const origin = req.headers.origin || 'https://project-exbia.vercel.app';
    const sessionOptions = {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      success_url: `${origin}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?checkout=cancelled`,
      metadata,
      subscription_data: { metadata }
    };

    if (existingCustomer) {
      sessionOptions.customer = existingCustomer.id;
    } else {
      sessionOptions.customer_email = email;
    }

    console.log('IWAG LIVE CHECKOUT START:', {
      plan,
      userId: user.id,
      customerId: existingCustomer?.id || null,
      price
    });

    const idempotencyWindow = Math.floor(Date.now() / (10 * 60 * 1000));
    const session = await stripe.checkout.sessions.create(sessionOptions, {
      idempotencyKey: `iwag-checkout-${user.id}-${idempotencyWindow}`
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('IWAG LIVE CHECKOUT FAILED:', error);
    return res.status(500).json({ error: error.message });
  }
};
