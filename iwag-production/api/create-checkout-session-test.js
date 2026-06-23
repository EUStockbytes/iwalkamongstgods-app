const Stripe = require('stripe');

function pickStripeKey() {
  const testKey = process.env.STRIPE_TEST_SECRET_KEY;
  const liveKey = process.env.STRIPE_SECRET_KEY;

  if (testKey && testKey.startsWith('sk_test_')) return testKey;
  if (liveKey && liveKey.startsWith('sk_')) return liveKey;

  throw new Error('No valid Stripe secret key found');
}

function pickPrice(plan) {
  const testMonthly = process.env.STRIPE_TEST_MONTHLY_PRICE_ID;
  const testAnnual = process.env.STRIPE_TEST_ANNUAL_PRICE_ID;
  const liveMonthly = process.env.STRIPE_MONTHLY_PRICE_ID;
  const liveAnnual = process.env.STRIPE_ANNUAL_PRICE_ID;

  const chosen =
    plan === 'annual'
      ? (testAnnual?.startsWith('price_') ? testAnnual : liveAnnual)
      : (testMonthly?.startsWith('price_') ? testMonthly : liveMonthly);

  if (!chosen || !chosen.startsWith('price_')) {
    throw new Error(`Invalid Stripe price ID for ${plan}. Got: ${chosen ? chosen.slice(0, 8) : 'missing'}`);
  }

  return chosen;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = new Stripe(pickStripeKey());
    const { plan, email, userId } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Missing email' });

    const price = pickPrice(plan);

    console.log('IWAG TEST CHECKOUT START:', {
      plan,
      email,
      userId,
      price,
      keyMode: process.env.STRIPE_TEST_SECRET_KEY?.startsWith('sk_test_') ? 'test' : 'fallback-live'
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer_email: email,
      success_url: `${req.headers.origin || 'https://project-exbia.vercel.app'}?checkout=success`,
      cancel_url: `${req.headers.origin || 'https://project-exbia.vercel.app'}?checkout=cancelled`,
      metadata: {
        email,
        userId: userId || '',
        plan: plan || 'monthly',
        price_id: price
      },
      subscription_data: {
        metadata: {
          email,
          userId: userId || '',
          plan: plan || 'monthly',
          price_id: price
        }
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('IWAG TEST CHECKOUT FAILED:', err);
    return res.status(500).json({ error: err.message });
  }
};
