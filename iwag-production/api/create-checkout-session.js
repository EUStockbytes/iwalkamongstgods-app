const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function pickPrice(plan) {
  const price = plan === 'annual'
    ? process.env.STRIPE_ANNUAL_PRICE_ID
    : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!price || !price.startsWith('price_')) {
    throw new Error(`Invalid live Stripe price ID for ${plan}. Got: ${price ? price.slice(0, 8) : 'missing'}`);
  }

  return price;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, email, userId } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Missing email' });

    const price = pickPrice(plan);

    console.log('IWAG LIVE CHECKOUT START:', {
      plan,
      email,
      userId,
      price
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
    console.error('IWAG LIVE CHECKOUT FAILED:', err);
    return res.status(500).json({ error: err.message });
  }
};
