const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// The read-only overlay token (the OBS link no longer carries the license key), the socket handshake and the
// session/state JWTs. auth.js is the real module; the database is a stub, the same way the other test files do it.

process.env.JWT_SECRET = 'test-jwt-secret-for-tokens';
process.env.KEY_HASH_SECRET = 'test-key-hash-secret-for-tokens';
delete process.env.OVERLAY_LEGACY_KEYS;

const dbPath = require.resolve('./db');
const rows = new Map();
const dbCalls = { findById: 0, findByKeyHash: 0 };
const dbStub = {
    findById: async (id) => { dbCalls.findById++; return rows.get(id); },
    findByKeyHash: async (hash) => { dbCalls.findByKeyHash++; return [...rows.values()].find((r) => r.key_hash === hash); },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
const auth = require('./auth');

const makeRow = (over = {}) => ({
    id: 'a1b2c3d4-0000-4000-8000-000000000001', key_hash: 'hash-one', key_prefix: 'alice-MO', username: 'alice', license_type: 'month',
    is_admin: false, revoked: false, expires_at: null, session_id: 'sid-1', multi_device: false, ...over,
});
const seed = (row) => { rows.set(row.id, row); return row; };
const handshake = (authPayload) => new Promise((resolve) => {
    const socket = { handshake: { auth: authPayload } };
    auth.socketAuthMiddleware(socket, (err) => resolve({ err, socket }));
});

test('the overlay token is stable, is not the license key and differs per license and per key', () => {
    const row = makeRow();
    const token = auth.overlayTokenFor(row);
    assert.match(token, /^ovl\.[\w-]{1,64}\.[A-Za-z0-9_-]{32}$/);
    assert.equal(auth.overlayTokenFor(row), token, 'same license and key, same token');
    assert.ok(!token.includes(row.key_hash), 'the token never carries the stored key hash');
    assert.notEqual(auth.overlayTokenFor(makeRow({ id: 'other-id' })), token);
    assert.notEqual(auth.overlayTokenFor(makeRow({ key_hash: 'hash-two' })), token, 'a regenerated key changes the token');
});

test('renewing the overlay links changes the token, and a license never renewed keeps the token it already had', () => {
    const row = makeRow();
    const original = auth.overlayTokenFor(row);
    // Links copied into OBS before renewals existed were made without an epoch: they must stay valid.
    for (const epoch of [0, '0', null, undefined, NaN, 'abc', -0]) {
        assert.equal(auth.overlayTokenFor({ ...row, overlay_epoch: epoch }), original, String(epoch));
    }
    const first = auth.overlayTokenFor({ ...row, overlay_epoch: 1 });
    const second = auth.overlayTokenFor({ ...row, overlay_epoch: 2 });
    assert.equal(new Set([original, first, second]).size, 3, 'every renewal gives a different link');
    assert.equal(auth.overlayTokenFor({ ...row, overlay_epoch: '1' }), first, 'the database may hand the number back as text');
    assert.match(first, /^ovl\.[\w-]{1,64}\.[A-Za-z0-9_-]{32}$/, 'same shape, so old and new links parse the same way');
});

test('after renewing, the previous link stops working and the new one works, while the login key is untouched', async () => {
    const raw = 'carol-MONTH-rawkey22222';
    const row = seed(makeRow({ id: 'lic-rot', key_hash: auth.hashKey(raw) }));
    const before = auth.overlayTokenFor(row);
    assert.ok(await auth.resolveFromOverlayToken(before));
    assert.equal((await handshake({ licenseKey: before })).err, undefined);

    rows.set(row.id, { ...row, overlay_epoch: 1 });
    const after = auth.overlayTokenFor(rows.get(row.id));
    assert.notEqual(after, before);
    assert.equal(await auth.resolveFromOverlayToken(before), null, 'the old link is dead');
    assert.equal((await handshake({ licenseKey: before })).err?.message, 'unauthorized', 'and cannot open a socket either');
    assert.equal((await auth.resolveFromOverlayToken(after)).id, row.id, 'the new link works');
    const fresh = await handshake({ licenseKey: after });
    assert.equal(fresh.err, undefined);
    assert.equal(fresh.socket.authMethod, 'overlay');

    // Renewing the links is not changing the key: logging in with it, and the panel session, go on as before.
    assert.equal((await auth.resolveFromRawKey(raw)).id, row.id);
    const session = await handshake({ token: auth.signSession(rows.get(row.id), row.session_id) });
    assert.equal(session.err, undefined);
    assert.equal(session.socket.authMethod, 'jwt');

    // Renewing again kills the previous renewal too.
    rows.set(row.id, { ...row, overlay_epoch: 2 });
    assert.equal(await auth.resolveFromOverlayToken(after), null);
});

test('a valid overlay token resolves to its license, and anything altered does not', async () => {
    const row = seed(makeRow());
    const token = auth.overlayTokenFor(row);
    assert.equal((await auth.resolveFromOverlayToken(token)).id, row.id);

    const [prefix, id, mac] = token.split('.');
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [
        `${prefix}.${id}.${flipped}`, `${prefix}.${id}.`, `${prefix}.${id}`, `${prefix}..${mac}`, 'ovl.', 'ovl.x.y',
        `${prefix}.unknown-id.${mac}`, token.toUpperCase(), ` ${token}`, `${token}x`, '', undefined, null, 42,
    ]) {
        assert.equal(await auth.resolveFromOverlayToken(bad), null, String(bad));
    }
});

test('an overlay token stops working when the license is revoked or expired, or its key is regenerated', async () => {
    const row = seed(makeRow({ id: 'lic-life', key_hash: 'k1' }));
    const token = auth.overlayTokenFor(row);
    assert.ok(await auth.resolveFromOverlayToken(token));
    rows.set(row.id, { ...row, revoked: true });
    assert.equal(await auth.resolveFromOverlayToken(token), null, 'revoked');
    rows.set(row.id, { ...row, expires_at: Date.now() - 1000 });
    assert.equal(await auth.resolveFromOverlayToken(token), null, 'expired');
    rows.set(row.id, { ...row, key_hash: 'k2' });
    assert.equal(await auth.resolveFromOverlayToken(token), null, 'key regenerated');
    rows.set(row.id, row);
    assert.ok(await auth.resolveFromOverlayToken(token), 'valid again once restored');
});

test('the socket handshake marks the kind of connection: session, overlay token, or the old raw key', async () => {
    const row = seed(makeRow({ id: 'lic-hs', key_hash: auth.hashKey('alice-MONTH-rawkey12345') }));

    const overlay = await handshake({ licenseKey: auth.overlayTokenFor(row), overlayScreen: 'alerts' });
    assert.equal(overlay.err, undefined);
    assert.equal(overlay.socket.authMethod, 'overlay');
    assert.equal(overlay.socket.licenseId, row.id);

    const legacy = await handshake({ licenseKey: 'alice-MONTH-rawkey12345' });
    assert.equal(legacy.err, undefined);
    assert.equal(legacy.socket.authMethod, 'key', 'links made before the token keep working');

    const session = await handshake({ token: auth.signSession(row, row.session_id) });
    assert.equal(session.err, undefined);
    assert.equal(session.socket.authMethod, 'jwt');
});

test('the socket handshake rejects a bad token, a wrong key, non-text values and giant values without touching the database', async () => {
    seed(makeRow({ id: 'lic-bad', key_hash: 'x' }));
    const before = { ...dbCalls };
    for (const payload of [
        {}, undefined, { licenseKey: '' }, { licenseKey: 'ovl.' + 'a'.repeat(500) }, { licenseKey: 'k'.repeat(301) },
        { licenseKey: { $ne: 1 } }, { licenseKey: ['a'] }, { licenseKey: 12345 }, { token: 'no-es-un-jwt' },
    ]) {
        const { err } = await handshake(payload);
        assert.equal(err?.message, 'unauthorized', JSON.stringify(payload));
    }
    assert.equal(dbCalls.findById, before.findById, 'junk never reaches the database by id');
    assert.equal(dbCalls.findByKeyHash, before.findByKeyHash, 'junk never reaches the database by key');

    const wrong = await handshake({ licenseKey: auth.overlayTokenFor(makeRow({ id: 'lic-bad', key_hash: 'not-the-stored-one' })) });
    assert.equal(wrong.err?.message, 'unauthorized');
});

test('OVERLAY_LEGACY_KEYS=off closes the old raw-key links but keeps the overlay token', async () => {
    const row = seed(makeRow({ id: 'lic-off', key_hash: auth.hashKey('bob-MONTH-rawkey00000') }));
    process.env.OVERLAY_LEGACY_KEYS = 'off';
    try {
        assert.equal((await handshake({ licenseKey: 'bob-MONTH-rawkey00000' })).err?.message, 'unauthorized');
        assert.equal((await handshake({ licenseKey: auth.overlayTokenFor(row) })).err, undefined);
    } finally {
        delete process.env.OVERLAY_LEGACY_KEYS;
    }
});

test('session tokens carry their type, and a token made for another purpose is not a session', async () => {
    const row = seed(makeRow({ id: 'lic-jwt', session_id: 'sid-jwt' }));
    const session = auth.signSession(row, 'sid-jwt');
    assert.equal(jwt.decode(session).typ, 'session');
    assert.equal((await auth.checkTokenStatus(session)).row.id, row.id);

    // Sessions issued before `typ` existed still work.
    const legacy = jwt.sign({ sub: row.id, sid: 'sid-jwt', username: 'alice' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await auth.checkTokenStatus(legacy)).row.id, row.id);

    const state = auth.signSpotifyState(row.id);
    await assert.rejects(() => auth.checkTokenStatus(state), /Tipo de token inválido/, 'a Spotify state is not a session');
    assert.throws(() => auth.verifySession(state), /Tipo de token inválido/);
});

test('the Spotify state only opens the callback, and only within its own type', () => {
    const state = auth.signSpotifyState('lic-1');
    assert.equal(jwt.decode(state).typ, 'spotify_state');
    assert.equal(auth.verifySpotifyState(state), 'lic-1');
    const row = makeRow();
    assert.throws(() => auth.verifySpotifyState(auth.signSession(row, 'sid')), /Tipo de token inválido/, 'a months-long session is not a state');
    assert.throws(() => auth.verifySpotifyState(jwt.sign({ licenseId: 'lic-1' }, process.env.JWT_SECRET)), /Tipo de token inválido/, 'the old state without a type is not accepted');
    assert.throws(() => auth.verifySpotifyState(jwt.sign({ typ: 'spotify_state' }, process.env.JWT_SECRET)), /Tipo de token inválido/, 'a state without a license is not accepted');
    assert.throws(() => auth.verifySpotifyState('basura'));
});

test('tokens with another algorithm, no signature or another secret are rejected', () => {
    const payload = { typ: 'session', sub: 'lic-1', sid: 's' };
    assert.throws(() => auth.verifySession(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS512' })), /invalid algorithm/);
    assert.throws(() => auth.verifySession(jwt.sign(payload, 'otro-secreto')), /invalid signature/);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    assert.throws(() => auth.verifySession(none));
    assert.throws(() => auth.verifySpotifyState(jwt.sign({ typ: 'spotify_state', licenseId: 'x' }, process.env.JWT_SECRET, { algorithm: 'HS384' })), /invalid algorithm/);
});
