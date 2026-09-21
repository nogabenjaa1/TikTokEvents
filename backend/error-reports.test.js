const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, clean, stripUrl, fingerprintOf, sanitizeReport, cspReportToRaw, createErrorReporter, MAX } = require('./lib/errorReports');

// Anything that reaches the error log comes from a browser anybody can script: it is cleaned before it is stored.

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const OVERLAY_TOKEN = 'ovl.4a8f2c1e-1111-2222-3333-444455556666.9f86d081884c7d659a2feaa0c55ad015';

test('tokens, keys and secrets are hidden wherever they show up in an error', () => {
  assert.equal(redact(`falló ${OVERLAY_TOKEN} al conectar`), 'falló ovl.[oculto] al conectar');
  assert.equal(redact(`token ${JWT} vencido`), 'token [jwt oculto] vencido');
  assert.equal(redact('Authorization: Bearer abcdefgh12345678'), 'Authorization: Bearer [oculto]');
  assert.equal(redact('GET /overlay?key=novia-lifetime-AbCdEfGh1234&theme=dark'), 'GET /overlay?key=[oculto]&theme=dark');
  assert.equal(redact('https://x.test/cb?code=abc123&state=zzz'), 'https://x.test/cb?code=[oculto]&state=[oculto]');
  for (const key of ['novia-monthly-AbCdEfGh1234', 'bubulubu_gang-lifetime-ZZzz-1234_abcd', 'cleo-FREE7DAY-abcdefghijkl', 'x-ADMIN-abcdefgh1234']) {
    assert.equal(redact(`clave ${key} inválida`), 'clave [clave oculta] inválida', key);
  }
  assert.equal(redact('Error: Cannot read properties of undefined (reading "map")'), 'Error: Cannot read properties of undefined (reading "map")', 'ordinary text is left alone');
  assert.equal(redact(undefined), '');
  assert.equal(redact(null), '');
});

test('clean removes control characters, hides secrets and cuts to the limit', () => {
  assert.equal(clean('línea 1\nlínea 2\r\n\tfin\x00', 100), 'línea 1 línea 2 fin', 'no way to forge extra log lines');
  assert.equal(clean('a\x07b', 100), 'a b');
  assert.equal(clean('  espacios  ', 100), 'espacios');
  const long = clean('x'.repeat(500), MAX.message);
  assert.equal(long.length, MAX.message);
  assert.ok(long.endsWith('…'));
  assert.equal(clean(`Bearer ${'a'.repeat(30)}`, 100), 'Bearer [oculto]');
  // A stack keeps its line breaks (they are its structure) but nothing else that is a control character.
  assert.equal(clean('at a (f.js:1:1)\n\x00at b (g.js:2:2)\x1b', 200, { keepNewlines: true }), 'at a (f.js:1:1)\nat b (g.js:2:2)');
});

test('a URL keeps its origin and path only: the query and the fragment can carry keys', () => {
  assert.equal(stripUrl('https://app.test/panel/overlays?key=novia-lifetime-AbCdEfGh1234#top'), 'https://app.test/panel/overlays');
  assert.equal(stripUrl('/panel?section=alerts'), '/panel');
  assert.equal(stripUrl('inline'), 'inline');
  assert.equal(stripUrl('eval'), 'eval');
  assert.equal(stripUrl('data:text/html,<script>alert(1)</script>'), 'data:');
  assert.equal(stripUrl('blob:https://app.test/0b1c?x=1'), 'blob:https://app.test/0b1c');
  assert.equal(stripUrl(undefined), '');
});

test('the same error gets the same fingerprint whatever its numbers, ids or build hash; a different one does not', () => {
  const base = { source: 'frontend', kind: 'error', message: 'Cannot read properties of undefined (reading "map")', stack: 'TypeError: x\n    at render (https://app.test/assets/index-AbCdEf12.js:10:5)' };
  const same = { ...base, stack: 'TypeError: x\n    at render (https://app.test/assets/index-ZzYyXx99.js:88:17)' };
  assert.equal(fingerprintOf(base), fingerprintOf(same), 'a new deploy changes the file hash and the line, not the error');
  assert.equal(
    fingerprintOf({ ...base, message: 'Alerta 12 no encontrada (a1b2c3d4-0000-4000-8000-000000000001)' }),
    fingerprintOf({ ...base, message: 'Alerta 99 no encontrada (ffffffff-0000-4000-8000-00000000abcd)' }),
  );
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, message: 'Otro error distinto' }));
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, source: 'backend' }));
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, kind: 'promise' }));
  assert.match(fingerprintOf(base), /^[0-9a-f]{24}$/);
});

test('sanitizeReport only accepts a known source and a non-empty message, and cleans every field', () => {
  assert.equal(sanitizeReport(null, { source: 'frontend' }), null);
  assert.equal(sanitizeReport('texto', { source: 'frontend' }), null);
  assert.equal(sanitizeReport({ message: 'x' }, { source: 'otro' }), null);
  assert.equal(sanitizeReport({ message: '   ' }, { source: 'frontend' }), null);
  assert.equal(sanitizeReport({}, { source: 'frontend' }), null);

  const report = sanitizeReport({
    kind: 'render', message: `falló con ${OVERLAY_TOKEN}`, stack: `at f (https://app.test/a.js:1:1)\nBearer ${'z'.repeat(20)}`,
    context: 'https://app.test/panel?key=novia-lifetime-AbCdEfGh1234', userAgent: 'Mozilla/5.0\nX-Forwarded: evil',
  }, { source: 'frontend' });
  assert.equal(report.kind, 'render');
  assert.equal(report.message, 'falló con ovl.[oculto]');
  assert.equal(report.stack, 'at f (https://app.test/a.js:1:1)\nBearer [oculto]');
  assert.equal(report.context, 'https://app.test/panel');
  assert.equal(report.userAgent, 'Mozilla/5.0 X-Forwarded: evil');
  assert.match(report.fingerprint, /^[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(report).includes('ovl.4a8f'), 'the token is nowhere in what gets stored');

  assert.equal(sanitizeReport({ message: 'x', kind: 'inventado' }, { source: 'frontend' }).kind, 'error', 'an unknown kind falls back');
  assert.equal(sanitizeReport({ message: 'x', kind: 'inventado' }, { source: 'csp' }).kind, 'csp');
  const big = sanitizeReport({ message: 'm'.repeat(5000), stack: 's'.repeat(9000), context: 'c'.repeat(900), userAgent: 'u'.repeat(900) }, { source: 'backend' });
  assert.deepEqual([big.message.length, big.stack.length, big.context.length, big.userAgent.length], [MAX.message, MAX.stack, MAX.context, MAX.userAgent]);
  assert.deepEqual([big.source], ['backend']);
  const bare = sanitizeReport({ message: 'x' }, { source: 'frontend' });
  assert.deepEqual([bare.stack, bare.context, bare.userAgent], [null, null, null]);
});

test('a violation the browser reports about the content security policy becomes a readable report', () => {
  // The older format: one object wrapped in "csp-report", with dashed names.
  const legacy = cspReportToRaw({ 'csp-report': {
    'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=abc', 'document-uri': 'https://app.test/panel?key=secret',
    'source-file': 'https://app.test/assets/index.js?v=1', 'line-number': 42, disposition: 'report',
  } });
  assert.equal(legacy.message, 'script-src-elem habría bloqueado evil.example');
  assert.equal(legacy.kind, 'csp');
  assert.equal(legacy.stack, 'at https://app.test/assets/index.js:42');
  const stored = sanitizeReport(legacy, { source: 'csp' });
  assert.equal(stored.context, 'https://app.test/panel', 'the page address is stored without its query');
  assert.ok(!JSON.stringify(stored).includes('secret') && !JSON.stringify(stored).includes('token=abc'));

  // The Reporting API sends a list, with camelCase names.
  const modern = cspReportToRaw([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'inline', disposition: 'enforce', sourceFile: 'https://app.test/a.js', lineNumber: 7 } }]);
  assert.equal(modern.message, 'img-src bloqueó inline');
  assert.equal(modern.stack, 'at https://app.test/a.js:7');

  for (const garbage of [null, undefined, 'texto', 7, [], {}, [{}], { 'csp-report': null }]) {
    const raw = cspReportToRaw(garbage);
    assert.equal(raw.message, 'una directiva habría bloqueado un recurso', JSON.stringify(garbage));
  }
});

// ── The reporter that writes them ──

function reporterHarness(options = {}) {
  const calls = { upserts: [], prunes: [] };
  let clock = 1_000_000;
  const db = {
    upsertErrorReport: async (row) => { calls.upserts.push(row); },
    pruneErrorReports: async (args) => { calls.prunes.push(args); },
  };
  const reporter = createErrorReporter({ db, now: () => clock, ...options });
  return { reporter, calls, db, advance: (ms) => { clock += ms; }, now: () => clock };
}

// Distinct messages without digits (digits are normalised away, so "error 1" and "error 2" are the same error).
const word = (i) => { let out = ''; let n = i; do { out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); } while (n > 0); return `fallo ${out}`; };

test('a report is stored once, sanitized and tied to its source and license', async () => {
  const { reporter, calls, now } = reporterHarness();
  assert.equal(await reporter.record({ kind: 'error', message: `boom ${OVERLAY_TOKEN}` }, { source: 'frontend', licenseId: 'lic-1' }), true);
  assert.equal(calls.upserts.length, 1);
  const row = calls.upserts[0];
  assert.deepEqual([row.source, row.licenseId, row.increment, row.at, row.message], ['frontend', 'lic-1', 1, now(), 'boom ovl.[oculto]']);
  assert.equal(await reporter.record({ message: 'sin origen válido' }, { source: 'nadie' }), false);
  assert.equal(await reporter.record({ message: '' }, { source: 'frontend' }), false);
  assert.equal(calls.upserts.length, 1, 'rejected reports write nothing');
});

test('a burst of the same error is one write and the rest are counted into the next one', async () => {
  const { reporter, calls, advance } = reporterHarness({ coalesceMs: 5000 });
  const report = { kind: 'error', message: 'Cannot read properties of undefined' };
  await reporter.record(report, { source: 'frontend' });
  advance(1000); await reporter.record(report, { source: 'frontend' });
  advance(1000); await reporter.record(report, { source: 'frontend' });
  advance(1000); await reporter.record(report, { source: 'frontend' });
  assert.equal(calls.upserts.length, 1, 'three repeats inside the window write nothing');
  advance(5000);
  await reporter.record(report, { source: 'frontend' });
  assert.equal(calls.upserts.length, 2);
  assert.equal(calls.upserts[1].increment, 4, 'the next write carries the three it swallowed plus itself');
  assert.equal(calls.upserts[0].fingerprint, calls.upserts[1].fingerprint);
});

test('a flood of different errors cannot write more than the per-minute cap, and the window then resets', async () => {
  const { reporter, calls, advance } = reporterHarness({ perMinute: 3 });
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await reporter.record({ message: word(i) }, { source: 'frontend' }));
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(calls.upserts.length, 3);
  assert.deepEqual(reporter.stats(), { written: 3, dropped: 2 });
  advance(61 * 1000);
  assert.equal(await reporter.record({ message: word(9) }, { source: 'frontend' }), true, 'a new minute allows writes again');
  assert.equal(calls.upserts.length, 4);
});

test('old reports are pruned every so many writes, with the retention and the row cap it was given', async () => {
  const { reporter, calls, now } = reporterHarness({ pruneEvery: 2, maxRows: 40, retentionMs: 1000 });
  for (let i = 0; i < 5; i++) await reporter.record({ message: word(i) }, { source: 'backend' });
  assert.equal(calls.prunes.length, 2, 'once per two writes');
  assert.deepEqual(calls.prunes[0], { olderThan: now() - 1000, maxRows: 40 });
});

test('a database that fails never makes the reporter throw, and the failure is not swallowed silently', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const { reporter, db } = reporterHarness();
  db.upsertErrorReport = async () => { throw new Error('db down'); };
  assert.equal(await reporter.record({ message: 'algo' }, { source: 'frontend' }), false);
  db.upsertErrorReport = () => { throw new Error('sincrónico'); };
  assert.equal(await reporter.record({ message: 'otro algo distinto' }, { source: 'frontend' }), false);
  assert.equal(errors.mock.callCount(), 2);
  // Even a hostile input object cannot make it throw.
  const hostile = { get message() { throw new Error('getter'); } };
  assert.equal(await reporter.record(hostile, { source: 'frontend' }), false);
});

test('the memory of recent errors stays bounded, and an error it forgot is simply written again', async () => {
  const { reporter, calls } = reporterHarness({ perMinute: 1e9, pruneEvery: 1e9 });
  for (let i = 0; i < 2100; i++) await reporter.record({ message: word(i) }, { source: 'frontend' });
  assert.equal(calls.upserts.length, 2100);
  const before = calls.upserts.length;
  await reporter.record({ message: word(0) }, { source: 'frontend' });
  assert.equal(calls.upserts.length, before + 1, 'the oldest fingerprint was trimmed, so it is written again instead of being swallowed');
  assert.equal(calls.upserts.at(-1).increment, 1);
});
