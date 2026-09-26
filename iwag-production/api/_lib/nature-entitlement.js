const crypto = require('crypto');

const PREMIUM_MEDIA = Object.freeze({
  'gentle-rain/gentle-rain-01.mp3': 'Gentle Rain',
  'mountain-river/mountain-river-01.mp3': 'Mountain River',
  'forest-birds/forest-birds-01.mp3': 'Forest Birds',
  'wind-through-trees/wind-through-trees-01.mp3': 'Wind Through Trees',
  'wind-through-trees/wind-through-trees-02.mp3': 'Wind Through Trees',
  'gentle-thunderstorm/gentle-thunderstorm-01.mp3': 'Gentle Thunderstorm',
  'fireplace-rain/fireplace-rain-01.mp3': 'Fireplace & Rain',
  'meadow-breeze/meadow-breeze-01.mp3': 'Meadow Breeze',
  'waterfall/waterfall-01.mp3': 'Waterfall',
  'summer-night-forest/summer-night-forest-01.mp3': 'Summer Night Forest'
});

const ALLOWED_DURATIONS = new Set([10, 20, 30]);
const TOKEN_VERSION = 1;
const TOKEN_GRACE_SECONDS = 5 * 60;

function normalizeMedia(value) {
  if (typeof value !== 'string') return null;
  const prefix = '/Content/nature/';
  const media = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return Object.prototype.hasOwnProperty.call(PREMIUM_MEDIA, media) ? media : null;
}

function subscriptionPeriodEnd(subscription, priceId) {
  const matchingEnds = (subscription?.items?.data || [])
    .filter(item => item?.price?.id === priceId)
    .map(item => Number(item.current_period_end || 0))
    .filter(Number.isFinite);
  if (matchingEnds.length) return Math.max(...matchingEnds);
  const legacyEnd = Number(subscription?.current_period_end || 0);
  return Number.isFinite(legacyEnd) ? legacyEnd : 0;
}

function assessSubscription(subscription, priceIds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (subscription?.status !== 'active') return null;
  const matchedItem = (subscription.items?.data || []).find(item => {
    const priceId = item?.price?.id;
    return priceId === priceIds.annual || priceId === priceIds.monthly;
  });
  if (!matchedItem) return null;
  const priceId = matchedItem.price.id;
  const periodEnd = subscriptionPeriodEnd(subscription, priceId);
  if (!periodEnd || periodEnd <= nowSeconds) return null;
  return {
    plan: priceId === priceIds.annual ? 'annual' : 'divine',
    periodEnd,
    subscriptionId: subscription.id
  };
}

function chooseEntitlement(subscriptions, priceIds, nowSeconds = Math.floor(Date.now() / 1000)) {
  return subscriptions
    .map(subscription => assessSubscription(subscription, priceIds, nowSeconds))
    .filter(Boolean)
    .sort((a, b) => b.periodEnd - a.periodEnd)[0] || null;
}

async function loadProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,stripe_customer_id,stripe_subscription_id')
    .eq('id', userId)
    .limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null;
  return data[0];
}

function sameEmail(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    left.trim().toLowerCase() === right.trim().toLowerCase();
}

function subscriptionMatchesUser(subscription, profileId, userEmail, trustedCustomerIds) {
  const customerId = typeof subscription?.customer === 'string'
    ? subscription.customer
    : subscription?.customer?.id;
  return subscription?.metadata?.userId === profileId ||
    sameEmail(subscription?.metadata?.email, userEmail) ||
    (customerId && trustedCustomerIds.has(customerId));
}

async function collectVerifiedSubscriptions(stripe, profile, userEmail) {
  const subscriptions = new Map();
  const trustedCustomerIds = new Set();

  if (userEmail) {
    for await (const customer of stripe.customers.list({ email: userEmail, limit: 100 })) {
      if (sameEmail(customer.email, userEmail)) trustedCustomerIds.add(customer.id);
    }
  }

  if (profile.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
      if (customer && !customer.deleted &&
          (sameEmail(customer.email, userEmail) || customer.metadata?.userId === profile.id)) {
        trustedCustomerIds.add(customer.id);
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }

  if (profile.stripe_subscription_id) {
    try {
      const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      if (subscriptionMatchesUser(subscription, profile.id, userEmail, trustedCustomerIds)) {
        subscriptions.set(subscription.id, subscription);
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }

  for (const customerId of trustedCustomerIds) {
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

async function verifiedEntitlement({ stripe, supabase, user, priceIds, nowSeconds }) {
  const profile = await loadProfile(supabase, user.id);
  if (!profile) return null;
  const subscriptions = await collectVerifiedSubscriptions(stripe, profile, user.email);
  return chooseEntitlement(subscriptions, priceIds, nowSeconds);
}

function signingKey(secret) {
  if (!secret) throw new Error('Nature audio signing secret is unavailable');
  return crypto.createHmac('sha256', secret).update('iwag:nature-audio:v1').digest();
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', signingKey(secret)).update(encodedPayload).digest('base64url');
}

function issuePlaybackToken({ userId, media, durationMinutes, periodEnd, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const normalizedMedia = normalizeMedia(media);
  const duration = Number(durationMinutes);
  if (!normalizedMedia || !ALLOWED_DURATIONS.has(duration)) {
    throw new Error('Invalid Nature Sounds playback request');
  }
  const requestedExpiry = nowSeconds + (duration * 60) + TOKEN_GRACE_SECONDS;
  const expiry = Math.min(requestedExpiry, Number(periodEnd || 0));
  if (expiry <= nowSeconds) throw new Error('Paid-through period has expired');
  const encodedPayload = Buffer.from(JSON.stringify({
    v: TOKEN_VERSION,
    sub: userId,
    media: normalizedMedia,
    exp: expiry
  })).toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

function verifyPlaybackToken({ token, media, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const normalizedMedia = normalizeMedia(media);
  if (!normalizedMedia || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.v !== TOKEN_VERSION || payload.media !== normalizedMedia) return null;
    if (!payload.sub || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  ALLOWED_DURATIONS,
  PREMIUM_MEDIA,
  assessSubscription,
  chooseEntitlement,
  issuePlaybackToken,
  normalizeMedia,
  subscriptionMatchesUser,
  verifiedEntitlement,
  verifyPlaybackToken
};
