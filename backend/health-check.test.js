const test = require('node:test');
const assert = require('node:assert/strict');
const { createHealthChecker } = require('./lib/healthCheck');

// /health/deep answers "does the database respond?" for an external monitor. /health stays free of the database
// because Render restarts the service when it fails, and a database hiccup must not take every live stream down.

const quiet = (t) => t.mock.method(console, 'error', () => {});

test('a database that answers is healthy, with how long it took', async () => {
  let clock = 1000;
  const checker = createHealthChecker({ ping: async () => { clock += 25; }, now: () => clock });
  const result = await checker.check();
  assert.equal(result.ok, true);
  assert.deepEqual(result.db, { ok: true, latencyMs: 25 });
  assert.equal(result.checkedAt, clock);
});

test('a database that fails is reported unhealthy with a generic reason, and the detail stays in the server log', async (t) => {
  const errors = quiet(t);
  const checker = createHealthChecker({ ping: async () => { throw new Error('connect ECONNREFUSED db.internal.example:5432 password=hunter2'); } });
  const result = await checker.check();
  assert.equal(result.ok, false);
  assert.deepEqual([result.db.ok, result.db.reason], [false, 'sin conexión']);
  assert.ok(!JSON.stringify(result).includes('hunter2') && !JSON.stringify(result).includes('internal'), 'nothing internal reaches whoever asks');
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments.join(' '), /ECONNREFUSED/);
});

test('a database that hangs is cut off at the timeout instead of hanging the monitor', async (t) => {
  quiet(t);
  const checker = createHealthChecker({ ping: () => new Promise(() => {}), timeoutMs: 20 });
  const started = Date.now();
  const result = await checker.check();
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual([result.ok, result.db.reason], [false, 'tiempo de espera agotado']);
});

test('the answer is kept for a few seconds so several monitors do not hammer the database', async () => {
  let clock = 0;
  let pings = 0;
  const checker = createHealthChecker({ ping: async () => { pings++; }, cacheMs: 5000, now: () => clock });
  await checker.check();
  clock += 4000;
  await checker.check();
  assert.equal(pings, 1, 'still fresh');
  clock += 1500;
  await checker.check();
  assert.equal(pings, 2, 'stale after the cache time');
});

test('checks that arrive together share the one already in progress', async () => {
  let release;
  let pings = 0;
  const checker = createHealthChecker({ ping: () => { pings++; return new Promise((resolve) => { release = resolve; }); }, cacheMs: 0 });
  const first = checker.check();
  const second = checker.check();
  const third = checker.check();
  release();
  const results = await Promise.all([first, second, third]);
  assert.equal(pings, 1);
  assert.ok(results.every((result) => result === results[0]));
});

test('a failed check is remembered too, and the next one after the cache time can recover', async (t) => {
  quiet(t);
  let clock = 0;
  let healthy = false;
  const checker = createHealthChecker({ ping: async () => { if (!healthy) throw new Error('down'); }, cacheMs: 1000, now: () => clock });
  assert.equal((await checker.check()).ok, false);
  healthy = true;
  assert.equal((await checker.check()).ok, false, 'cached failure');
  clock += 1500;
  assert.equal((await checker.check()).ok, true, 'recovered');
});
