const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Carga el módulo real de eventos sin DB, Spotify ni TikTok, con un reloj de mentira.
function load() {
  const recorded = [];
  const directory = { record: (gift) => { recorded.push(gift); return true; }, list: () => [] };
  const timers = new Map();
  let nextId = 1;
  let now = 1_000_000;
  const clock = {
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + ms }); return { id, unref() {} }; },
    clearTimeout(handle) { if (handle) timers.delete(handle.id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) { if (timer.at <= now) { timers.delete(id); timer.fn(); } }
    },
  };
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : name.includes('giftCatalog') ? require('./lib/giftCatalog') : name.includes('giftDirectory') ? directory : {}),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Date: { now: () => now }, console, Math, Number, String, Map, Set, Object, Array,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/events'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.openGiftCombos = new Map();
  tenant.closedGiftCombos = new Map();
  tenant.seenGifts = new Map();
  const alerts = [];
  const emitted = [];
  const games = [];
  tenant.broadcast = { emit: (name, payload) => emitted.push({ name, payload }) };
  for (const method of ['processGiftKing', 'processGiftZub', 'processGiftElim', 'processGiftRoulette', 'processGiftGifterBoard', 'processGiftExtensible', 'processGiftGoal']) {
    tenant[method] = (event) => games.push({ method, event });
  }
  tenant.processAlertTrigger = (payload) => alerts.push(payload);
  return { tenant, clock, alerts, emitted, games, recorded };
}

const rose = (extra) => ({ uniqueId: 'ana', userId: '1', nickname: 'Ana', giftId: 5655, name: 'Rose', diamondCount: 1, type: 1, repeatCount: 1, repeatEnd: false, giftPictureUrl: 'https://x/rose.png', ...extra });

test('a streak of x7 roses fires ONE alert, with the final count, when TikTok closes it', () => {
  const { tenant, alerts, games } = load();
  for (let n = 1; n <= 6; n++) tenant.handleGiftEvent(rose({ repeatCount: n }));
  assert.equal(alerts.length, 0, 'nothing fires while the streak is open');
  tenant.handleGiftEvent(rose({ repeatCount: 7, repeatEnd: true }));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].repeatCount, 7);
  assert.equal(alerts[0].coins, 7);
  assert.equal(games.filter((g) => g.method === 'processGiftKing').length, 1, 'the games also count it once');
});

test('a streak TikTok never closes is closed by the timer, so it is not a dead event waiting for the next one', () => {
  const { tenant, clock, alerts } = load();
  tenant.handleGiftEvent(rose({ repeatCount: 3 }));
  tenant.handleGiftEvent(rose({ repeatCount: 5 }));
  clock.advance(11_000);
  assert.equal(alerts.length, 0, 'still inside the window');
  clock.advance(2_000);
  assert.equal(alerts.length, 1, 'fires by itself, without another event');
  assert.equal(alerts[0].repeatCount, 5, 'with the last count received');
  tenant.handleGiftEvent(rose({ repeatCount: 5, repeatEnd: true }));
  assert.equal(alerts.length, 1, 'the real close that arrives late is not counted twice');
});

test('a late close that carries more than the timer counted only adds the difference', () => {
  const { tenant, clock, alerts } = load();
  tenant.handleGiftEvent(rose({ repeatCount: 4 }));
  clock.advance(13_000);
  assert.equal(alerts.length, 1);
  tenant.handleGiftEvent(rose({ repeatCount: 9, repeatEnd: true }));
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1].repeatCount, 5);
});

test('different people and different gifts never merge, and each one fires in the order it closed', () => {
  const { tenant, alerts } = load();
  tenant.handleGiftEvent(rose({ uniqueId: 'ana', userId: '1', repeatCount: 2 }));
  tenant.handleGiftEvent(rose({ uniqueId: 'bob', userId: '2', repeatCount: 3 }));
  tenant.handleGiftEvent(rose({ uniqueId: 'ana', userId: '1', giftId: 7, name: 'Heart', repeatCount: 1 }));
  tenant.handleGiftEvent(rose({ uniqueId: 'bob', userId: '2', repeatCount: 3, repeatEnd: true }));
  tenant.handleGiftEvent(rose({ uniqueId: 'ana', userId: '1', giftId: 7, name: 'Heart', repeatCount: 1, repeatEnd: true }));
  tenant.handleGiftEvent(rose({ uniqueId: 'ana', userId: '1', repeatCount: 2, repeatEnd: true }));
  assert.deepEqual(alerts.map((a) => `${a.username}:${a.giftName}:${a.repeatCount}`), ['bob:Rose:3', 'ana:Heart:1', 'ana:Rose:2']);
});

test('a gift with no streak fires immediately, every time', () => {
  const { tenant, alerts } = load();
  tenant.handleGiftEvent(rose({ type: 0, name: 'Perfume', giftId: 9, repeatEnd: false }));
  tenant.handleGiftEvent(rose({ type: 0, name: 'Perfume', giftId: 9, repeatEnd: false }));
  assert.equal(alerts.length, 2);
});

test('every gift received is saved with its id, name, coins and icon, once per gift', () => {
  const { tenant, recorded } = load();
  tenant.handleGiftEvent(rose({ type: 0, name: 'Super GG', giftId: 55, diamondCount: 30, giftPictureUrl: 'https://x/gg.png' }));
  tenant.handleGiftEvent(rose({ type: 0, name: 'super gg', giftId: 55, diamondCount: 30, giftPictureUrl: 'https://x/gg.png' }));
  tenant.handleGiftEvent(rose({ type: 0, name: 'Perfume', giftId: 56, diamondCount: 20, giftPictureUrl: '' }));
  assert.deepEqual(recorded.map((g) => ({ ...g })), [
    { id: 55, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' },
    { id: 56, name: 'Perfume', coins: 20, icon: '' },
  ]);
});

test('every gift seen in the LIVE is remembered and announced to the panel once', () => {
  const { tenant, emitted } = load();
  tenant.handleGiftEvent(rose({ type: 0, name: 'Nueva Ola', giftId: 99, diamondCount: 12, giftPictureUrl: 'https://x/ola.png' }));
  tenant.handleGiftEvent(rose({ type: 0, name: 'nueva ola', giftId: 99 }));
  const seen = emitted.filter((e) => e.name === 'gift_seen');
  assert.equal(seen.length, 1);
  assert.deepEqual({ ...seen[0].payload }, { id: 99, name: 'Nueva Ola', coins: 12, icon: 'https://x/ola.png' });
  assert.deepEqual(Array.from(tenant.getSeenGifts(), (g) => g.name), ['Nueva Ola']);
});
