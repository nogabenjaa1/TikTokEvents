const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAdminStats, monthKey, previousMonthKey } = require('./lib/adminStats');

const DAY = 24 * 60 * 60 * 1000;
// 20 de septiembre de 2026, mediodía en Ciudad de México.
const NOW = Date.parse('2026-09-20T18:00:00Z');
const lic = (id, extra) => ({ id, username: id, license_type: 'month', is_admin: false, revoked: false, expires_at: NOW + 20 * DAY, spotify_addon: false, multi_device: false, trial_alias: null, ...extra });
const pay = (license_id, amount_cents, createdAt, extra) => ({ license_id, amount_cents, created_at: createdAt, status: 'approved', plan_type: 'month', dice_tier: null, spotify_addon: false, ...extra });

test('months are cut at Mexico City midnight, not UTC', () => {
  // 2026-10-01 03:00 UTC still is September 30, 9 pm in Mexico City.
  assert.equal(monthKey(Date.parse('2026-10-01T03:00:00Z')), '2026-09');
  assert.equal(monthKey(Date.parse('2026-10-01T07:00:00Z')), '2026-10');
  assert.equal(previousMonthKey('2026-01'), '2025-12');
  assert.equal(previousMonthKey('2026-09'), '2026-08');
});

test('license counts ignore admins and split active, expired and revoked', () => {
  const stats = computeAdminStats([
    lic('a', { license_type: 'month' }),
    lic('b', { license_type: 'annual', spotify_addon: true, multi_device: true }),
    lic('c', { license_type: 'lifetime', expires_at: null }),
    lic('d', { expires_at: NOW - DAY }),
    lic('e', { revoked: true }),
    lic('root', { is_admin: true, license_type: 'lifetime', expires_at: null }),
  ], [], NOW);
  const l = stats.licenses;
  assert.equal(l.total, 5);
  assert.equal(l.active, 3);
  assert.equal(l.expired, 1);
  assert.equal(l.revoked, 1);
  assert.deepEqual({ ...l.byPlan }, { month: 1, annual: 1, lifetime: 1 });
  assert.equal(l.spotifyAddon, 1);
  assert.equal(l.multiDevice, 1);
});

test('licenses expiring within a week are listed, soonest first, and lifetime never appears', () => {
  const stats = computeAdminStats([
    lic('late', { expires_at: NOW + 6 * DAY }),
    lic('soon', { expires_at: NOW + 1 * DAY }),
    lic('far', { expires_at: NOW + 30 * DAY }),
    lic('forever', { license_type: 'lifetime', expires_at: null }),
  ], [], NOW);
  assert.deepEqual(stats.licenses.expiringSoon.map((x) => x.username), ['soon', 'late']);
  assert.equal(stats.licenses.expiringSoonCount, 2);
});

test('trial conversion counts trial-born licenses that now hold a paid plan', () => {
  const stats = computeAdminStats([
    lic('t1', { license_type: 'trial', trial_alias: 'x', expires_at: NOW + 2 * DAY }),
    lic('t2', { license_type: 'trial', trial_alias: 'y', expires_at: NOW - DAY }),
    lic('t3', { license_type: 'month', trial_alias: 'z' }),
    lic('plain', {}),
  ], [], NOW);
  assert.deepEqual({ ...stats.trials }, { total: 3, active: 1, converted: 1, conversionRate: 1 / 3 });
  assert.equal(computeAdminStats([lic('a', {})], [], NOW).trials.conversionRate, null);
});

test('revenue: this month vs last month, six-month series, per-item split and recent payments', () => {
  const thisMonth = Date.parse('2026-09-10T18:00:00Z');
  const lastMonth = Date.parse('2026-08-15T18:00:00Z');
  const old = Date.parse('2026-03-01T18:00:00Z');
  const stats = computeAdminStats(
    [lic('ana', {}), lic('bob', {})],
    [
      pay('ana', 12600, thisMonth),
      pay('bob', 18000, thisMonth + DAY, { plan_type: null, spotify_addon: true }),
      pay('ana', 50000, lastMonth, { plan_type: 'annual' }),
      pay('ana', 99999, old),
      pay('bob', 77777, thisMonth, { status: 'pending' }),
    ],
    NOW,
  );
  const r = stats.revenue;
  assert.equal(r.thisMonthCents, 12600 + 18000);
  assert.equal(r.thisMonthCount, 2);
  assert.equal(r.lastMonthCents, 50000);
  assert.equal(r.totalCents, 12600 + 18000 + 50000 + 99999, 'only approved payments count');
  assert.equal(r.months.length, 6);
  assert.deepEqual(r.months.map((m) => m.key), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(r.months.at(-1).cents, 30600);
  assert.equal(r.months[0].cents, 0, 'a month with no sales is present with zero');
  assert.deepEqual({ ...r.byItemThisMonth }, { month: 12600, spotify_addon: 18000 });
  assert.equal(r.recent[0].username, 'bob');
  assert.equal(r.recent[0].item, 'spotify_addon');
  assert.equal(r.recent.length, 4);
});

test('an empty database gives zeros, not errors', () => {
  const stats = computeAdminStats([], [], NOW);
  assert.equal(stats.licenses.total, 0);
  assert.equal(stats.revenue.thisMonthCents, 0);
  assert.equal(stats.revenue.months.length, 6);
  assert.deepEqual(stats.revenue.recent, []);
});
