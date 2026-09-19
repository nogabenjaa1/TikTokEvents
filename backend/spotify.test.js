const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// spotify.js opens the database on require('./db'); these tests never touch tokens, so stub it.
const dbPath = require.resolve('./db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
const spotify = require('./spotify');

// The exact body Spotify returned in production when an account outside the app's user list authorized it.
const NOT_REGISTERED_BODY = 'The user is not registered for this application. Please check your settings on https://developer.spotify.com/dashboard.';
const PREMIUM_BODY = '{"error":{"status":403,"message":"Player command failed: Premium required","reason":"PREMIUM_REQUIRED"}}';

// License rows as the tenant and the routes see them (Spotify is Lifetime-only, see isLicenseAllowed).
const LIFETIME = { id: 'l1', license_type: 'lifetime', is_admin: false };
const MONTHLY = { id: 'l2', license_type: 'month', is_admin: false };

// A validator function rather than the class itself: assert.rejects(fn, undefined) validates nothing, so a
// missing class would let these tests pass vacuously.
const isNotRegistered = (err) => err instanceof spotify.SpotifyUserNotRegisteredError;

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

function mockFetch(status, body) {
  global.fetch = async () => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
}

test('getMe tells the "user not registered" 403 apart from any other failure', async () => {
  for (const body of [NOT_REGISTERED_BODY, '{"error":{"status":403,"message":"User not registered in the Developer Dashboard"}}']) {
    mockFetch(403, body);
    await assert.rejects(() => spotify.getMe('token'), (err) => {
      assert.ok(err instanceof spotify.SpotifyUserNotRegisteredError);
      assert.equal(err.code, 'USER_NOT_REGISTERED');
      assert.equal(err.message, `Spotify /me falló (403): ${body}`); // same message format the logs already had
      return true;
    });
  }
});

test('getMe keeps a plain Error for every other failure, including unrelated 403s', async () => {
  for (const [status, body] of [[500, 'boom'], [403, '{"error":{"status":403,"message":"Insufficient client scope"}}']]) {
    mockFetch(status, body);
    await assert.rejects(() => spotify.getMe('token'), (err) => {
      assert.ok(!(err instanceof spotify.SpotifyUserNotRegisteredError));
      assert.equal(err.message, `Spotify /me falló (${status}): ${body}`);
      return true;
    });
  }
});

test('searchTrack and getQueue report the unregistered-user 403 the same way', async () => {
  mockFetch(403, NOT_REGISTERED_BODY);
  await assert.rejects(() => spotify.searchTrack('token', 'query'), isNotRegistered);
  await assert.rejects(() => spotify.getQueue('token'), isNotRegistered);
});

const playbackCalls = {
  addToQueue: () => spotify.addToQueue('token', 'spotify:track:1'),
  skipToNext: () => spotify.skipToNext('token'),
  setVolume: () => spotify.setVolume('token', 50),
};

for (const [name, call] of Object.entries(playbackCalls)) {
  test(`${name}: an unregistered account is not mistaken for a missing Premium`, async () => {
    mockFetch(403, NOT_REGISTERED_BODY);
    await assert.rejects(call, isNotRegistered);
  });

  test(`${name}: keeps mapping the other statuses as before`, async () => {
    mockFetch(204, '');
    assert.equal(await call(), undefined);

    mockFetch(404, '{"error":{"status":404,"message":"Player command failed: No active device found"}}');
    await assert.rejects(call, (err) => err instanceof spotify.SpotifyPlaybackError && err.code === 'NO_ACTIVE_DEVICE');

    mockFetch(403, PREMIUM_BODY);
    await assert.rejects(call, (err) => err instanceof spotify.SpotifyPlaybackError && err.code === 'PREMIUM_REQUIRED');

    mockFetch(500, 'boom');
    await assert.rejects(call, (err) => err instanceof spotify.SpotifyPlaybackError && err.code === 'UNKNOWN' && /\(500\): boom$/.test(err.message));
  });
}

// ── Tenant side (lib/tenant/spotify.js), loaded the same way alerts.test.js loads its module ──
function tenantSpotify({ db = {}, spotifyApi = spotify } = {}) {
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('/spotify') ? spotifyApi : name.endsWith('/db') ? db : name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : {}),
    console: { log() {}, error() {} }, Date, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/spotify'), 'utf8'), context);
  return context.module.exports;
}

test('describeSpotifyError gives the streamer a specific message for an unregistered account', () => {
  const tenant = Object.create(tenantSpotify());
  const message = tenant.describeSpotifyError(new spotify.SpotifyUserNotRegisteredError('403'));
  assert.match(message, /ya no está habilitada/);
  assert.ok(!/Premium/.test(message));
  assert.match(tenant.describeSpotifyError(new spotify.SpotifyPlaybackError('PREMIUM_REQUIRED', 'x')), /Premium/);
  assert.match(tenant.describeSpotifyError(new spotify.SpotifyPlaybackError('NO_ACTIVE_DEVICE', 'x')), /Abre Spotify/);
  assert.equal(tenant.describeSpotifyError(new Error('boom')), 'No se pudo completar la acción en Spotify.');
});

test('!play reports a failed search to the panel instead of failing silently', async () => {
  const emitted = [];
  const account = { license_id: 'l1', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600000 };
  const tenant = Object.create(tenantSpotify({
    db: { findById: async () => LIFETIME, getSpotifyAccount: async () => account },
    spotifyApi: { ...spotify, searchTrack: async () => { throw new spotify.SpotifyUserNotRegisteredError(`Spotify search falló (403): ${NOT_REGISTERED_BODY}`); } },
  }));
  tenant.licenseId = 'l1';
  tenant.logId = 'ana/l1';
  tenant.broadcast = { emit: (name, payload) => emitted.push({ name, payload }) };
  await tenant.requestSpotifySong('viewer', 'some song');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].name, 'spotify_error');
  assert.match(emitted[0].payload.message, /ya no está habilitada/);
});

// ── OAuth callback (server.js), with the route registered against stubs like alerts.test.js does ──
function oauthCallback({ getMe, tenants = new Map() }) {
  const logs = { warn: [], error: [] };
  const saved = [];
  let handler;
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf("app.get('/api/spotify/callback'"), source.indexOf("app.get('/api/spotify/status'")), {
    app: { get: (_path, ...handlers) => { handler = handlers.at(-1); } },
    generalLimiter: null,
    FRONTEND_URL: 'https://panel.test',
    auth: { verifySpotifyState: (state) => { if (state !== 'good-state') throw new Error('bad state'); return 'abcdef12-license'; } },
    spotify: { ...spotify, exchangeCodeForTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), getMe },
    db: { upsertSpotifyAccount: async (...args) => { saved.push(args); } },
    tenants,
    console: { warn: (...args) => logs.warn.push(args.join(' ')), error: (...args) => logs.error.push(args.join(' ')) },
  });
  const run = async (query = { code: 'c', state: 'good-state' }) => {
    let redirectedTo;
    await handler({ query }, { redirect: (url) => { redirectedTo = url; } });
    return redirectedTo;
  };
  return { run, logs, saved };
}

test('OAuth callback sends an unregistered account to its own banner and names the license in the log', async () => {
  const { run, logs, saved } = oauthCallback({
    getMe: async () => { throw new spotify.SpotifyUserNotRegisteredError(`Spotify /me falló (403): ${NOT_REGISTERED_BODY}`); },
    tenants: new Map([['abcdef12-license', { logId: 'bubulubu_gang/abcdef12' }]]),
  });
  assert.equal(await run(), 'https://panel.test/?spotify=not_registered');
  assert.equal(logs.warn.length, 1);
  assert.match(logs.warn[0], /^\[bubulubu_gang\/abcdef12\] \[Spotify\]/);
  assert.match(logs.warn[0], /User Management/);
  assert.deepEqual(logs.error, []);
  assert.deepEqual(saved, []);
});

test('OAuth callback falls back to the short license id when the tenant is no longer in memory', async () => {
  const { run, logs } = oauthCallback({ getMe: async () => { throw new spotify.SpotifyUserNotRegisteredError('403'); } });
  assert.equal(await run(), 'https://panel.test/?spotify=not_registered');
  assert.match(logs.warn[0], /^\[abcdef12\] \[Spotify\]/);
});

test('OAuth callback keeps the generic error banner for any other failure', async () => {
  const { run, logs, saved } = oauthCallback({
    getMe: async () => { throw new Error('Spotify /me falló (500): boom'); },
    tenants: new Map([['abcdef12-license', { logId: 'bubulubu_gang/abcdef12' }]]),
  });
  assert.equal(await run(), 'https://panel.test/?spotify=error');
  assert.equal(logs.error.length, 1);
  assert.match(logs.error[0], /^\[bubulubu_gang\/abcdef12\] \[Spotify\] Error en el callback de OAuth: Spotify \/me falló \(500\): boom$/);
  assert.deepEqual(logs.warn, []);
  assert.deepEqual(saved, []);
});

test('OAuth callback still stores the account and reports success when Spotify accepts it', async () => {
  const { run, saved } = oauthCallback({ getMe: async () => ({ id: 'spotify-user', display_name: 'Ana' }) });
  assert.equal(await run(), 'https://panel.test/?spotify=connected');
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0], 'abcdef12-license');
  assert.equal(saved[0][1].displayName, 'Ana');
});

// ── Lifetime-only access ──
test('only Lifetime licenses, and the admin one, can use Spotify', () => {
  assert.equal(spotify.isLicenseAllowed(LIFETIME), true);
  for (const type of ['month', 'annual', 'week', 'day', 'trial']) {
    assert.equal(spotify.isLicenseAllowed({ license_type: type, is_admin: false }), false, type);
  }
  assert.equal(spotify.isLicenseAllowed({ license_type: 'month', is_admin: true }), true); // the owner's license is never locked out
  assert.equal(spotify.isLicenseAllowed(undefined), false);
  assert.equal(spotify.isLicenseAllowed(null), false);
});

// Registers the real /connect and /status routes against stubs, like the OAuth callback tests above.
function spotifyRoutes({ account = null } = {}) {
  const routes = {};
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const register = (from, to) => vm.runInNewContext(source.slice(source.indexOf(from), source.indexOf(to)), {
    app: { get: (path, ...handlers) => { routes[path] = handlers.at(-1); } },
    auth: { requireAuth: null, signSpotifyState: (id) => `state-for-${id}` },
    generalLimiter: null,
    spotify: { ...spotify, getAuthUrl: (state) => `https://accounts.spotify.com/authorize?state=${state}` },
    db: { getSpotifyAccount: async () => account },
  });
  register("app.get('/api/spotify/connect'", "app.get('/api/spotify/callback'");
  register("app.get('/api/spotify/status'", "app.post('/api/spotify/disconnect'");
  const call = async (path, license) => {
    // json() copies the body into a host-realm object: assert.deepEqual compares prototypes, and the route runs in a vm context.
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = { ...body }; } };
    await routes[path]({ license }, res);
    return res;
  };
  return { call };
}

test('/api/spotify/connect refuses a license without the Lifetime plan and never starts the OAuth flow', async () => {
  const { call } = spotifyRoutes();
  const refused = await call('/api/spotify/connect', MONTHLY);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.success, false);
  assert.match(refused.body.error, /Lifetime/);
  assert.equal(refused.body.authUrl, undefined);

  const accepted = await call('/api/spotify/connect', LIFETIME);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.authUrl, 'https://accounts.spotify.com/authorize?state=state-for-l1');
});

test('/api/spotify/status reports the permission and never shows a leftover account as connected without it', async () => {
  const { call } = spotifyRoutes({ account: { display_name: 'Ana' } });
  const locked = await call('/api/spotify/status', MONTHLY);
  assert.deepEqual(locked.body, { success: true, allowed: false, connected: false, displayName: null });

  const open = await call('/api/spotify/status', LIFETIME);
  assert.deepEqual(open.body, { success: true, allowed: true, connected: true, displayName: 'Ana' });
});

test('the tenant only hands out the Spotify account to a license that may use it, and reads the license fresh', async () => {
  const reads = [];
  let license = MONTHLY;
  const account = { license_id: 'l1', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600000 };
  const tenant = Object.create(tenantSpotify({ db: { findById: async () => license, getSpotifyAccount: async () => { reads.push('account'); return account; } } }));
  tenant.licenseId = 'l1';

  assert.equal(await tenant.getAllowedSpotifyAccount(), null);
  assert.deepEqual(reads, []); // no tokens are read (or decrypted) for a license that cannot use them

  license = LIFETIME; // the plan changed after the Tenant was created: no restart or reconnection needed
  assert.equal(await tenant.getAllowedSpotifyAccount(), account);

  license = undefined; // license deleted
  assert.equal(await tenant.getAllowedSpotifyAccount(), null);
});

test('a stored account of a non-Lifetime license cannot use !play, !skip, volume or the polling', async () => {
  const emitted = [];
  const account = { license_id: 'l2', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600000 };
  const spotifyApi = new Proxy({ ...spotify }, {
    get: (target, prop) => (['searchTrack', 'skipToNext', 'setVolume', 'getQueue'].includes(prop)
      ? () => assert.fail(`spotify.${String(prop)} must not be called`)
      : target[prop]),
  });
  const tenant = Object.create(tenantSpotify({ db: { findById: async () => MONTHLY, getSpotifyAccount: async () => account }, spotifyApi }));
  tenant.licenseId = 'l2';
  tenant.logId = 'ana/l2';
  tenant.spotifySettings = { maxQueueSize: 8 };
  tenant.spotifyQueueState = { nowPlaying: { uri: 'spotify:track:1' }, queue: [] };
  tenant.broadcast = { emit: (name, payload) => emitted.push({ name, payload }) };

  await tenant.requestSpotifySong('viewer', 'some song');
  await tenant.skipSpotifyTrack();
  assert.deepEqual(emitted, []);

  await tenant.maybeStartSpotifyPolling();
  assert.ok(!tenant.spotifyPollInterval, 'polling must not start');

  // A poll already running (the plan was downgraded or the account predates the rule) stops and clears "now playing".
  tenant.spotifyPollInterval = setInterval(() => {}, 60000);
  tenant.spotifyPollInterval.unref();
  await tenant.pollSpotifyQueue();
  assert.equal(tenant.spotifyPollInterval, null);
  assert.equal(tenant.spotifyQueueState.nowPlaying, null);
  assert.deepEqual(emitted.map(({ name }) => name), ['spotify_queue_update']);
});
