const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  assessSubscription,
  issuePlaybackToken,
  normalizeMedia,
  subscriptionMatchesStoredProfile,
  subscriptionMatchesUser,
  verifiedEntitlement,
  verifyPlaybackToken
} = require('../api/_lib/nature-entitlement');
const { parseRange } = require('../api/nature-audio');
const natureAudioHandler = require('../api/nature-audio');
const natureAccessHandler = require('../api/nature-access');

const NOW = 2_000_000_000;
const PRICE_IDS = { monthly: 'price_monthly', annual: 'price_annual' };

function subscription(overrides = {}) {
  return {
    id: 'sub_test',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: 'price_monthly' }, current_period_end: NOW + 3600 }]
    },
    ...overrides
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

test('only known premium Nature Sounds paths normalize', () => {
  assert.equal(normalizeMedia('/Content/nature/gentle-rain/gentle-rain-01.mp3'), 'gentle-rain/gentle-rain-01.mp3');
  assert.equal(normalizeMedia('/Content/nature/ocean-waves/ocean-waves-01.mp3'), null);
  assert.equal(normalizeMedia('../../secret'), null);
});

test('active Divine and Annual subscriptions with paid time remaining are entitled', () => {
  assert.equal(assessSubscription(subscription(), PRICE_IDS, NOW).plan, 'divine');
  const annual = subscription({
    items: { data: [{ price: { id: 'price_annual' }, current_period_end: NOW + 3600 }] }
  });
  assert.equal(assessSubscription(annual, PRICE_IDS, NOW).plan, 'annual');
});

test('cancellation at period end retains access until the paid-through time', () => {
  const cancelling = subscription({ cancel_at_period_end: true });
  assert.ok(assessSubscription(cancelling, PRICE_IDS, NOW));
  assert.equal(assessSubscription(cancelling, PRICE_IDS, NOW + 3601), null);
});

test('free, trialing, expired, past-due, unpaid and canceled states are denied', () => {
  for (const status of ['trialing', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired']) {
    assert.equal(assessSubscription(subscription({ status }), PRICE_IDS, NOW), null, status);
  }
  assert.equal(assessSubscription(subscription({
    items: { data: [{ price: { id: 'price_monthly' }, current_period_end: NOW - 1 }] }
  }), PRICE_IDS, NOW), null);
  assert.equal(assessSubscription(subscription({
    items: { data: [{ price: { id: 'price_free' }, current_period_end: NOW + 3600 }] }
  }), PRICE_IDS, NOW), null);
});

test('stored Stripe IDs cannot grant another user access', () => {
  const candidate = subscription({
    customer: 'cus_other',
    metadata: { userId: 'user-other', email: 'other@example.com' }
  });
  assert.equal(subscriptionMatchesUser(candidate, 'user-1', 'one@example.com', new Set()), false);
  assert.equal(subscriptionMatchesUser(
    { ...candidate, metadata: { userId: 'user-1' } },
    'user-1',
    'one@example.com',
    new Set()
  ), true);
  assert.equal(subscriptionMatchesUser(candidate, 'user-1', 'one@example.com', new Set(['cus_other'])), true);
});

test('production-shaped Annual profile resolves through its verified Stripe pair', async () => {
  const productionProfile = {
    id: '040fe874-8bfd-46f2-9433-e1e7a52ce8a3',
    email: 'eustockbytes@gmail.com',
    plan: 'annual',
    stripe_customer_id: 'cus_production_annual',
    stripe_subscription_id: 'sub_production_annual',
    subscription_status: 'active',
    subscription_current_period_end: null
  };
  const annualSubscription = subscription({
    id: 'sub_production_annual',
    customer: 'cus_production_annual',
    metadata: {},
    items: {
      data: [{ price: { id: 'price_annual' }, current_period_end: NOW + 86400 }]
    }
  });
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        limit: async () => ({ data: [productionProfile], error: null })
      };
    }
  };
  const stripe = {
    customers: {
      list: async function* () {},
      retrieve: async () => ({ id: 'cus_production_annual', email: null, metadata: {} })
    },
    subscriptions: {
      retrieve: async () => annualSubscription,
      list: async function* () {}
    }
  };

  assert.equal(subscriptionMatchesStoredProfile(annualSubscription, productionProfile), true);
  assert.equal(subscriptionMatchesStoredProfile(
    { ...annualSubscription, customer: 'cus_someone_else' },
    productionProfile
  ), false);
  assert.equal(subscriptionMatchesStoredProfile(
    { ...annualSubscription, id: 'sub_someone_else' },
    productionProfile
  ), false);
  const entitlement = await verifiedEntitlement({
    stripe,
    supabase,
    user: { id: productionProfile.id, email: productionProfile.email },
    priceIds: PRICE_IDS,
    nowSeconds: NOW
  });
  assert.deepEqual(entitlement, {
    plan: 'annual',
    periodEnd: NOW + 86400,
    subscriptionId: 'sub_production_annual'
  });
});

test('playback tokens are track-bound, expire, and reject tampering', () => {
  const token = issuePlaybackToken({
    userId: 'user-1',
    media: 'gentle-rain/gentle-rain-01.mp3',
    durationMinutes: 30,
    periodEnd: NOW + 3600,
    secret: 'test-secret',
    nowSeconds: NOW
  });
  assert.ok(verifyPlaybackToken({
    token,
    media: 'gentle-rain/gentle-rain-01.mp3',
    secret: 'test-secret',
    nowSeconds: NOW
  }));
  assert.equal(verifyPlaybackToken({
    token,
    media: 'waterfall/waterfall-01.mp3',
    secret: 'test-secret',
    nowSeconds: NOW
  }), null);
  assert.equal(verifyPlaybackToken({
    token: `${token}x`,
    media: 'gentle-rain/gentle-rain-01.mp3',
    secret: 'test-secret',
    nowSeconds: NOW
  }), null);
  assert.equal(verifyPlaybackToken({
    token,
    media: 'gentle-rain/gentle-rain-01.mp3',
    secret: 'test-secret',
    nowSeconds: NOW + 3601
  }), null);
});

test('audio ranges stay below the Vercel response limit', () => {
  assert.deepEqual(parseRange('bytes=0-', 10_000_000), { start: 0, end: 4_194_303 });
  assert.deepEqual(parseRange('bytes=5000000-9999999', 10_000_000), { start: 5_000_000, end: 9_194_303 });
  assert.equal(parseRange('bytes=10000000-', 10_000_000), null);
});

test('logged-out API and direct premium media requests fail closed', async () => {
  const accessResponse = mockResponse();
  await natureAccessHandler({ method: 'GET', headers: {} }, accessResponse);
  assert.equal(accessResponse.statusCode, 401);
  assert.match(accessResponse.headers['cache-control'], /no-store/);

  const mediaResponse = mockResponse();
  natureAudioHandler({
    method: 'GET',
    headers: { range: 'bytes=0-1023' },
    query: { media: 'gentle-rain/gentle-rain-01.mp3' }
  }, mediaResponse);
  assert.equal(mediaResponse.statusCode, 401);
  assert.match(mediaResponse.headers['cache-control'], /no-store/);
});

test('catalog markup exposes one free card and locks all nine premium cards', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal((html.match(/data-nature-free="true"/g) || []).length, 1);
  assert.equal((html.match(/data-nature-premium="true"/g) || []).length, 9);
  assert.match(html, /id="nature-ocean-waves" data-nature-free="true"/);

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, source] of inlineScripts) new vm.Script(source);
});

test('routing and service worker protect every premium folder but not Ocean Waves', () => {
  const root = path.resolve(__dirname, '..');
  const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  const vercelConfig = JSON.parse(vercel);
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const folders = [
    'gentle-rain', 'mountain-river', 'forest-birds', 'wind-through-trees',
    'gentle-thunderstorm', 'fireplace-rain', 'meadow-breeze', 'waterfall',
    'summer-night-forest'
  ];
  for (const folder of folders) {
    assert.ok(vercel.includes(folder), `Vercel route missing ${folder}`);
    assert.ok(worker.includes(`/Content/nature/${folder}/`), `service worker rule missing ${folder}`);
  }
  const protectedRoute = vercelConfig.routes[0].src;
  assert.equal(protectedRoute.includes('ocean-waves'), false);
  const staticBuilds = vercelConfig.builds
    .filter(build => build.use === '@vercel/static')
    .map(build => build.src);
  assert.equal(staticBuilds.includes('Content/**'), false);
  assert.ok(staticBuilds.includes('Content/nature/ocean-waves/**'));
  for (const folder of folders) {
    assert.equal(
      staticBuilds.some(source => source.startsWith(`Content/nature/${folder}/`)),
      false,
      `premium folder must not be emitted as a static asset: ${folder}`
    );
  }
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/nature-'\)/);
});
