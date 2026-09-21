const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Licenses created or regenerated from the admin panel: the key format (alias-tier-hash, like the trial and
// purchase keys) and the optional Spotify add-on. The routes are registered from server.js against stubs, the
// same way the other test files do it; auth.js is the real module.

// auth.js reads two secrets and the database when it loads: provide them first.
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.KEY_HASH_SECRET = 'test-key-hash-secret';
const dbPath = require.resolve('./db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
const auth = require('./auth');

// alias-tier-hash: 9 random bytes make a 12-character base64url suffix.
const keyFormat = (alias, label) => new RegExp(`^${alias}-${label}-[A-Za-z0-9_-]{12}$`);

test('labeled keys are alias-tier-hash whatever the alias looks like', () => {
  assert.match(auth.generateLabeledKey('Novia', 'lifetime'), keyFormat('novia', 'lifetime'));
  assert.match(auth.generateLabeledKey('bubulubu_gang', 'yearly'), keyFormat('bubulubu_gang', 'yearly')); // an alias that was already valid is untouched
  // The username of a license made by the admin is free text: it must never put spaces or accents in a key.
  assert.match(auth.generateLabeledKey('María López', 'monthly'), keyFormat('marialopez', 'monthly'));
  assert.match(auth.generateLabeledKey('@@@ !!!', 'monthly'), keyFormat('user', 'monthly'));
  assert.match(auth.generateLabeledKey('', 'monthly'), keyFormat('user', 'monthly'));
  assert.match(auth.generateLabeledKey(undefined, 'monthly'), keyFormat('user', 'monthly'));
  assert.equal(auth.generateLabeledKey('x'.repeat(60), 'lifetime').split('-lifetime-')[0].length, 40);
  assert.notEqual(auth.generateLabeledKey('novia', 'lifetime'), auth.generateLabeledKey('novia', 'lifetime'));
});

function adminRoutes({ existing = {} } = {}) {
  const routes = {};
  const events = { inserted: [], keySets: [], logs: [], audited: [], cleaned: [], revoked: [], deleted: [] };
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const context = vm.createContext({
    app: {
      post: (path, ...handlers) => { routes[path] = handlers.at(-1); },
      delete: (path, ...handlers) => { routes[`DELETE ${path}`] = handlers.at(-1); },
    },
    auth, crypto, adminLimiter: null,
    // The admin history and the storage cleanup are stubs here: each has its own tests.
    // Plain data again, so deepEqual compares them across the vm boundary.
    audit: (req, action, target, details) => events.audited.push({ admin: req.license.username, action, target: { ...target }, details: details ? { ...details } : null }),
    cleanLicenseFiles: (licenseId) => events.cleaned.push(licenseId),
    db: {
      insertLicense: async (row) => {
        events.inserted.push(row);
        return { id: row.id, username: row.username, license_type: row.licenseType, created_at: row.createdAt, expires_at: row.expiresAt, spotify_addon: row.spotifyAddon };
      },
      findById: async (id) => existing[id],
      // Objects built inside the vm carry that realm's Object.prototype: clone them so deepEqual compares plain data.
      setLicenseKey: async (id, keys) => { events.keySets.push([id, { ...keys }]); },
      revoke: async (id) => { events.revoked.push(id); },
      deleteLicense: async (id) => { events.deleted.push(id); },
    },
    console: { log: (...args) => events.logs.push(args.join(' ')) },
  });
  const run = (from, to) => vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to)), context);
  run('const VALID_LICENSE_TYPES', '// Formato de email valido'); // the license types, Color Says levels and key labels
  run("app.post('/api/licenses', auth.requireAuth", "app.post('/api/licenses/:id/revoke'"); // create + regenerate
  run("app.delete('/api/licenses/:id', auth.requireAuth", '// PRECIOS DE LICENCIAS'); // delete + bulk delete
  const call = async (path, { body = {}, params = {}, license = { username: 'notbenjaa1' } } = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = JSON.parse(JSON.stringify(payload)); } };
    await routes[path]({ body, params, license }, res);
    return res;
  };
  return { call, events };
}

test('licenses created from the panel get an alias-tier-hash key, with the tier of their license type', async () => {
  const labels = { day: 'daily', week: 'weekly', month: 'monthly', annual: 'yearly', lifetime: 'lifetime' };
  for (const [licenseType, label] of Object.entries(labels)) {
    const { call, events } = adminRoutes();
    const res = await call('/api/licenses', { body: { username: 'Novia', licenseType } });
    assert.equal(res.statusCode, 200, licenseType);
    assert.match(res.body.key, keyFormat('novia', label), licenseType);
    const row = events.inserted[0];
    assert.equal(row.keyHash, auth.hashKey(res.body.key), 'only the hash of the key is stored');
    assert.equal(row.keyPrefix, res.body.key.slice(0, 8));
    assert.equal(row.username, 'Novia'); // the name shown in the panel keeps what the admin typed
    assert.ok(!JSON.stringify(row).includes(res.body.key), 'the raw key never reaches the database');
  }
});

test('a license can be created with the Spotify add-on (a Monthly, for instance); it is off unless asked for', async () => {
  const withAddon = adminRoutes();
  const created = await withAddon.call('/api/licenses', { body: { username: 'mensual', licenseType: 'month', spotifyAddon: true } });
  assert.equal(created.statusCode, 200);
  assert.equal(withAddon.events.inserted[0].spotifyAddon, true);
  assert.equal(created.body.license.spotifyAddon, true);

  for (const body of [{ username: 'a', licenseType: 'month' }, { username: 'a', licenseType: 'month', spotifyAddon: false }]) {
    const plain = adminRoutes();
    const res = await plain.call('/api/licenses', { body });
    assert.equal(plain.events.inserted[0].spotifyAddon, false);
    assert.equal(res.body.license.spotifyAddon, false);
  }
  for (const spotifyAddon of ['true', 1, null, {}]) {
    const bad = adminRoutes();
    const res = await bad.call('/api/licenses', { body: { username: 'a', licenseType: 'month', spotifyAddon } });
    assert.equal(res.statusCode, 400, JSON.stringify(spotifyAddon));
    assert.equal(bad.events.inserted.length, 0);
  }
});

test('creating a license still validates the username, the type and the Color Says level', async () => {
  for (const body of [{ licenseType: 'month' }, { username: '   ', licenseType: 'month' }, { username: 'a', licenseType: 'forever' }, { username: 'a', licenseType: 'month', diceTier: 'gold' }]) {
    const { call, events } = adminRoutes();
    const res = await call('/api/licenses', { body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(events.inserted.length, 0);
  }
});

test('regenerating a key gives an alias-tier-hash key that replaces the old one', async () => {
  const existing = {
    lifetime: { id: 'lifetime', username: 'novia', license_type: 'lifetime', is_admin: false },
    month: { id: 'month', username: 'beto', license_type: 'month', is_admin: false },
    trial: { id: 'trial', username: 'cleo', license_type: 'trial', is_admin: false },
    odd: { id: 'odd', username: 'dani', license_type: 'Legacy', is_admin: false },
  };
  const { call, events } = adminRoutes({ existing });
  const path = '/api/licenses/:id/regenerate-key';

  const lifetime = await call(path, { params: { id: 'lifetime' } });
  assert.equal(lifetime.statusCode, 200);
  assert.match(lifetime.body.key, keyFormat('novia', 'lifetime'));
  assert.deepEqual(lifetime.body.license, { id: 'lifetime', username: 'novia' });
  assert.deepEqual(events.keySets[0], ['lifetime', { keyHash: auth.hashKey(lifetime.body.key), keyPrefix: lifetime.body.key.slice(0, 8) }]);

  assert.match((await call(path, { params: { id: 'month' } })).body.key, keyFormat('beto', 'monthly'));
  assert.match((await call(path, { params: { id: 'trial' } })).body.key, keyFormat('cleo', 'FREE7DAY'));
  assert.match((await call(path, { params: { id: 'odd' } })).body.key, keyFormat('dani', 'legacy')); // a type with no label falls back to itself

  const again = await call(path, { params: { id: 'lifetime' } });
  assert.notEqual(again.body.key, lifetime.body.key);
  assert.notEqual(auth.hashKey(again.body.key), auth.hashKey(lifetime.body.key), 'the previous key stops matching');

  assert.ok(events.logs.length >= 1 && events.logs.every((line) => !line.includes(lifetime.body.key)), 'the log names who regenerated what, never the key');
  assert.match(events.logs[0], /notbenjaa1/);
});

test('creating and regenerating leave a line in the admin history: who, on which license, and never the key', async () => {
  const { call, events } = adminRoutes({ existing: { lic: { id: 'lic', username: 'novia', license_type: 'month', is_admin: false } } });
  const created = await call('/api/licenses', { body: { username: 'Novia', licenseType: 'month', spotifyAddon: true } });
  const regenerated = await call('/api/licenses/:id/regenerate-key', { params: { id: 'lic' } });
  assert.deepEqual(events.audited.map((entry) => entry.action), ['license.create', 'license.regenerate_key']);
  assert.deepEqual(events.audited[0], {
    admin: 'notbenjaa1', action: 'license.create', target: { id: created.body.license.id, label: 'Novia' },
    details: { licenseType: 'month', diceTier: 'regular', spotifyAddon: true },
  });
  assert.deepEqual(events.audited[1].target, { id: 'lic', label: 'novia' });
  const written = JSON.stringify(events.audited);
  assert.ok(!written.includes(created.body.key) && !written.includes(regenerated.body.key), 'the history never holds a key');
});

test('refused requests are not written to the admin history', async () => {
  const { call, events } = adminRoutes({ existing: { adm: { id: 'adm', username: 'notbenjaa1', license_type: 'lifetime', is_admin: true } } });
  await call('/api/licenses', { body: { username: 'a', licenseType: 'forever' } });
  await call('/api/licenses/:id/regenerate-key', { params: { id: 'adm' } });
  await call('/api/licenses/:id/regenerate-key', { params: { id: 'nope' } });
  assert.deepEqual(events.audited, []);
});

test('deleting a license, one or several, also cleans its storage files and leaves a history line', async () => {
  const existing = {
    a: { id: 'a', username: 'ana', license_type: 'month', is_admin: false, revoked: false },
    b: { id: 'b', username: 'beto', license_type: 'annual', is_admin: false, revoked: true },
    adm: { id: 'adm', username: 'notbenjaa1', license_type: 'lifetime', is_admin: true, revoked: false },
  };
  const single = adminRoutes({ existing });
  const one = await single.call('DELETE /api/licenses/:id', { params: { id: 'a' } });
  assert.equal(one.statusCode, 200);
  assert.deepEqual(single.events.revoked, ['a'], 'an active license is revoked first');
  assert.deepEqual(single.events.deleted, ['a']);
  assert.deepEqual(single.events.cleaned, ['a']);
  assert.deepEqual(single.events.audited, [{ admin: 'notbenjaa1', action: 'license.delete', target: { id: 'a', label: 'ana' }, details: null }]);

  const refused = adminRoutes({ existing });
  assert.equal((await refused.call('DELETE /api/licenses/:id', { params: { id: 'adm' } })).statusCode, 400);
  assert.equal((await refused.call('DELETE /api/licenses/:id', { params: { id: 'nope' } })).statusCode, 404);
  assert.deepEqual([refused.events.deleted, refused.events.cleaned, refused.events.audited], [[], [], []], 'nothing is touched when the request is refused');

  const bulk = adminRoutes({ existing });
  const many = await bulk.call('/api/licenses/bulk-delete', { body: { ids: ['a', 'b', 'adm', 'nope', 'a'] } });
  assert.deepEqual(many.body, { success: true, deleted: 2, skipped: 2 });
  assert.deepEqual(bulk.events.cleaned, ['a', 'b'], 'only the licenses that were really deleted lose their files');
  assert.deepEqual(bulk.events.audited, [{ admin: 'notbenjaa1', action: 'license.bulk_delete', target: {}, details: { deleted: 2, skipped: 2 } }]);
});

test('regenerating refuses the admin license and a license that does not exist, and writes nothing', async () => {
  const { call, events } = adminRoutes({ existing: { adm: { id: 'adm', username: 'notbenjaa1', license_type: 'lifetime', is_admin: true } } });
  const admin = await call('/api/licenses/:id/regenerate-key', { params: { id: 'adm' } });
  assert.equal(admin.statusCode, 400);
  assert.match(admin.body.error, /seed-admin/);
  assert.equal(admin.body.key, undefined);
  const missing = await call('/api/licenses/:id/regenerate-key', { params: { id: 'nope' } });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(events.keySets, []);
});
