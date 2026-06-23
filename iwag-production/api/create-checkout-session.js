const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, email, userId } = req.body || {};

    const price =
      plan === 'annual'
        ? process.env.STRIPE_ANNUAL_PRICE_ID
        : process.env.STRIPE_MONTHLY_PRICE_ID;

    if (!price) {
      return res.status(400).json({ error: 'Missing Stripe price ID' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price, quantity: 1 }],
      success_url: 'https://project-exbia.vercel.app/?checkout=success',
      cancel_url: 'https://project-exbia.vercel.app/?checkout=cancelled',
      metadata: {
        user_id: userId || '',
        plan: plan || 'monthly'
      },
      subscription_data: {
        metadata: {
          user_id: userId || '',
          plan: plan || 'monthly'
        }
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session failed:', err);
    return res.status(500).json({ error: 'Checkout session failed' });
  }
};
