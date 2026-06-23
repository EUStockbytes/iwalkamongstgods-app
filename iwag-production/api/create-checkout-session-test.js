const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const key = process.env.STRIPE_TEST_SECRET_KEY;
    const monthly = process.env.STRIPE_TEST_MONTHLY_PRICE_ID;
    const annual = process.env.STRIPE_TEST_ANNUAL_PRICE_ID;

    if (!key || !key.startsWith('sk_test_')) {
      throw new Error('STRIPE_TEST_SECRET_KEY is missing or not sk_test_');
    }

    const price = req.body?.plan === 'annual' ? annual : monthly;

    if (!price || !price.startsWith('price_')) {
      throw new Error('STRIPE_TEST price ID missing or invalid');
    }

    const stripe = new Stripe(key);
    const { plan, email, userId } = req.body || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer_email: email,
      success_url: `${req.headers.origin}?checkout=success&stripe=test`,
      cancel_url: `${req.headers.origin}?checkout=cancelled&stripe=test`,
      metadata: { email, userId: userId || '', plan, price_id: price },
      subscription_data: {
        metadata: { email, userId: userId || '', plan, price_id: price }
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('IWAG TEST CHECKOUT FAILED:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
