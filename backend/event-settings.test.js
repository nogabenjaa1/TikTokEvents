const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sanitizeEventSettings, EVENT_SETTINGS_IDS } = require('./lib/eventSettings');

test('solo pasan los eventos y campos conocidos', () => {
  const out = sanitizeEventSettings({
    king: { mainTime: 20, snipeTime: 5, hacker: 'x' },
    zub: { minCoins: 100 },
    noExiste: { a: 1 },
  });
  assert.deepEqual(Object.keys(out).sort(), ['king', 'zub']);
  assert.deepEqual(out.king, { mainTime: 20, snipeTime: 5 });
});

test('los valores se limitan en tipo y tamaño', () => {
  const out = sanitizeEventSettings({
    king: { mainTime: 99999999, snipeTime: 'abc' },
    roulette: { entryMode: 'otro', keyword: 'x'.repeat(500), winnerRule: 'last', fastMode: 'si' },
    goal: { targetType: 'followers', title: 7 },
  });
  assert.equal(out.king.mainTime, 7200);
  assert.equal('snipeTime' in out.king, false);
  assert.equal('entryMode' in out.roulette, false);
  assert.equal(out.roulette.keyword.length, 60);
  assert.equal(out.roulette.winnerRule, 'last');
  assert.equal('fastMode' in out.roulette, false);
  assert.deepEqual(out.goal, { targetType: 'followers' });
});

test('un regalo guarda nombre, monedas e ícono solo por https', () => {
  const out = sanitizeEventSettings({
    king: {
      selectedGift: { name: 'Rosa', coins: 1, icon: 'https://x/rosa.png', id: '5655', extra: 'nope' },
      selectedInstaWin: { name: 'León', coins: 29999, icon: 'javascript:alert(1)' },
    },
    elim: { selectedGift: null, selectedInstaWin: { coins: 5 } },
  });
  assert.deepEqual(out.king.selectedGift, { name: 'Rosa', icon: 'https://x/rosa.png', coins: 1, id: 5655 });
  assert.equal(out.king.selectedInstaWin.icon, '');
  assert.equal(out.elim.selectedGift, null, 'null = sin regalo elegido');
  assert.equal('selectedInstaWin' in out.elim, false, 'sin nombre no es un regalo');
});

test('entradas basura no rompen nada', () => {
  assert.deepEqual(sanitizeEventSettings(null), {});
  assert.deepEqual(sanitizeEventSettings([1, 2]), {});
  assert.deepEqual(sanitizeEventSettings({ king: 'texto' }), {});
  assert.deepEqual(EVENT_SETTINGS_IDS.sort(), ['elim', 'extensible', 'goal', 'king', 'roulette', 'zub']);
});

// El manejador de socket real (lib/tenant/settings.js) con la base simulada.
function loadSettingsHandlers() {
  const saved = [];
  const db = { setEventSettings: async (id, map) => { saved.push({ id, map }); } };
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('eventSettings') ? require('./lib/eventSettings')
      : name.includes('tenantSanitizers') ? require('./lib/tenantSanitizers')
      : name.includes('/db') ? db : {}),
    console, Math, Number, String, Object, Array, JSON, Promise,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/settings'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.licenseId = 'lic-1';
  tenant.logId = 'test';
  tenant.theme = { style: 'default', accent: 'purple', customColor: '#7C3AED' };
  tenant.eventSettings = {};
  const sent = [];
  tenant.broadcast = { emit: (name, payload) => sent.push({ name, payload }) };
  return { tenant, saved, sent };
}

function fakeSocket(authMethod, sent = []) {
  const handlers = {};
  return {
    authMethod,
    on: (n, fn) => { handlers[n] = fn; },
    to: (room) => ({ emit: (name, payload) => sent.push({ room, name, payload }) }),
    fire: (n, p) => handlers[n]?.(p),
  };
}

test('set_event_settings guarda, sanea y reenvía a las demás pestañas', async () => {
  const { tenant, saved, sent } = loadSettingsHandlers();
  const socket = fakeSocket('jwt', sent);
  tenant.registerSettingsHandlers(socket);
  socket.fire('set_event_settings', { king: { mainTime: 30, otro: 1 }, basura: {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(JSON.parse(JSON.stringify(tenant.eventSettings)), { king: { mainTime: 30 } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'lic-1');
  assert.ok(sent.some((s) => s.name === 'event_settings_update' && s.room === 'lic-1'), 'va al room de la licencia, sin el emisor');
});

test('un socket sin sesión de panel (overlay) no puede cambiar los ajustes', async () => {
  const { tenant, saved } = loadSettingsHandlers();
  const socket = fakeSocket('overlay');
  tenant.registerSettingsHandlers(socket);
  socket.fire('set_event_settings', { king: { mainTime: 30 } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(JSON.parse(JSON.stringify(tenant.eventSettings)), {});
  assert.equal(saved.length, 0);
});
