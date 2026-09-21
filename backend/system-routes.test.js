const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerSystemRoutes } = require('./routes/system');

// The operation and admin routes (health, error reports, history, server status, storage, payments) mounted on a
// real Express app with fake pieces behind them, and called over real HTTP: parsers, limiters and status codes
// included. auth and the database are fakes; the routes, their limits and their checks are the real ones.

const HOUR = 60 * 60 * 1000;

function build(overrides = {}) {
  const calls = { audit: [], records: [], auditQueries: [], inserted: [], resolved: [], applyRetry: [], applyStripe: [], deleted: [], cleared: 0 };
  const licenses = overrides.licenses || [
    { id: 'lic-ana', username: 'ana' }, { id: 'lic-beto', username: 'beto' }, { id: 'admin-id', username: 'notbenjaa1' },
  ];
  const db = {
    listAll: async () => licenses,
    findById: async (id) => licenses.find((license) => license.id === id),
    listErrorReports: async () => overrides.errorRows || [],
    countErrorReportsSince: async () => (overrides.countThrows ? Promise.reject(new Error('db down')) : { distinct: 2, occurrences: 7 }),
    clearErrorReports: async () => 5,
    listAuditLog: async (query) => { calls.auditQueries.push(query); return overrides.auditRows || []; },
    listReferencedMediaPaths: async () => new Set(overrides.referenced || []),
    listPaymentFailures: async () => overrides.failures || [],
    listPaymentsWithoutLicense: async () => overrides.withoutLicense || [],
    listStripePaymentIdsSince: async () => overrides.knownStripe || [],
    getPaymentFailure: async (id) => (overrides.failures || []).find((failure) => failure.id === id),
    insertPaymentIfNew: async (row) => { calls.inserted.push(['mp', row]); return true; },
    insertStripePaymentIfNew: async (row) => { calls.inserted.push(['stripe', row]); return true; },
    resolvePaymentFailure: async (id, by) => { calls.resolved.push([id, by]); },
    ...overrides.db,
  };
  const tokens = { admin: { id: 'admin-id', username: 'notbenjaa1', admin: true }, user: { id: 'lic-ana', username: 'ana', admin: false } };
  const auth = {
    requireAuth: (req, res, next) => {
      const who = tokens[(req.headers.authorization || '').replace('Bearer ', '')];
      if (!who) return res.status(401).json({ success: false, error: 'No autenticado' });
      req.license = { id: who.id, username: who.username };
      req.isAdmin = who.admin;
      next();
    },
    requireAdmin: (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ success: false, error: 'Requiere licencia de administrador' })),
    checkTokenStatus: async (token) => { if (!tokens[token]) throw new Error('jwt malformed'); return { row: { id: tokens[token].id } }; },
  };
  const storage = {
    isConfigured: () => overrides.storageConfigured !== false,
    listAllFiles: async () => { if (overrides.storageFails) throw new Error('supabase secret key sb_secret_123 rejected'); return overrides.listing || { files: [], truncated: false }; },
    deleteFiles: async (paths) => { calls.deleted.push(paths); return overrides.deleteResult ? overrides.deleteResult(paths) : { deleted: paths.length, failed: 0 }; },
  };
  const deps = {
    auth, db, storage,
    io: { engine: { clientsCount: 3 } },
    tenants: new Map([['a', {}], ['b', {}]]),
    errorReporter: { record: async (raw, meta) => { calls.records.push({ raw, meta }); return overrides.accepted !== false; }, stats: () => ({ written: 4, dropped: 1 }) },
    healthChecker: { check: async () => overrides.health || { ok: true, db: { ok: true, latencyMs: 12 }, checkedAt: Date.now() } },
    getStripeClient: () => overrides.stripe,
    applyPaymentWithRetry: async (args) => { calls.applyRetry.push(args); if (overrides.applyThrows) throw new Error('db down (password=hunter2)'); return overrides.applyResult || { applied: true }; },
    applyApprovedStripePaymentIfNew: async (args) => { calls.applyStripe.push(args); return overrides.stripeApplyResult || { applied: true }; },
    audit: (req, action, target, details) => calls.audit.push({ admin: req.license.username, action, target: { ...target }, details }),
    bootId: 'boot-1',
  };
  return { deps, calls };
}

async function start(overrides = {}) {
  const { deps, calls } = build(overrides);
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  registerSystemRoutes(app, deps);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { token, body, type = 'application/json', headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': type } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
  return { request, calls, deps, close };
}

// Every test starts its own server; this keeps the cleanup one line.
async function withServer(overrides, run) {
  const server = await start(overrides);
  const quiet = console.error;
  console.error = () => {};
  try { await run(server); } finally { console.error = quiet; await server.close(); }
}

test('every admin route needs a session, and then an admin one', async () => {
  const adminRoutes = [
    ['GET', '/api/admin/errors'], ['DELETE', '/api/admin/errors'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/system'],
    ['GET', '/api/admin/storage'], ['POST', '/api/admin/storage/cleanup'], ['GET', '/api/admin/payments/reconcile'],
    ['POST', '/api/admin/payments/failures/f1/apply'], ['POST', '/api/admin/payments/stripe/apply'],
  ];
  await withServer({}, async ({ request, calls }) => {
    for (const [method, path] of adminRoutes) {
      assert.equal((await request(method, path)).status, 401, `${method} ${path} without a session`);
      assert.equal((await request(method, path, { token: 'nope' })).status, 401, `${method} ${path} with a bad token`);
      assert.equal((await request(method, path, { token: 'user' })).status, 403, `${method} ${path} as a regular license`);
    }
    assert.deepEqual([calls.audit, calls.deleted, calls.inserted, calls.applyRetry, calls.applyStripe], [[], [], [], [], []], 'nothing ran');
  });
});

test('/health/deep answers 200 when the database responds and 503 when it does not, without saying why', async () => {
  await withServer({}, async ({ request }) => {
    const up = await request('GET', '/health/deep');
    assert.equal(up.status, 200);
    assert.deepEqual([up.json.ok, up.json.db, up.json.dbLatencyMs], [true, 'ok', 12]);
    assert.equal(typeof up.json.uptimeSeconds, 'number');
    assert.equal(up.headers.get('cache-control'), 'no-store');
  });
  await withServer({ health: { ok: false, db: { ok: false, latencyMs: 2001, reason: 'tiempo de espera agotado' }, checkedAt: 0 } }, async ({ request }) => {
    const down = await request('GET', '/health/deep');
    assert.equal(down.status, 503);
    assert.deepEqual([down.json.ok, down.json.db], [false, 'down']);
    assert.ok(!('reason' in down.json) && !down.text.includes('espera'), 'the reason stays in the server log');
  });
});

test('a browser error report is accepted with no session, and tied to a license when the session is valid', async () => {
  await withServer({}, async ({ request, calls }) => {
    const report = { kind: 'render', message: 'Cannot read properties of undefined', stack: 'at f (a.js:1:1)', context: 'https://app.test/panel?key=x', ignored: 'field' };
    assert.equal((await request('POST', '/api/client-errors', { body: report, headers: { 'User-Agent': 'TestBrowser/1.0' } })).status, 204);
    assert.deepEqual(calls.records[0].meta, { source: 'frontend', licenseId: null });
    assert.deepEqual(calls.records[0].raw, { kind: 'render', message: 'Cannot read properties of undefined', stack: 'at f (a.js:1:1)', context: 'https://app.test/panel?key=x', userAgent: 'TestBrowser/1.0' });
    assert.ok(!('ignored' in calls.records[0].raw), 'only the known fields are passed on');

    await request('POST', '/api/client-errors', { body: report, token: 'user' });
    assert.equal(calls.records[1].meta.licenseId, 'lic-ana');
    await request('POST', '/api/client-errors', { body: report, token: 'expired-garbage' });
    assert.equal(calls.records[2].meta.licenseId, null, 'a bad session does not stop the report');
  });
});

test('a report that is discarded is answered 202, and a body that is not an object is not trusted', async () => {
  await withServer({ accepted: false }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/api/client-errors', { body: { message: 'x' } })).status, 202);
    assert.equal((await request('POST', '/api/client-errors', { body: '"just a string"' })).status, 400, 'the JSON parser itself refuses a bare string');
    assert.equal((await request('POST', '/api/client-errors', { body: [1, 2] })).status, 202);
    assert.equal((await request('POST', '/api/client-errors', {})).status, 202);
    const { raw } = calls.records.at(-1);
    assert.deepEqual([raw.kind, raw.message, raw.stack, raw.context], [undefined, undefined, undefined, undefined], 'nothing is taken from a list or from no body');
    assert.equal(calls.records.length, 3, 'the refused string never reached the reporter');
  });
});

test('error reports are limited per address, so a looping page cannot flood the server', async () => {
  await withServer({}, async ({ request }) => {
    let last;
    for (let i = 0; i < 40; i++) last = await request('POST', '/api/client-errors', { body: { message: 'x' } });
    assert.equal(last.status, 204, 'the 40th still gets through');
    assert.equal((await request('POST', '/api/client-errors', { body: { message: 'x' } })).status, 429);
  });
});

test('a content security policy report is accepted in the old and in the new browser formats', async () => {
  await withServer({}, async ({ request, calls }) => {
    const legacy = { 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js', 'document-uri': 'https://app.test/' } };
    assert.equal((await request('POST', '/api/csp-report', { body: legacy, type: 'application/csp-report' })).status, 204);
    assert.equal(calls.records[0].raw.message, 'script-src-elem habría bloqueado evil.example');
    assert.deepEqual(calls.records[0].meta, { source: 'csp' });

    const modern = [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'inline', disposition: 'report' } }];
    assert.equal((await request('POST', '/api/csp-report', { body: modern, type: 'application/reports+json' })).status, 204);
    assert.equal(calls.records[1].raw.message, 'img-src habría bloqueado inline');
    assert.equal((await request('POST', '/api/csp-report', { body: legacy })).status, 204, 'plain JSON works too');
  });
});

test('a huge policy report is refused instead of being read', async () => {
  await withServer({}, async ({ request, calls }) => {
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(40 * 1024) } });
    const res = await request('POST', '/api/csp-report', { body: big, type: 'application/csp-report' });
    assert.equal(res.status, 413);
    assert.equal(calls.records.length, 0);
  });
});

test('the error list shows who it happened to, how often and when, and says so when the license is gone', async () => {
  const errorRows = [
    { id: 'e1', source: 'frontend', kind: 'render', message: 'boom', stack: 'at f', context: 'https://app.test/panel', user_agent: 'UA', license_id: 'lic-ana', occurrences: '12', first_seen: '1000', last_seen: '2000' },
    { id: 'e2', source: 'backend', kind: 'http', message: 'db', stack: null, context: 'GET /api/x', user_agent: null, license_id: 'lic-deleted', occurrences: null, first_seen: 5, last_seen: 6 },
    { id: 'e3', source: 'csp', kind: 'csp', message: 'script-src habría bloqueado x', stack: null, context: null, user_agent: null, license_id: null, occurrences: 1, first_seen: 7, last_seen: 8 },
  ];
  await withServer({ errorRows }, async ({ request }) => {
    const res = await request('GET', '/api/admin/errors', { token: 'admin' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.last24h, { distinct: 2, occurrences: 7 });
    assert.deepEqual(res.json.errors.map((e) => [e.id, e.license, e.occurrences, e.firstSeen, e.lastSeen]), [
      ['e1', 'ana', 12, 1000, 2000], ['e2', '(eliminada)', 1, 5, 6], ['e3', null, 1, 7, 8],
    ]);
    assert.equal(res.json.errors[0].userAgent, 'UA');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('clearing the error list says how many went and leaves a history line', async () => {
  await withServer({}, async ({ request, calls }) => {
    const res = await request('DELETE', '/api/admin/errors', { token: 'admin' });
    assert.deepEqual(res.json, { success: true, removed: 5 });
    assert.deepEqual(calls.audit, [{ admin: 'notbenjaa1', action: 'errors.clear', target: {}, details: { removed: 5 } }]);
  });
});

test('a database failure in the admin lists is a generic 500, never the internal message', async () => {
  const db = { listErrorReports: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); }, listAuditLog: async () => { throw new Error('relation "admin_audit" does not exist'); }, clearErrorReports: async () => { throw new Error('boom'); } };
  await withServer({ db }, async ({ request }) => {
    for (const [method, path] of [['GET', '/api/admin/errors'], ['GET', '/api/admin/audit'], ['DELETE', '/api/admin/errors']]) {
      const res = await request(method, path, { token: 'admin' });
      assert.equal(res.status, 500, path);
      assert.ok(!res.text.includes('10.0.0.5') && !res.text.includes('admin_audit') && !res.text.includes('boom'), path);
    }
  });
});

test('the history is paged newest first, its limit is capped, and the stored details come back as data', async () => {
  const auditRows = [
    { id: 'a1', at: '3000', admin_username: 'notbenjaa1', action: 'license.create', target_license_id: 'lic-ana', target_label: 'ana', details: '{"licenseType":"month"}' },
    { id: 'a2', at: 2000, admin_username: 'notbenjaa1', action: 'license.delete', target_license_id: null, target_label: null, details: null },
    { id: 'a3', at: 1000, admin_username: 'notbenjaa1', action: 'x', target_license_id: null, target_label: null, details: '{broken json' },
  ];
  await withServer({ auditRows }, async ({ request, calls }) => {
    const res = await request('GET', '/api/admin/audit', { token: 'admin' });
    assert.deepEqual(res.json.entries.map((e) => [e.id, e.at, e.details]), [['a1', 3000, { licenseType: 'month' }], ['a2', 2000, null], ['a3', 1000, null]]);
    assert.deepEqual(res.json.entries[0], { id: 'a1', at: 3000, admin: 'notbenjaa1', action: 'license.create', targetLicenseId: 'lic-ana', target: 'ana', details: { licenseType: 'month' } });
    for (const [query, expected] of [['', { limit: 100, before: null }], ['?limit=9999', { limit: 200, before: null }], ['?limit=-5', { limit: 1, before: null }], ['?limit=abc&before=abc', { limit: 100, before: null }], ['?limit=25&before=1234', { limit: 25, before: 1234 }]]) {
      await request('GET', `/api/admin/audit${query}`, { token: 'admin' });
      assert.deepEqual(calls.auditQueries.at(-1), expected, query);
    }
  });
});

test('the system status shows uptime, connections, memory and the errors of the last day, and survives a database that is down', async () => {
  await withServer({}, async ({ request }) => {
    const { json } = await request('GET', '/api/admin/system', { token: 'admin' });
    const { system } = json;
    assert.equal(json.success, true);
    assert.deepEqual([system.bootId, system.tenants, system.sockets, system.storageConfigured], ['boot-1', 2, 3, true]);
    assert.deepEqual(system.db, { ok: true, latencyMs: 12 });
    assert.deepEqual(system.errors24h, { distinct: 2, occurrences: 7 });
    assert.deepEqual(system.reporter, { written: 4, dropped: 1 });
    assert.ok(system.memoryMb.rss > 0 && system.memoryMb.heapUsed > 0);
    assert.equal(system.node, process.version);
  });
  await withServer({ countThrows: true, health: { ok: false, db: { ok: false, latencyMs: 5, reason: 'sin conexión' }, checkedAt: 0 } }, async ({ request }) => {
    const { json } = await request('GET', '/api/admin/system', { token: 'admin' });
    assert.equal(json.success, true, 'the panel still loads');
    assert.deepEqual(json.system.errors24h, { distinct: 0, occurrences: 0 });
    assert.equal(json.system.db.ok, false);
  });
});

// ── Storage ──

const file = (path, { hoursOld = 48, size = 1000 } = {}) => ({ path, size, createdAt: Date.now() - hoursOld * HOUR });

test('the storage scan reports totals, who uses the most and which files are orphans, and never the recent ones', async () => {
  const listing = { files: [
    file('lic-ana/used.png', { size: 5000 }), file('lic-ana/stray.mp3', { size: 2000 }), file('gone-lic/old.gif', { size: 9000 }),
    file('lic-beto/just-now.png', { hoursOld: 0.1, size: 100 }),
  ], truncated: false };
  await withServer({ listing, referenced: ['lic-ana/used.png'] }, async ({ request }) => {
    const res = await request('GET', '/api/admin/storage', { token: 'admin' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.totals, { files: 4, bytes: 16100, orphans: 2, orphanBytes: 11000 });
    assert.deepEqual(res.json.orphans.map((o) => o.path).sort(), ['gone-lic/old.gif', 'lic-ana/stray.mp3']);
    assert.deepEqual(res.json.top.map((t) => [t.license, t.bytes]), [['(licencia eliminada)', 9000], ['ana', 7000], ['beto', 100]]);
    assert.equal(res.json.truncated, false);
    assert.equal(res.json.configured, true);
  });
});

test('the storage scan shows at most 50 orphans but counts them all, and flags an incomplete listing', async () => {
  const files = Array.from({ length: 80 }, (_, i) => file(`lic-ana/f${i}.png`));
  await withServer({ listing: { files, truncated: true } }, async ({ request }) => {
    const res = await request('GET', '/api/admin/storage', { token: 'admin' });
    assert.equal(res.json.orphans.length, 50);
    assert.equal(res.json.totals.orphans, 80);
    assert.equal(res.json.truncated, true);
  });
});

test('without storage configured the scan says so and the cleanup refuses', async () => {
  await withServer({ storageConfigured: false }, async ({ request, calls }) => {
    assert.deepEqual((await request('GET', '/api/admin/storage', { token: 'admin' })).json, { success: true, configured: false });
    assert.equal((await request('POST', '/api/admin/storage/cleanup', { token: 'admin' })).status, 400);
    assert.deepEqual(calls.deleted, []);
  });
});

test('a storage failure is a generic 502: the service response, which may hold a key, never reaches the panel', async () => {
  await withServer({ storageFails: true }, async ({ request, calls }) => {
    for (const [method, path] of [['GET', '/api/admin/storage'], ['POST', '/api/admin/storage/cleanup']]) {
      const res = await request(method, path, { token: 'admin' });
      assert.equal(res.status, 502, path);
      assert.ok(!res.text.includes('sb_secret'), path);
    }
    assert.deepEqual(calls.deleted, []);
  });
});

test('the cleanup deletes only the orphans it works out itself, whatever list the browser sends', async () => {
  const listing = { files: [file('lic-ana/used.png'), file('lic-ana/stray.mp3'), file('lic-ana/fresh.png', { hoursOld: 1 })], truncated: false };
  await withServer({ listing, referenced: ['lic-ana/used.png'] }, async ({ request, calls }) => {
    const res = await request('POST', '/api/admin/storage/cleanup', { token: 'admin', body: { paths: ['lic-ana/used.png', 'lic-ana/fresh.png', '../../etc/passwd'], orphans: ['lic-ana/used.png'] } });
    assert.deepEqual(res.json, { success: true, deleted: 1, failed: 0, remaining: 0 });
    assert.deepEqual(calls.deleted, [['lic-ana/stray.mp3']], 'a file in use, a recent one, or a made-up path is never deleted');
    assert.deepEqual(calls.audit, [{ admin: 'notbenjaa1', action: 'storage.cleanup', target: {}, details: { deleted: 1, failed: 0, orphans: 1 } }]);
  });
});

test('the cleanup works in batches of 500 and says how many are still left', async () => {
  const files = Array.from({ length: 620 }, (_, i) => file(`lic-ana/f${i}.png`));
  await withServer({ listing: { files, truncated: false } }, async ({ request, calls }) => {
    const first = await request('POST', '/api/admin/storage/cleanup', { token: 'admin' });
    assert.equal(calls.deleted[0].length, 500);
    assert.deepEqual([first.json.deleted, first.json.remaining], [500, 120]);
  });
  await withServer({ listing: { files: files.slice(0, 10), truncated: false }, deleteResult: () => ({ deleted: 7, failed: 3 }) }, async ({ request }) => {
    const partial = await request('POST', '/api/admin/storage/cleanup', { token: 'admin' });
    assert.deepEqual([partial.json.deleted, partial.json.failed, partial.json.remaining], [7, 3, 3], 'what failed to delete is still there');
  });
});

// ── Payments ──

const failureRow = (over = {}) => ({
  id: 'f1', provider: 'mp', provider_payment_id: 'pay-1', license_id: 'lic-ana', plan_type: 'month', dice_tier: null, spotify_addon: true,
  amount_cents: '30600', reason: 'apply_failed', error: 'db down', created_at: '1780000000000', resolved_at: null, ...over,
});

test('the reconciliation lists the pending payments with the license name, and the days are kept between 1 and 30', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    await withServer({ failures: [failureRow(), failureRow({ id: 'f2', license_id: 'lic-deleted', provider: 'stripe', provider_payment_id: 'pi_1' })],
      withoutLicense: [{ provider: 'stripe', license_id: 'gone', plan_type: 'month', amount_cents: 1260, created_at: 5 }] }, async ({ request }) => {
      const { json } = await request('GET', '/api/admin/payments/reconcile', { token: 'admin' });
      const { report } = json;
      assert.equal(report.days, 7);
      assert.deepEqual(report.failures[0], {
        id: 'f1', provider: 'mp', paymentId: 'pay-1', licenseId: 'lic-ana', license: 'ana', planType: 'month', diceTier: null,
        spotifyAddon: true, amountCents: 30600, reason: 'apply_failed', error: 'db down', createdAt: 1780000000000,
      });
      assert.equal(report.failures[1].license, null, 'a deleted license has no name');
      assert.deepEqual([report.withoutLicense.count, report.withoutLicense.amountCents], [1, 1260]);
      assert.deepEqual(report.stripe, { available: false, checked: 0, unrecorded: [], error: null }, 'no Stripe key, nothing to compare');
      for (const [query, days] of [['?days=999', 30], ['?days=0', 7], ['?days=-3', 1], ['?days=abc', 7], ['?days=14', 14]]) {
        assert.equal((await request('GET', `/api/admin/payments/reconcile${query}`, { token: 'admin' })).json.report.days, days, query);
      }
    });
  } finally { if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved; }
});

test('the reconciliation finds Stripe charges this site never recorded, and a Stripe error is reported without details', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  try {
    const intent = (id, licenseId) => ({ id, status: 'succeeded', amount: 1260, amount_received: 1260, created: 1_780_000_000, metadata: { licenseId, planType: 'month' } });
    const stripe = { paymentIntents: { list: async () => ({ data: [intent('pi_known', 'lic-ana'), intent('pi_missing', 'lic-beto')], has_more: false }) } };
    await withServer({ stripe, knownStripe: ['pi_known'] }, async ({ request }) => {
      const { report } = (await request('GET', '/api/admin/payments/reconcile', { token: 'admin' })).json;
      assert.equal(report.stripe.available, true);
      assert.equal(report.stripe.checked, 2);
      assert.deepEqual(report.stripe.unrecorded.map((u) => [u.paymentIntentId, u.license, u.amountCents]), [['pi_missing', 'beto', 1260]]);
    });
    const broken = { paymentIntents: { list: async () => { throw new Error('Invalid API Key provided: sk_test_fake'); } } };
    await withServer({ stripe: broken }, async ({ request }) => {
      const res = await request('GET', '/api/admin/payments/reconcile', { token: 'admin' });
      assert.equal(res.status, 200, 'the rest of the report still loads');
      assert.deepEqual(res.json.report.stripe, { available: false, checked: 0, unrecorded: [], error: 'No se pudo consultar Stripe' });
      assert.ok(!res.text.includes('sk_test'));
    });
  } finally { if (saved === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved; }
});

test('applying a pending payment records it, applies it, closes the note and leaves a history line', async () => {
  await withServer({ failures: [failureRow()] }, async ({ request, calls }) => {
    const res = await request('POST', '/api/admin/payments/failures/f1/apply', { token: 'admin' });
    assert.deepEqual(res.json, { success: true });
    assert.equal(calls.inserted.length, 1);
    const [provider, row] = calls.inserted[0];
    assert.equal(provider, 'mp');
    assert.deepEqual([row.mpPaymentId, row.licenseId, row.planType, row.diceTier, row.spotifyAddon, row.amountCents, row.status], ['pay-1', 'lic-ana', 'month', null, true, 30600, 'approved']);
    const [apply] = calls.applyRetry;
    assert.deepEqual([apply.label, apply.licenseId, apply.planType, apply.diceTier, apply.spotifyAddon, apply.provider, apply.providerPaymentId, apply.amountCents],
      ['MP', 'lic-ana', 'month', undefined, true, 'mp', 'pay-1', 30600]);
    assert.equal(await apply.forget(), undefined, 'a failed manual attempt does not forget the payment: it stays pending');
    assert.deepEqual(calls.resolved, [['f1', 'notbenjaa1']]);
    assert.deepEqual(calls.audit, [{ admin: 'notbenjaa1', action: 'payment.apply_failure', target: { id: 'lic-ana' }, details: { provider: 'mp', paymentId: 'pay-1' } }]);
  });
});

test('a pending Stripe payment is recorded under its Stripe id', async () => {
  await withServer({ failures: [failureRow({ id: 'f9', provider: 'stripe', provider_payment_id: 'pi_abc12345', plan_type: null, dice_tier: 'pro', spotify_addon: false })] }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/api/admin/payments/failures/f9/apply', { token: 'admin' })).status, 200);
    const [provider, row] = calls.inserted[0];
    assert.deepEqual([provider, row.stripePaymentId, row.planType, row.diceTier], ['stripe', 'pi_abc12345', null, 'pro']);
    assert.deepEqual([calls.applyRetry[0].label, calls.applyRetry[0].provider], ['Stripe', 'stripe']);
  });
});

test('a pending payment that is gone, resolved, or has no license to apply to is refused and nothing is written', async () => {
  await withServer({ failures: [failureRow({ id: 'done', resolved_at: '5' }), failureRow({ id: 'orphan', license_id: 'lic-deleted' }), failureRow({ id: 'nolicense', license_id: null })] }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/api/admin/payments/failures/missing/apply', { token: 'admin' })).status, 404);
    assert.equal((await request('POST', '/api/admin/payments/failures/done/apply', { token: 'admin' })).status, 404);
    assert.equal((await request('POST', '/api/admin/payments/failures/orphan/apply', { token: 'admin' })).status, 409);
    assert.equal((await request('POST', '/api/admin/payments/failures/nolicense/apply', { token: 'admin' })).status, 409);
    assert.deepEqual([calls.inserted, calls.applyRetry, calls.resolved, calls.audit], [[], [], [], []]);
  });
});

test('if applying does not work the note stays open, and the panel gets a generic message', async () => {
  await withServer({ failures: [failureRow()], applyResult: { applied: false } }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/api/admin/payments/failures/f1/apply', { token: 'admin' })).status, 409);
    assert.deepEqual([calls.resolved, calls.audit], [[], []]);
  });
  await withServer({ failures: [failureRow()], applyThrows: true }, async ({ request, calls }) => {
    const res = await request('POST', '/api/admin/payments/failures/f1/apply', { token: 'admin' });
    assert.equal(res.status, 502);
    assert.ok(!res.text.includes('hunter2') && !res.text.includes('db down'));
    assert.deepEqual([calls.resolved, calls.audit], [[], []]);
  });
});

test('applying a Stripe charge takes everything from Stripe, never from what the browser sends', async () => {
  const succeeded = { id: 'pi_realcharge1', status: 'succeeded', metadata: { licenseId: 'lic-beto', planType: 'annual', diceTier: 'pro', spotifyAddon: 'true' } };
  const retrieved = [];
  const stripe = { paymentIntents: { retrieve: async (id) => { retrieved.push(id); return succeeded; } } };
  await withServer({ stripe }, async ({ request, calls }) => {
    const res = await request('POST', '/api/admin/payments/stripe/apply', { token: 'admin', body: { paymentIntentId: '  pi_realcharge1 ', licenseId: 'lic-ana', planType: 'lifetime' } });
    assert.deepEqual(res.json, { success: true, applied: true, alreadyProcessed: false });
    assert.deepEqual(retrieved, ['pi_realcharge1'], 'the id is trimmed');
    assert.deepEqual(calls.applyStripe, [{ licenseId: 'lic-beto', planType: 'annual', diceTier: 'pro', spotifyAddon: true, stripePaymentId: 'pi_realcharge1' }]);
    assert.deepEqual(calls.audit, [{ admin: 'notbenjaa1', action: 'payment.apply_stripe', target: { id: 'lic-beto' }, details: { paymentIntentId: 'pi_realcharge1', applied: true, alreadyProcessed: false } }]);
  });
  await withServer({ stripe, stripeApplyResult: { applied: false, alreadyProcessed: true } }, async ({ request }) => {
    const again = await request('POST', '/api/admin/payments/stripe/apply', { token: 'admin', body: { paymentIntentId: 'pi_realcharge1' } });
    assert.deepEqual(again.json, { success: true, applied: false, alreadyProcessed: true }, 'a repeated click does not apply twice');
  });
});

test('a Stripe charge id must look like one before Stripe is even asked', async () => {
  let asked = 0;
  const stripe = { paymentIntents: { retrieve: async () => { asked++; return {}; } } };
  await withServer({ stripe }, async ({ request }) => {
    for (const bad of [undefined, null, 42, '', 'pi_', 'pi_short', 'sk_live_abcdefghijk', '../pi_abcdefgh12', 'pi_abcdefgh12/refunds', 'pi_abc def12345', ['pi_abcdefgh12'], { id: 'pi_abcdefgh12' }]) {
      const res = await request('POST', '/api/admin/payments/stripe/apply', { token: 'admin', body: { paymentIntentId: bad } });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    assert.equal(asked, 0);
  });
});

test('a Stripe charge that is not complete, is not from this site, or whose license is gone is refused', async () => {
  const cases = [
    { id: 'pi_pending12345', status: 'requires_payment_method', metadata: { licenseId: 'lic-ana' } },
    { id: 'pi_nolicense123', status: 'succeeded', metadata: {} },
    { id: 'pi_nometadata12', status: 'succeeded' },
    { id: 'pi_deletedlic12', status: 'succeeded', metadata: { licenseId: 'lic-deleted', planType: 'month' } },
  ];
  for (const intent of cases) {
    const stripe = { paymentIntents: { retrieve: async () => intent } };
    await withServer({ stripe }, async ({ request, calls }) => {
      const res = await request('POST', '/api/admin/payments/stripe/apply', { token: 'admin', body: { paymentIntentId: intent.id } });
      assert.equal(res.status, 409, intent.id);
      assert.deepEqual([calls.applyStripe, calls.audit], [[], []], intent.id);
    });
  }
  const failing = { paymentIntents: { retrieve: async () => { throw new Error('No such payment_intent: pi_x; key sk_live_abc'); } } };
  await withServer({ stripe: failing }, async ({ request }) => {
    const res = await request('POST', '/api/admin/payments/stripe/apply', { token: 'admin', body: { paymentIntentId: 'pi_abcdefgh1234' } });
    assert.equal(res.status, 502);
    assert.ok(!res.text.includes('sk_live'));
  });
});

test('the payments check and the storage scan have separate limits, so one cannot use up the other', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    await withServer({ listing: { files: [], truncated: false } }, async ({ request }) => {
      for (let i = 0; i < 20; i++) assert.equal((await request('GET', '/api/admin/payments/reconcile', { token: 'admin' })).status, 200, `check ${i + 1}`);
      assert.equal((await request('GET', '/api/admin/payments/reconcile', { token: 'admin' })).status, 429, 'the 21st in ten minutes is refused');
      assert.equal((await request('GET', '/api/admin/storage', { token: 'admin' })).status, 200, 'the storage scan still has its own allowance');
    });
  } finally { if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved; }
});
