const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const {
  ALLOWED_DURATIONS,
  issuePlaybackToken,
  normalizeMedia,
  verifiedEntitlement
} = require('./_lib/nature-entitlement');

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
}

function bearerToken(req) {
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

module.exports = async function handler(req, res) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Sign in is required.' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Your sign-in has expired.' });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const entitlement = await verifiedEntitlement({
      stripe,
      supabase,
      user: data.user,
      priceIds: {
        monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
        annual: process.env.STRIPE_ANNUAL_PRICE_ID
      }
    });

    if (!entitlement) {
      return res.status(403).json({
        entitled: false,
        error: 'An active Divine or Annual membership is required.'
      });
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        entitled: true,
        plan: entitlement.plan,
        paidThrough: entitlement.periodEnd
          ? new Date(entitlement.periodEnd * 1000).toISOString()
          : null
      });
    }

    const media = normalizeMedia(req.body?.media);
    const durationMinutes = Number(req.body?.durationMinutes);
    if (!media || !ALLOWED_DURATIONS.has(durationMinutes)) {
      return res.status(400).json({ error: 'Invalid Nature Sounds playback request.' });
    }

    const playbackToken = issuePlaybackToken({
      userId: data.user.id,
      media,
      durationMinutes,
      periodEnd: entitlement.periodEnd,
      secret: process.env.STRIPE_SECRET_KEY
    });

    return res.status(200).json({
      playbackUrl: `/Content/nature/${media}?token=${encodeURIComponent(playbackToken)}`
    });
  } catch (error) {
    console.error('IWAG NATURE ACCESS FAILED:', error.message);
    return res.status(500).json({ error: 'Nature Sounds access could not be verified.' });
  }
};
