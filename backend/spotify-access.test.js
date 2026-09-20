const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Who may use Spotify, with which app, and how the one-time add-on is bought. spotify.test.js covers the
// OAuth/API error handling; this file covers the access model on top of it.

// spotify.js and pricing.js read the database and the environment when they load: stub both first.
process.env.SPOTIFY_CLIENT_ID = 'shared-client-id';
process.env.SPOTIFY_CLIENT_SECRET = 'shared-client-secret';
process.env.BACKEND_URL = 'https://api.test';
const dbPath = require.resolve('./db');
const dbStub = { overrides: {}, saved: [] };
dbStub.getPricingOverrides = async () => ({ ...dbStub.overrides });
dbStub.setPricingOverride = async (key, amountCents) => { const old = dbStub.overrides[key] ?? null; dbStub.overrides[key] = amountCents; dbStub.saved.push([key, amountCents]); return { oldAmountCents: old }; };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
const spotify = require('./spotify');
const pricing = require('./pricing');

const OWN_APP = { clientId: 'a'.repeat(32), clientSecret: 'b'.repeat(32) };
const SECRET_IN_TEXT = (value) => JSON.stringify(value).includes(OWN_APP.clientSecret);

// License rows as the routes and the tenant see them.
const ADMIN = { id: 'admin', license_type: 'lifetime', is_admin: true, spotify_addon: false };
const LIFETIME = { id: 'l1', license_type: 'lifetime', is_admin: false, spotify_addon: false };
const ANNUAL = { id: 'a1', license_type: 'annual', is_admin: false, spotify_addon: false };
const MONTHLY = { id: 'm1', license_type: 'month', is_admin: false, spotify_addon: false };
const MONTHLY_ADDON = { ...MONTHLY, id: 'm2', spotify_addon: true };
const TRIAL = { id: 't1', license_type: 'trial', is_admin: false, spotify_addon: false };

// The platform app admits 5 Spotify users and the owner needs none of them, so 5 Lifetime licenses hold a slot.
const SLOTS = spotify.SHARED_SLOTS_TOTAL;
const holdersOf = (count) => Array.from({ length: count }, (_, index) => `l${index + 1}`);
const BEYOND_SLOTS = { ...LIFETIME, id: `l${SLOTS + 1}` }; // the first Lifetime that does not fit

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

function recordFetch(status = 200, body = '{"access_token":"t","expires_in":3600}') {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) };
  };
  return calls;
}
const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

// ── Who may use Spotify ──────────────────────────────────
test('Lifetime, Annual, the admin license and a Monthly with the add-on can use Spotify; nobody else', () => {
  for (const license of [ADMIN, LIFETIME, ANNUAL, MONTHLY_ADDON]) assert.equal(spotify.isLicenseAllowed(license), true, license.id);
  for (const license of [MONTHLY, TRIAL, { license_type: 'day' }, { license_type: 'week' }, undefined, null]) {
    assert.equal(spotify.isLicenseAllowed(license), false, JSON.stringify(license));
  }
  assert.equal(spotify.isLicenseAllowed({ license_type: 'month', is_admin: true }), true); // the owner's license is never locked out
});

test('the first five Lifetime licenses get the platform app; the rest, Annual and Monthly-with-add-on need their own', () => {
  assert.equal(SLOTS, 5);
  const holders = holdersOf(SLOTS);
  const access = (license, extra = {}) => spotify.evaluateAccess({ license, sharedSlotHolderIds: holders, ...extra });

  assert.deepEqual(
    { ...access(LIFETIME) },
    { entitled: true, reason: 'lifetime', source: 'shared', needsOwnApp: false, addonRequired: false, holdsSharedSlot: true },
  );
  assert.equal(access({ ...LIFETIME, id: `l${SLOTS}` }).source, 'shared'); // the last slot still fits
  assert.equal(access(BEYOND_SLOTS).source, null);
  assert.equal(access(BEYOND_SLOTS).needsOwnApp, true);
  assert.equal(access(BEYOND_SLOTS).holdsSharedSlot, false);

  assert.equal(access(ANNUAL).source, null);
  assert.equal(access(ANNUAL).needsOwnApp, true);
  assert.equal(access(ANNUAL).reason, 'annual');
  assert.equal(access(MONTHLY_ADDON).needsOwnApp, true);
  assert.equal(access(MONTHLY_ADDON).reason, 'addon');

  // The admin license always uses the platform app and consumes no slot.
  assert.equal(access(ADMIN).source, 'shared');
  assert.equal(access(ADMIN).reason, 'admin');
});

test('an own app takes priority over a slot and unlocks a license that had nothing to connect with', () => {
  const holders = ['l1'];
  assert.equal(spotify.evaluateAccess({ license: LIFETIME, hasOwnApp: true, sharedSlotHolderIds: holders }).source, 'own');
  const annualWithApp = spotify.evaluateAccess({ license: ANNUAL, hasOwnApp: true, sharedSlotHolderIds: holders });
  assert.equal(annualWithApp.source, 'own');
  assert.equal(annualWithApp.needsOwnApp, false);
});

test('Monthly without the add-on may buy it; trial, day and week have no path to Spotify', () => {
  const monthly = spotify.evaluateAccess({ license: MONTHLY });
  assert.deepEqual({ ...monthly }, { entitled: false, reason: 'addon_required', source: null, needsOwnApp: false, addonRequired: true, holdsSharedSlot: false });
  for (const license of [TRIAL, { id: 'd', license_type: 'day' }, { id: 'w', license_type: 'week' }]) {
    const result = spotify.evaluateAccess({ license });
    assert.equal(result.entitled, false);
    assert.equal(result.addonRequired, false);
    assert.equal(result.reason, 'plan_not_eligible');
  }
});

test('the add-on can only be bought by a Monthly (alone, or together with a Monthly purchase), and only once', () => {
  assert.equal(spotify.addonPurchaseError(MONTHLY, undefined), null);
  assert.equal(spotify.addonPurchaseError(MONTHLY, 'month'), null);            // renewal + add-on in one payment
  assert.equal(spotify.addonPurchaseError(TRIAL, 'month'), null);              // a trial upgrading to Monthly with the add-on
  assert.equal(spotify.addonPurchaseError(TRIAL, undefined), 'El complemento de Spotify es para el plan Mensual.');
  assert.equal(spotify.addonPurchaseError(TRIAL, 'annual'), 'Tu plan ya incluye Spotify.');
  assert.equal(spotify.addonPurchaseError(MONTHLY, 'lifetime'), 'Tu plan ya incluye Spotify.');
  assert.equal(spotify.addonPurchaseError(ANNUAL, undefined), 'Tu plan ya incluye Spotify.');
  assert.equal(spotify.addonPurchaseError(LIFETIME, undefined), 'Tu plan ya incluye Spotify.');
  assert.equal(spotify.addonPurchaseError(MONTHLY_ADDON, undefined), 'Ya tienes el complemento de Spotify.');
  assert.equal(spotify.addonPurchaseError(ADMIN, undefined), 'Tu licencia ya incluye Spotify.');
  assert.equal(spotify.addonPurchaseError(null, undefined), 'Licencia inválida');
});

// ── The streamer's own Spotify app ───────────────────────
test('parseAppCredentials trims pasted values and rejects anything that is not an id/secret', () => {
  assert.deepEqual(spotify.parseAppCredentials({ clientId: `  ${OWN_APP.clientId}\n`, clientSecret: ` ${OWN_APP.clientSecret} ` }), OWN_APP);
  for (const body of [
    undefined, {}, { clientId: OWN_APP.clientId }, { clientSecret: OWN_APP.clientSecret },
    { clientId: 'corto', clientSecret: OWN_APP.clientSecret },
    { clientId: OWN_APP.clientId, clientSecret: 'con espacios adentro de la cadena que no debe pasar' },
    { clientId: `${OWN_APP.clientId}'; DROP TABLE licenses;--`, clientSecret: OWN_APP.clientSecret },
    { clientId: 12345678901234567890, clientSecret: OWN_APP.clientSecret },
  ]) {
    assert.equal(spotify.parseAppCredentials(body), null, JSON.stringify(body));
  }
});

test('the OAuth calls use the license\'s own app when it has one, and the platform app otherwise', async () => {
  const own = new URL(spotify.getAuthUrl('state-1', OWN_APP));
  assert.equal(own.searchParams.get('client_id'), OWN_APP.clientId);
  assert.equal(own.searchParams.get('redirect_uri'), 'https://api.test/api/spotify/callback');
  assert.equal(own.searchParams.get('state'), 'state-1');
  assert.equal(new URL(spotify.getAuthUrl('state-1', null)).searchParams.get('client_id'), 'shared-client-id');
  assert.equal(spotify.REDIRECT_URI, 'https://api.test/api/spotify/callback');

  let calls = recordFetch(200, '{"access_token":"a","refresh_token":"r","expires_in":3600}');
  await spotify.exchangeCodeForTokens('code', OWN_APP);
  assert.equal(calls[0].options.headers.Authorization, basic(OWN_APP.clientId, OWN_APP.clientSecret));
  await spotify.exchangeCodeForTokens('code', null);
  assert.equal(calls[1].options.headers.Authorization, basic('shared-client-id', 'shared-client-secret'));

  // A refresh_token only works with the app that issued it: the stored account carries its own app.
  calls = recordFetch(200, '{"access_token":"new","expires_in":3600}');
  const saved = [];
  dbStub.updateSpotifyTokens = async (...args) => { saved.push(args); };
  const expired = { license_id: 'a1', access_token: 'old', refresh_token: 'rt', expires_at: 0, app: OWN_APP };
  assert.equal(await spotify.getValidAccessToken(expired), 'new');
  assert.equal(calls[0].options.headers.Authorization, basic(OWN_APP.clientId, OWN_APP.clientSecret));
  assert.equal(String(calls[0].options.body), 'grant_type=refresh_token&refresh_token=rt');
  assert.equal(saved.length, 1);
  await spotify.getValidAccessToken({ ...expired, app: null });
  assert.equal(calls[1].options.headers.Authorization, basic('shared-client-id', 'shared-client-secret'));
});

test('verifyAppCredentials accepts a real pair, rejects a wrong one and never leaks the secret in the error', async () => {
  let calls = recordFetch(200);
  assert.equal(await spotify.verifyAppCredentials(OWN_APP), true);
  assert.equal(calls[0].url, 'https://accounts.spotify.com/api/token');
  assert.equal(String(calls[0].options.body), 'grant_type=client_credentials');
  assert.equal(calls[0].options.headers.Authorization, basic(OWN_APP.clientId, OWN_APP.clientSecret));

  for (const status of [400, 401]) {
    recordFetch(status, `{"error":"invalid_client","echo":"${OWN_APP.clientSecret}"}`);
    await assert.rejects(() => spotify.verifyAppCredentials(OWN_APP), (err) => {
      assert.ok(err instanceof spotify.SpotifyInvalidCredentialsError);
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.ok(!err.message.includes(OWN_APP.clientSecret) && !err.message.includes(OWN_APP.clientId));
      return true;
    });
  }
  recordFetch(503, 'down');
  await assert.rejects(() => spotify.verifyAppCredentials(OWN_APP), (err) => !(err instanceof spotify.SpotifyInvalidCredentialsError) && /503/.test(err.message));
});

// ── Routes (server.js registered against stubs, like the OAuth callback tests) ──
function spotifyRoutes({ license, ownApp = null, slotHolders = [], account = null, verify = async () => true, upsertFails = false } = {}) {
  const routes = {};
  const events = { upserts: [], deletedApps: [], verified: [], accountReads: 0, logs: [] };
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const context = vm.createContext({
    app: { get: (path, ...h) => { routes[`GET ${path}`] = h.at(-1); }, post: (path, ...h) => { routes[`POST ${path}`] = h.at(-1); }, delete: (path, ...h) => { routes[`DELETE ${path}`] = h.at(-1); } },
    auth: { requireAuth: null, signSpotifyState: (id) => `state-for-${id}` },
    generalLimiter: null,
    spotifyAppLimiter: null,
    tenants: new Map(),
    pricing,
    console: { error: (...args) => events.logs.push(args.join(' ')) },
    spotify: {
      ...spotify,
      getAuthUrl: (state, app) => `https://accounts.spotify.com/authorize?state=${state}&client=${app ? app.clientId : 'shared'}`,
      verifyAppCredentials: async (credentials) => { events.verified.push(credentials); return verify(credentials); },
    },
    db: {
      getSpotifyApp: async () => ownApp,
      getSharedSpotifySlotHolders: async () => slotHolders,
      getSpotifyAccount: async () => { events.accountReads++; return account; },
      upsertSpotifyApp: async (...args) => { if (upsertFails) throw new Error('db caída'); events.upserts.push(args); },
      deleteSpotifyApp: async (...args) => { events.deletedApps.push(args); },
    },
  });
  const run = (from, to) => vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to)), context);
  run('async function spotifyAccessFor', "app.get('/api/spotify/callback'");
  run("app.get('/api/spotify/status'", "app.post('/api/spotify/disconnect'");
  const call = async (name, body = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = JSON.parse(JSON.stringify(payload)); } };
    await routes[name]({ license, body }, res);
    return res;
  };
  return { call, events };
}

test('/api/spotify/status tells the panel what the license can do, without ever returning the secret', async () => {
  const monthly = await spotifyRoutes({ license: MONTHLY, account: { display_name: 'stale' } }).call('GET /api/spotify/status');
  assert.equal(monthly.body.allowed, false);
  assert.equal(monthly.body.access.addonRequired, true);
  assert.equal(monthly.body.connected, false);
  assert.equal(monthly.body.addonPriceCents, 18000);
  assert.equal(monthly.body.redirectUri, 'https://api.test/api/spotify/callback');

  assert.equal(monthly.body.connectedAt, null);

  const holder = spotifyRoutes({ license: LIFETIME, slotHolders: ['l1'], account: { display_name: 'Ana', connected_at: 1788000000000 } });
  const shared = await holder.call('GET /api/spotify/status');
  assert.equal(shared.body.allowed, true);
  assert.equal(shared.body.access.source, 'shared');
  assert.equal(shared.body.connected, true);
  assert.equal(shared.body.displayName, 'Ana');
  assert.equal(shared.body.connectedAt, 1788000000000); // the panel warns before Spotify expires the connection, 6 months after this
  assert.deepEqual(shared.body.sharedSlots, { total: SLOTS, used: 1 });
  assert.equal(shared.body.ownApp, null);

  const own = await spotifyRoutes({ license: ANNUAL, ownApp: OWN_APP, account: { display_name: 'Beto' } }).call('GET /api/spotify/status');
  assert.equal(own.body.access.source, 'own');
  assert.deepEqual(own.body.ownApp, { clientId: OWN_APP.clientId });
  assert.ok(!SECRET_IN_TEXT(own.body), 'the client secret must never be sent to the browser');
});

test('/api/spotify/status never reports a leftover account as connected when the license has nothing to connect with', async () => {
  // A Lifetime beyond the slots (no slot, no own app) that connected before losing its place.
  const routes = spotifyRoutes({ license: BEYOND_SLOTS, slotHolders: holdersOf(SLOTS), account: { display_name: 'Vieja' } });
  const { body } = await routes.call('GET /api/spotify/status');
  assert.equal(body.allowed, false);
  assert.equal(body.access.needsOwnApp, true);
  assert.equal(body.connected, false);
  assert.equal(routes.events.accountReads, 0);
});

test('/api/spotify/connect starts the OAuth with the right app and refuses the rest', async () => {
  const monthly = await spotifyRoutes({ license: MONTHLY }).call('GET /api/spotify/connect');
  assert.equal(monthly.statusCode, 403);
  assert.match(monthly.body.error, /complemento/);
  const trial = await spotifyRoutes({ license: TRIAL }).call('GET /api/spotify/connect');
  assert.equal(trial.statusCode, 403);
  assert.match(trial.body.error, /Anual y Lifetime/);

  const beyond = await spotifyRoutes({ license: BEYOND_SLOTS, slotHolders: holdersOf(SLOTS) }).call('GET /api/spotify/connect');
  assert.equal(beyond.statusCode, 409);
  assert.match(beyond.body.error, /propia app/);

  const holder = await spotifyRoutes({ license: LIFETIME, slotHolders: ['l1'] }).call('GET /api/spotify/connect');
  assert.equal(holder.body.authUrl, 'https://accounts.spotify.com/authorize?state=state-for-l1&client=shared');
  const own = await spotifyRoutes({ license: ANNUAL, ownApp: OWN_APP }).call('GET /api/spotify/connect');
  assert.equal(own.body.authUrl, `https://accounts.spotify.com/authorize?state=state-for-a1&client=${OWN_APP.clientId}`);
});

test('/api/spotify/app verifies the credentials with Spotify before saving anything', async () => {
  const bad = spotifyRoutes({ license: ANNUAL });
  const malformed = await bad.call('POST /api/spotify/app', { clientId: 'x', clientSecret: 'y' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(bad.events.verified.length, 0);
  assert.equal(bad.events.upserts.length, 0);

  const wrong = spotifyRoutes({ license: ANNUAL, verify: async () => { throw new spotify.SpotifyInvalidCredentialsError('no'); } });
  const rejected = await wrong.call('POST /api/spotify/app', OWN_APP);
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /no reconoció/);
  assert.equal(wrong.events.upserts.length, 0);

  const down = spotifyRoutes({ license: ANNUAL, verify: async () => { throw new Error('Spotify no pudo verificar las credenciales (503)'); } });
  const unavailable = await down.call('POST /api/spotify/app', OWN_APP);
  assert.equal(unavailable.statusCode, 502);
  assert.equal(down.events.upserts.length, 0);
  assert.ok(!down.events.logs.some((line) => line.includes(OWN_APP.clientSecret)), 'the secret must never reach the logs');

  const good = spotifyRoutes({ license: ANNUAL });
  const saved = await good.call('POST /api/spotify/app', { clientId: ` ${OWN_APP.clientId} `, clientSecret: OWN_APP.clientSecret });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body, { success: true });
  assert.deepEqual(good.events.verified, [OWN_APP]);
  assert.deepEqual(good.events.upserts, [['a1', OWN_APP]]);
  assert.ok(!SECRET_IN_TEXT(saved.body));

  const dbDown = spotifyRoutes({ license: ANNUAL, upsertFails: true });
  const failed = await dbDown.call('POST /api/spotify/app', OWN_APP);
  assert.equal(failed.statusCode, 500);
  assert.ok(!SECRET_IN_TEXT(failed.body));
});

test('/api/spotify/app refuses a license with no right to Spotify, and DELETE removes the app', async () => {
  const monthly = spotifyRoutes({ license: MONTHLY });
  assert.equal((await monthly.call('POST /api/spotify/app', OWN_APP)).statusCode, 403);
  assert.equal(monthly.events.verified.length, 0);

  const owner = spotifyRoutes({ license: ANNUAL, ownApp: OWN_APP });
  assert.deepEqual((await owner.call('DELETE /api/spotify/app')).body, { success: true });
  assert.deepEqual(owner.events.deletedApps, [['a1']]);
});

// ── The tenant only serves accounts that still have the right to Spotify ──
function tenantSpotify({ db, spotifyApi = spotify }) {
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('/spotify') ? spotifyApi : name.endsWith('/db') ? db : name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : {}),
    console: { log() {}, warn() {}, error() {} }, Date, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/spotify'), 'utf8'), context);
  return context.module.exports;
}

test('the tenant hands out a Spotify account only while the license keeps its right and, on the platform app, its slot', async () => {
  const account = (extra = {}) => ({ license_id: 'x', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600000, app: null, ...extra });
  const check = async (license, acc, holders = []) => {
    const reads = { account: 0, slots: 0 };
    const tenant = Object.create(tenantSpotify({ db: {
      findById: async () => license,
      getSpotifyAccount: async () => { reads.account++; return acc; },
      getSharedSpotifySlotHolders: async () => { reads.slots++; return holders; },
    } }));
    tenant.licenseId = license?.id;
    return { result: await tenant.getAllowedSpotifyAccount(), reads };
  };

  const monthly = await check(MONTHLY, account());
  assert.equal(monthly.result, null);
  assert.equal(monthly.reads.account, 0); // no tokens are read for a license that cannot use them

  const withOwnApp = await check(MONTHLY_ADDON, account({ app: OWN_APP }));
  assert.ok(withOwnApp.result);
  assert.equal(withOwnApp.reads.slots, 0); // an own app depends on no slot

  assert.ok((await check(LIFETIME, account(), ['l1'])).result);
  assert.equal((await check(BEYOND_SLOTS, account(), holdersOf(SLOTS))).result, null); // lost its slot: the shared app stops serving it
  assert.equal((await check(ANNUAL, account(), [])).result, null); // a shared-app account of a plan with no slot
  assert.ok((await check(ADMIN, account())).result);
  assert.equal((await check(ADMIN, account())).reads.slots, 0);
  assert.equal((await check(undefined, account())).result, null);
});

test('the streamer is told to fix their own app, not to contact the admin, when their own app rejects them', () => {
  const tenant = Object.create(tenantSpotify({ db: {} }));
  const error = new spotify.SpotifyUserNotRegisteredError('403');
  assert.match(tenant.describeSpotifyError(error, { app: OWN_APP }), /User Management/);
  assert.ok(!/administrador/.test(tenant.describeSpotifyError(error, { app: OWN_APP })));
  assert.match(tenant.describeSpotifyError(error, { app: null }), /administrador/);
  assert.match(tenant.describeSpotifyError(error), /administrador/);
});

// ── Pricing ──────────────────────────────────────────────
test('the add-on price is separate from the plans: it adds to a purchase but can never be bought as a plan', async () => {
  dbStub.overrides = {};
  assert.equal(pricing.isValidPlan('spotify_addon'), false);
  assert.ok(!('spotify_addon' in pricing.getAllPlanPricesCents()));
  assert.equal(pricing.getSpotifyAddonPriceCents(), 18000);
  assert.equal(pricing.computeAmountCents({ spotifyAddon: true }), 18000);
  assert.equal(pricing.computeAmountCents({ planType: 'month', spotifyAddon: true }), 12600 + 18000);
  assert.equal(pricing.computeAmountCents({ planType: 'month', spotifyAddon: false }), 12600);
  assert.equal(pricing.computeAmountCents({ planType: 'month' }), 12600);

  await pricing.setSpotifyAddonPriceCents(25000, 'admin');
  assert.equal(pricing.getSpotifyAddonPriceCents(), 25000);
  assert.deepEqual(dbStub.saved.at(-1), ['spotify_addon', 25000]);
  assert.equal(pricing.getPlanPriceCents('month'), 12600); // the plans are untouched
  await assert.rejects(() => pricing.setSpotifyAddonPriceCents(50, 'admin'), /precio mínimo/);
  assert.equal(pricing.getSpotifyAddonPriceCents(), 25000);
  await assert.rejects(() => pricing.setPlanPriceCents('spotify_addon', 5000, 'admin'), /Plan inválido/);

  await pricing.loadPriceOverrides(); // restarts pick the saved add-on price back up
  assert.equal(pricing.getSpotifyAddonPriceCents(), 25000);
  dbStub.overrides = {};
  await pricing.loadPriceOverrides();
});

// ── Purchases (server.js helpers, run against stubs) ──
function purchaseContext() {
  const events = { payments: [], stripePayments: [], applied: [], logs: [], fresh: true };
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const context = vm.createContext({
    pricing, spotify, crypto: require('node:crypto'), Date,
    PLAN_KEY_LABELS: { month: 'monthly', annual: 'yearly', lifetime: 'lifetime' },
    auth: {
      computeExpiresAt: (type) => (type === 'lifetime' ? null : 1000),
      generateLabeledKey: (alias, label) => `${alias}-${label}-KEY`,
      hashKey: (key) => `hash(${key})`,
      keyPrefix: (key) => key.slice(0, 4),
    },
    db: {
      insertPaymentIfNew: async (row) => { events.payments.push(row); return events.fresh; },
      insertStripePaymentIfNew: async (row) => { events.stripePayments.push(row); return events.fresh; },
      findById: async (id) => (id === 'gone' ? undefined : { id, username: 'ana', license_type: 'month', expires_at: null, dice_tier: 'regular' }),
      applyPurchase: async (...args) => { events.applied.push(args); },
    },
    console: { log() {}, error: (...args) => events.logs.push(args.join(' ')) },
    EMAIL_RE: /^\S+@\S+\.\S+$/,
    app: { get() {}, post: (path, ...h) => { context.__routes[`POST ${path}`] = h.at(-1); } },
    paymentLimiter: null, paymentStatusLimiter: null,
    __routes: {},
  });
  const run = (from, to) => vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to)), context);
  run('function buildExternalReference', '// Precios vigentes de los 3 planes');
  run('function computeLicenseUpdateForPurchase', '// Interpreta el estado real de una orden');
  run("app.post('/api/payments/charge'", "app.get('/api/payments/orders/:orderId/status'");
  return { context, events };
}

test('an MP order reference carries the add-on, and references created before the add-on existed still parse', () => {
  const { context } = purchaseContext();
  const built = context.buildExternalReference({ licenseId: 'aaaa-bbbb-cccc', planType: 'month', diceTier: undefined, spotifyAddon: true });
  assert.match(built, /^aaaa-bbbb-cccc_month_none_sp_[0-9a-z]+$/);
  assert.ok(!built.includes(':'), 'the Orders API rejects ":" in external_reference');
  assert.deepEqual({ ...context.parseExternalReference(built) }, { licenseId: 'aaaa-bbbb-cccc', planType: 'month', diceTier: undefined, spotifyAddon: true });

  const addonOnly = context.buildExternalReference({ licenseId: 'x-y', planType: undefined, diceTier: undefined, spotifyAddon: true });
  assert.deepEqual({ ...context.parseExternalReference(addonOnly) }, { licenseId: 'x-y', planType: undefined, diceTier: undefined, spotifyAddon: true });

  // The Orders API caps external_reference at 64 characters: check the worst case (real UUID, longest plan, tier and add-on).
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  for (const planType of ['lifetime', 'annual', 'month', undefined]) {
    for (const diceTier of ['pro', 'vip', undefined]) {
      for (const spotifyAddon of [true, false]) {
        const ref = context.buildExternalReference({ licenseId: uuid, planType, diceTier, spotifyAddon });
        assert.ok(ref.length <= 64, `${ref} has ${ref.length} characters`);
        assert.deepEqual({ ...context.parseExternalReference(ref) }, { licenseId: uuid, planType, diceTier, spotifyAddon });
      }
    }
  }
  // Legacy reference that spelled the add-on out ("spotify") still parses.
  assert.equal(context.parseExternalReference('aaaa-bbbb-cccc_month_none_spotify_1788000000000').spotifyAddon, true);

  // Orders already in flight: the 4th segment was a timestamp, which must never switch the add-on on.
  assert.deepEqual({ ...context.parseExternalReference('aaaa-bbbb-cccc_annual_pro_1788000000000') }, { licenseId: 'aaaa-bbbb-cccc', planType: 'annual', diceTier: 'pro', spotifyAddon: false });
  assert.deepEqual({ ...context.parseExternalReference('aaaa-bbbb-cccc_none_vip_1788000000000') }, { licenseId: 'aaaa-bbbb-cccc', planType: undefined, diceTier: 'vip', spotifyAddon: false });
  assert.equal(context.parseExternalReference(undefined).spotifyAddon, false);
});

test('purchase validation: the add-on follows its rules and can never be sent as a plan', () => {
  const { context } = purchaseContext();
  const error = (license, items) => context.purchaseItemsError(license, items);
  assert.equal(error(MONTHLY, { spotifyAddon: true }), null);
  assert.equal(error(MONTHLY, { planType: 'month', spotifyAddon: true }), null);
  assert.equal(error(TRIAL, { planType: 'month', spotifyAddon: true }), null);
  assert.equal(error(TRIAL, { spotifyAddon: true }), 'El complemento de Spotify es para el plan Mensual.');
  assert.equal(error(ANNUAL, { spotifyAddon: true }), 'Tu plan ya incluye Spotify.');
  assert.equal(error(MONTHLY, { planType: 'lifetime', spotifyAddon: true }), 'Tu plan ya incluye Spotify.');
  assert.equal(error(MONTHLY_ADDON, { spotifyAddon: true }), 'Ya tienes el complemento de Spotify.');
  assert.equal(error(MONTHLY, { planType: 'spotify_addon' }), 'Plan invalido');
  assert.equal(error(MONTHLY, { spotifyAddon: 'true' }), 'Addon invalido');
  assert.equal(error(MONTHLY, { spotifyAddon: 1 }), 'Addon invalido');
  assert.equal(error(MONTHLY, {}), 'Elige al menos un plan o un addon');
  assert.equal(error(MONTHLY, { spotifyAddon: false }), 'Elige al menos un plan o un addon');
  // What was already valid stays valid.
  assert.equal(error(MONTHLY, { planType: 'annual' }), null);
  assert.equal(error(MONTHLY, { diceTier: 'pro' }), null);
  assert.equal(error(MONTHLY, { planType: 'bogus' }), 'Plan invalido');
  assert.equal(error(MONTHLY, { diceTier: 'bogus' }), 'Addon invalido');
});

test('an approved add-on-only payment turns the add-on on without touching the plan or rotating the key', async () => {
  for (const [apply, recorded, id] of [['applyApprovedPaymentIfNew', 'payments', 'mpPaymentId'], ['applyApprovedStripePaymentIfNew', 'stripePayments', 'stripePaymentId']]) {
    const { context, events } = purchaseContext();
    dbStub.overrides = {};
    const result = await context[apply]({ licenseId: 'm1', spotifyAddon: true, [id]: 'pay-1' });
    assert.equal(result.applied, true, apply);
    assert.equal(events[recorded].length, 1);
    assert.equal(events[recorded][0].spotifyAddon, true);
    assert.equal(events[recorded][0].planType, null);
    assert.equal(events[recorded][0].amountCents, 18000);
    assert.deepEqual(events.applied.map(([licenseId, update]) => [licenseId, { ...update }]), [['m1', { spotifyAddon: true }]]);
  }
});

test('Monthly plus the add-on in one payment applies both, and the recorded amount is their sum', async () => {
  const { context, events } = purchaseContext();
  dbStub.overrides = {};
  await context.applyApprovedPaymentIfNew({ licenseId: 'm1', planType: 'month', spotifyAddon: true, mpPaymentId: 'pay-2' });
  assert.equal(events.payments[0].amountCents, 12600 + 18000);
  const update = events.applied[0][1];
  assert.equal(update.licenseType, 'month');
  assert.equal(update.spotifyAddon, true);
  assert.equal(update.keyHash, 'hash(ana-monthly-KEY)');
});

test('a payment already processed, or for a license that no longer exists, applies nothing', async () => {
  const seen = purchaseContext();
  seen.events.fresh = false;
  const repeated = await seen.context.applyApprovedPaymentIfNew({ licenseId: 'm1', spotifyAddon: true, mpPaymentId: 'pay-3' });
  assert.deepEqual({ ...repeated }, { applied: false, alreadyProcessed: true });
  assert.equal(seen.events.applied.length, 0);

  const gone = purchaseContext();
  assert.equal((await gone.context.applyApprovedPaymentIfNew({ licenseId: 'gone', spotifyAddon: true, mpPaymentId: 'pay-4' })).applied, false);
  assert.equal(gone.events.applied.length, 0);

  const empty = purchaseContext();
  assert.equal((await empty.context.applyApprovedPaymentIfNew({ licenseId: 'm1', mpPaymentId: 'pay-5' })).applied, false);
  assert.equal(empty.events.payments.length, 0);
});

test('/api/payments/charge rejects an invalid add-on purchase before contacting MercadoPago', async () => {
  const { context } = purchaseContext();
  const charge = context.__routes['POST /api/payments/charge'];
  global.fetch = async () => { throw new Error('must not reach MercadoPago'); };
  const send = async (license, body) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = JSON.parse(JSON.stringify(payload)); } };
    await charge({ license, body, headers: {} }, res);
    return res;
  };
  const annual = await send(ANNUAL, { spotifyAddon: true, email: 'a@b.co', firstName: 'A', lastName: 'B', token: 't', payment_method_id: 'visa', policyAcceptedAt: new Date().toISOString() });
  assert.equal(annual.statusCode, 400);
  assert.equal(annual.body.error, 'Tu plan ya incluye Spotify.');
  const asPlan = await send(MONTHLY, { planType: 'spotify_addon' });
  assert.equal(asPlan.statusCode, 400);
  assert.equal(asPlan.body.error, 'Plan invalido');
});

test('/api/pricing publishes the add-on price and the slot count, and keeps working if the slot query fails', async () => {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const serve = async (slotHolders) => {
    let handler;
    vm.runInNewContext(source.slice(source.indexOf("app.get('/api/pricing'"), source.indexOf("app.post('/api/payments/webhook'")), {
      app: { get: (_path, h) => { handler = h; } },
      pricing, spotify,
      db: { getSharedSpotifySlotHolders: async () => { if (slotHolders instanceof Error) throw slotHolders; return slotHolders; } },
      console: { error() {} },
    });
    let body;
    await handler({}, { json: (payload) => { body = JSON.parse(JSON.stringify(payload)); } });
    return body;
  };
  dbStub.overrides = {};
  await pricing.loadPriceOverrides();
  const ok = await serve(['l1', 'l2']);
  assert.deepEqual(ok.spotifySlots, { total: SLOTS, used: 2 });
  assert.equal(ok.spotifyAddon, 18000);
  assert.deepEqual(ok.prices, { month: 12600, annual: 108000, lifetime: 180000 });
  const degraded = await serve(new Error('db caída'));
  assert.equal(degraded.success, true);
  assert.equal(degraded.spotifySlots, null);
  assert.equal(degraded.spotifyAddon, 18000);
});

// ── Connection expiry: Spotify expires refresh tokens 6 months after the original authorization ──
test('an expired or revoked refresh token is told apart from any other refresh failure', async () => {
  const expired = { license_id: 'a1', access_token: 'old', refresh_token: 'rt', expires_at: 0, app: null };
  for (const body of ['{"error":"invalid_grant"}', '{"error":"invalid_grant","error_description":"Refresh token revoked"}']) {
    recordFetch(400, body);
    await assert.rejects(() => spotify.getValidAccessToken(expired), (err) => {
      assert.ok(err instanceof spotify.SpotifyRefreshTokenExpiredError);
      assert.equal(err.code, 'REFRESH_TOKEN_EXPIRED');
      return true;
    });
  }
  // A rotated Client secret (invalid_client) or a Spotify outage is NOT an expiry: it must never make the tenant drop the account.
  for (const [status, body] of [[400, '{"error":"invalid_client"}'], [401, '{"error":"invalid_client"}'], [500, 'boom'], [429, 'slow down']]) {
    recordFetch(status, body);
    await assert.rejects(() => spotify.getValidAccessToken(expired), (err) => !(err instanceof spotify.SpotifyRefreshTokenExpiredError) && new RegExp(`\\(${status}\\)`).test(err.message));
  }
});

test('a new refresh token from Spotify replaces the stored one; when Spotify sends none, the stored one is kept', async () => {
  const saved = [];
  dbStub.updateSpotifyTokens = async (...args) => { saved.push(args); };
  const expired = { license_id: 'a1', access_token: 'old', refresh_token: 'rt-old', expires_at: 0, app: null };

  recordFetch(200, '{"access_token":"a2","expires_in":3600,"refresh_token":"rt-new"}');
  assert.equal(await spotify.getValidAccessToken(expired), 'a2');
  assert.equal(saved[0][0], 'a1');
  assert.equal(saved[0][1].accessToken, 'a2');
  assert.equal(saved[0][1].refreshToken, 'rt-new');

  recordFetch(200, '{"access_token":"a3","expires_in":3600}');
  assert.equal(await spotify.getValidAccessToken(expired), 'a3');
  assert.equal(saved[1][1].refreshToken, undefined); // undefined = db.updateSpotifyTokens leaves the stored token alone
});

// A tenant whose token refresh fails with `error`, wired to record everything that reaches Spotify or the panel.
function tokenFailureTenant(error) {
  const events = { emitted: [], deleted: [], api: [] };
  const account = { license_id: 'l1', access_token: 't', refresh_token: 'r', expires_at: 0, app: null };
  const track = (name) => async () => { events.api.push(name); return null; };
  const tenant = Object.create(tenantSpotify({
    db: {
      findById: async () => LIFETIME,
      getSpotifyAccount: async () => account,
      getSharedSpotifySlotHolders: async () => ['l1'],
      deleteSpotifyAccount: async (id) => { events.deleted.push(id); },
    },
    spotifyApi: { ...spotify, getValidAccessToken: async () => { throw error; }, searchTrack: track('search'), skipToNext: track('skip'), setVolume: track('volume'), getQueue: track('queue'), addToQueue: track('add') },
  }));
  tenant.licenseId = 'l1';
  tenant.logId = 'ana/l1';
  tenant.spotifySettings = { maxQueueSize: 8 };
  tenant.spotifyQueueState = { nowPlaying: { uri: 'spotify:track:1', title: 'x' }, queue: [] };
  tenant.spotifyPollInterval = setInterval(() => {}, 60000);
  tenant.spotifyPollInterval.unref();
  tenant.broadcast = { emit: (name, payload) => events.emitted.push({ name, payload }) };
  return { tenant, events };
}

const TOKEN_EXPIRED = () => new spotify.SpotifyRefreshTokenExpiredError('Spotify token refresh falló (400): {"error":"invalid_grant"}');
const volumeCommand = async (tenant) => {
  const handlers = {};
  tenant.registerSpotifyHandlers({ on: (name, handler) => { handlers[name] = handler; } });
  await handlers.set_spotify_volume(40);
};
const EXPIRY_ENTRY_POINTS = {
  '!play': (tenant) => tenant.requestSpotifySong('viewer', 'some song'),
  '!skip': (tenant) => tenant.skipSpotifyTrack(),
  'volume': volumeCommand,
  'polling': (tenant) => tenant.pollSpotifyQueue(),
};

for (const [name, run] of Object.entries(EXPIRY_ENTRY_POINTS)) {
  test(`${name}: an expired connection drops the stored account, stops the polling and tells the panel once`, async () => {
    const { tenant, events } = tokenFailureTenant(TOKEN_EXPIRED());
    await run(tenant);
    assert.deepEqual(events.deleted, ['l1']);
    assert.deepEqual(events.api, [], 'nothing may reach Spotify with a dead token');
    assert.equal(tenant.spotifyPollInterval, null);
    assert.equal(tenant.spotifyQueueState.nowPlaying, null);
    const errors = events.emitted.filter(({ name: event }) => event === 'spotify_error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].payload.message, /6 meses/);
    assert.match(errors[0].payload.message, /vuelve a conectarla/);
    assert.ok(events.emitted.some(({ name: event }) => event === 'spotify_queue_update'), 'the overlay must stop showing the old "now playing"');
  });
}

test('any other token failure keeps its old handling and never deletes the account', async () => {
  const boom = new Error('Spotify token refresh falló (500): boom');
  for (const command of ['!play', '!skip']) {
    const { tenant, events } = tokenFailureTenant(boom);
    await EXPIRY_ENTRY_POINTS[command](tenant);
    assert.deepEqual(events.deleted, [], command);
    assert.deepEqual(events.emitted.map(({ payload }) => payload?.message), ['Tu conexión con Spotify venció — reconéctala desde el panel.'], command);
  }
  const polling = tokenFailureTenant(boom);
  await polling.tenant.pollSpotifyQueue();
  assert.deepEqual(polling.events.deleted, []);
  assert.deepEqual(polling.events.emitted, []); // the poll retries by itself next tick and must not flood the panel
  assert.ok(polling.tenant.spotifyPollInterval, 'the polling keeps running');
  clearInterval(polling.tenant.spotifyPollInterval);
});

// ── Admin license list: which Spotify account each license is linked to ──
function licenseList({ rows, links, slotHolders = [] }) {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  let handler;
  vm.runInNewContext(source.slice(source.indexOf("app.get('/api/licenses', auth.requireAuth"), source.indexOf("app.post('/api/licenses', auth.requireAuth")), {
    app: { get: (_path, ...h) => { handler = h.at(-1); } },
    auth: { requireAuth: null, requireAdmin: null }, adminLimiter: null,
    spotify,
    db: { listAll: async () => rows, getSharedSpotifySlotHolders: async () => slotHolders, listSpotifyAccountLinks: async () => links },
  });
  return async () => {
    let body;
    await handler({}, { json: (payload) => { body = JSON.parse(JSON.stringify(payload)); } });
    return body;
  };
}
const licenseRow = (id, username, extra = {}) => ({ id, key_prefix: id, username, license_type: 'lifetime', is_admin: false, revoked: false, created_at: 1, expires_at: null, last_login_at: null, king_starts: 0, zub_starts: 0, elim_starts: 0, roulette_starts: 0, last_active_at: null, multi_device: false, trial_alias: null, trial_connected_username: null, dice_tier: 'regular', dice_win_bonus_unlocked: false, spotify_addon: false, lifetime_at: 1, ...extra });

test('the admin list shows the linked Spotify account, and who else uses the same one on the platform app', async () => {
  const rows = [licenseRow('adm', 'notbenjaa1', { is_admin: true }), licenseRow('gf', 'novia'), licenseRow('c1', 'cliente1'), licenseRow('c2', 'cliente2'), licenseRow('c3', 'cliente3')];
  const links = [
    { license_id: 'adm', spotify_user_id: 'owner-account', display_name: 'Benja', connected_at: 100, own_app: false },
    { license_id: 'gf', spotify_user_id: 'owner-account', display_name: 'Benja', connected_at: 200, own_app: false },  // the same Spotify account as the admin license
    { license_id: 'c1', spotify_user_id: 'owner-account', display_name: 'Benja', connected_at: 300, own_app: true },    // same account, but through its OWN app: irrelevant to the platform app's cap
    { license_id: 'c2', spotify_user_id: 'someone-else', display_name: 'Cleo', connected_at: 400, own_app: false },
  ];
  const { licenses } = await licenseList({ rows, links, slotHolders: ['gf', 'c2'] })();
  const byName = Object.fromEntries(licenses.map((license) => [license.username, license]));

  assert.deepEqual(byName.notbenjaa1.spotifyAccount, { displayName: 'Benja', connectedAt: 100, ownApp: false, sharedWith: ['novia'] });
  assert.deepEqual(byName.novia.spotifyAccount, { displayName: 'Benja', connectedAt: 200, ownApp: false, sharedWith: ['notbenjaa1'] });
  assert.deepEqual(byName.cliente1.spotifyAccount, { displayName: 'Benja', connectedAt: 300, ownApp: true, sharedWith: [] });
  assert.deepEqual(byName.cliente2.spotifyAccount, { displayName: 'Cleo', connectedAt: 400, ownApp: false, sharedWith: [] });
  assert.equal(byName.cliente3.spotifyAccount, null);
  assert.equal(byName.novia.spotifySharedSlot, true);
  assert.equal(byName.cliente3.spotifySharedSlot, false);
  const text = JSON.stringify(licenses);
  assert.ok(!/access_token|refresh_token|owner-account|someone-else/.test(text), 'no tokens or internal Spotify ids in the admin payload');
});
