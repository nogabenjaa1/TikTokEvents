const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sanitizeEventSettings, sanitizeEventEntry, EVENT_SETTINGS_IDS } = require('./lib/eventSettings');

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

// El panel tiene su propia copia de estas reglas (frontend/src/eventSettingsSchema.js)
// para comparar lo que tiene con lo que devuelve el servidor. Si se separan,
// cada vuelta del servidor parecería un cambio y las pestañas se reenviarían
// los ajustes sin parar.
test('las reglas del panel dan exactamente lo mismo que las del servidor', async () => {
  const { normalizeEventEntry } = await import('../frontend/src/eventSettingsSchema.js');
  const samples = {
    king: { selectedGift: { name: ' Rosa ', coins: '1.4', icon: 'https://x/r.png', id: '5655', diamond_count: 1 }, selectedInstaWin: { name: 'Ninguno', coins: 0, icon: 'http://x' }, mainTime: 15.6, snipeTime: -3, otro: 1 },
    zub: { mainTime: 99999, snipeTime: '20', tiebreakTime: null, minCoins: 50 },
    elim: { selectedGift: null, selectedInstaWin: { name: 'x'.repeat(80), coins: 5, id: 'abc' }, baseTime: 60, rejoinTime: 30, fastMode: true, eliminationsPerRound: 2, lockedMode: 'si' },
    roulette: { entryMode: 'gift', keyword: 'participo', entryWindowSec: 300, selectedGift: { name: 'Rosa', coins: 1 }, winnerRule: 'position', winnerPosition: 24, fastMode: false, eliminationsPerRound: 1 },
    extensible: { baseTimeSec: 60, secondsPerFollow: 5, secondsPerGift: 3, reverseMode: false },
    goal: { targetType: 'coins', targetInput: '500', title: 'Silla nueva' },
  };
  for (const [id, raw] of Object.entries(samples)) {
    assert.deepEqual(normalizeEventEntry(id, raw), sanitizeEventEntry(id, raw), id);
  }
});

// Los manejadores de socket reales (lib/tenant/*.js) con la base simulada.
function loadTenantModule(file, { db = {}, extra = {} } = {}) {
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('eventSettings') ? require('./lib/eventSettings')
      : name.includes('tenantSanitizers') ? require('./lib/tenantSanitizers')
      : name.includes('tenantHelpers') ? require('./lib/tenantHelpers')
      : name.includes('/db') ? db : {}),
    console, Math, Number, String, Object, Array, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve(`./lib/tenant/${file}`), 'utf8'), context);
  const tenant = Object.assign(Object.create(context.module.exports), { licenseId: 'lic-1', logId: 'test' }, extra);
  const sent = [];
  tenant.broadcast = { emit: (name, payload) => sent.push({ name, payload }) };
  return { tenant, sent };
}

function fakeSocket(authMethod, sent = []) {
  const handlers = {};
  return {
    authMethod,
    on: (n, fn) => { handlers[n] = fn; },
    to: (room) => ({ emit: (name, payload) => sent.push({ room, name, payload }) }),
    fire: (n, ...args) => handlers[n]?.(...args),
  };
}

function settingsTenant() {
  const saved = [];
  let release = null;
  const db = {
    setEventSettings: (id, map) => {
      saved.push({ id, map: JSON.parse(JSON.stringify(map)) });
      return new Promise((r) => { release = r; });
    },
  };
  const { tenant } = loadTenantModule('settings', { db, extra: { eventSettings: {}, theme: { style: 'default', accent: 'purple', customColor: '#7C3AED' } } });
  return { tenant, saved, releaseWrite: () => release?.() };
}

const flush = () => new Promise((r) => setImmediate(r));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('set_event_settings mezcla por evento, sanea, responde y avisa a las demás pestañas', async () => {
  const { tenant, saved } = settingsTenant();
  tenant.eventSettings = { zub: { minCoins: 100 } };
  const sent = [];
  const socket = fakeSocket('jwt', sent);
  tenant.registerSettingsHandlers(socket);
  let reply = null;
  socket.fire('set_event_settings', { king: { mainTime: 30, otro: 1 }, basura: {} }, (r) => { reply = r; });
  await flush();
  assert.deepEqual(plain(tenant.eventSettings), { zub: { minCoins: 100 }, king: { mainTime: 30 } }, 'zub no se pierde');
  assert.equal(reply.ok, true);
  assert.deepEqual(plain(reply.accepted), { king: { mainTime: 30 } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'lic-1');
  assert.ok(sent.some((s) => s.name === 'event_settings_update' && s.room === 'lic-1'), 'va al room de la licencia, sin el emisor');
});

test('dos pestañas que cambian eventos distintos casi a la vez no se pisan', async () => {
  const { tenant } = settingsTenant();
  const a = fakeSocket('jwt');
  const b = fakeSocket('jwt');
  tenant.registerSettingsHandlers(a);
  tenant.registerSettingsHandlers(b);
  a.fire('set_event_settings', { king: { mainTime: 30 } });
  b.fire('set_event_settings', { zub: { minCoins: 5 } });
  await flush();
  assert.deepEqual(plain(tenant.eventSettings), { king: { mainTime: 30 }, zub: { minCoins: 5 } });
});

test('las escrituras a la base van de a una y la última guarda lo más nuevo', async () => {
  const { tenant, saved, releaseWrite } = settingsTenant();
  const socket = fakeSocket('jwt');
  tenant.registerSettingsHandlers(socket);
  socket.fire('set_event_settings', { king: { mainTime: 10 } });
  socket.fire('set_event_settings', { king: { mainTime: 20 } });
  socket.fire('set_event_settings', { king: { mainTime: 30 } });
  await flush();
  assert.equal(saved.length, 1, 'mientras escribe no lanza otra');
  releaseWrite();
  await flush(); await flush();
  assert.equal(saved.length, 2, 'una sola escritura más para todo lo que llegó mientras tanto');
  assert.equal(saved[1].map.king.mainTime, 30);
});

test('un socket sin sesión de panel (overlay, clave en la URL) no puede cambiar los ajustes', async () => {
  for (const method of ['overlay', 'key']) {
    const { tenant, saved } = settingsTenant();
    const socket = fakeSocket(method);
    tenant.registerSettingsHandlers(socket);
    let reply = null;
    socket.fire('set_event_settings', { king: { mainTime: 30 } }, (r) => { reply = r; });
    await flush();
    assert.deepEqual(plain(tenant.eventSettings), {}, method);
    assert.equal(saved.length, 0, method);
    assert.equal(reply.ok, false, method);
  }
});

test('mensajes inválidos se rechazan sin tocar nada', async () => {
  const { tenant, saved } = settingsTenant();
  tenant.eventSettings = { king: { mainTime: 15 } };
  const socket = fakeSocket('jwt');
  tenant.registerSettingsHandlers(socket);
  for (const bad of [null, 'texto', [1], { noExiste: {} }, { king: 'x' }]) {
    let reply = null;
    socket.fire('set_event_settings', bad, (r) => { reply = r; });
    assert.equal(reply.ok, false);
  }
  assert.equal(saved.length, 0);
  socket.fire('set_event_settings', { king: { mainTime: 30 } }); // sin ack: no rompe
  await flush();
  assert.equal(tenant.eventSettings.king.mainTime, 30);
  assert.equal(saved.length, 1);
});

test('guardar ajustes no toca una partida en curso', async () => {
  const { tenant } = settingsTenant();
  tenant.contestState = { isActive: true, mode: 'main', timeLeft: 9, mainTime: 15, lastParticipant: { username: 'ana' } };
  const before = JSON.stringify(tenant.contestState);
  const socket = fakeSocket('jwt');
  tenant.registerSettingsHandlers(socket);
  socket.fire('set_event_settings', { king: { mainTime: 60, selectedGift: { name: 'León', coins: 29999 } } });
  await flush();
  assert.equal(JSON.stringify(tenant.contestState), before);
});

// ── Cambios en vivo: un ajuste que no es el tiempo no reinicia el reloj ──
function liveTenant(file, register, stateKey, state, extra = {}) {
  const { tenant, sent } = loadTenantModule(file, { db: { incrementUsage: async () => {} }, extra: { [stateKey]: state, ...extra } });
  const socket = fakeSocket('jwt');
  tenant[register](socket);
  return { tenant, socket, sent };
}

test('Rey del Trono: cambiar el regalo con el reloj corriendo no lo reinicia; cambiar el tiempo sí', () => {
  const { tenant, socket } = liveTenant('king', 'registerKingHandlers', 'contestState',
    { isActive: true, mode: 'main', timeLeft: 4, mainTime: 15, snipeTime: 5, lastParticipant: { username: 'ana' } });
  const base = { targetGiftName: 'León', targetGiftIcon: '', targetGiftCoins: 29999, instaWinGiftName: '', instaWinGiftIcon: '', instaWinGiftCoins: 0, mainTime: 15, snipeTime: 5 };
  socket.fire('update_settings', base);
  assert.equal(tenant.contestState.timeLeft, 4);
  assert.equal(tenant.contestState.targetGiftName, 'León');
  assert.equal(tenant.contestState.lastParticipant.username, 'ana', 'quien tiene el trono se queda');
  socket.fire('update_settings', { ...base, mainTime: 30 });
  assert.equal(tenant.contestState.timeLeft, 30);
});

test('Zubastinis: cambiar el mínimo no reinicia el reloj', () => {
  const { tenant, socket } = liveTenant('zub', 'registerZubHandlers', 'zubState',
    { isActive: true, mode: 'snipe', timeLeft: 3, mainTime: 60, snipeTime: 20, tiebreakTime: 15, minCoins: 0, leaderboard: { a: { coins: 10 } } },
    { getZubPublicState() { return {}; } });
  socket.fire('update_zub_settings', { mainTime: 60, snipeTime: 20, tiebreakTime: 15, minCoins: 500 });
  assert.equal(tenant.zubState.timeLeft, 3);
  assert.equal(tenant.zubState.minCoins, 500);
  assert.equal(tenant.zubState.leaderboard.a.coins, 10);
  socket.fire('update_zub_settings', { mainTime: 60, snipeTime: 25, tiebreakTime: 15, minCoins: 500 });
  assert.equal(tenant.zubState.timeLeft, 25);
});

test('Eliminación: cambiar el regalo no reinicia el tiempo para unirse ni borra participantes', () => {
  const { tenant, socket } = liveTenant('elim', 'registerElimHandlers', 'elimState',
    { isActive: true, mode: 'joining', timeLeft: 7, baseTime: 60, rejoinTime: 30, participants: [{ username: 'ana' }], lockedMode: false },
    { getElimPublicState() { return {}; } });
  const cfg = { targetGiftName: 'León', targetGiftIcon: '', targetGiftCoins: 29999, baseTime: 60, rejoinTime: 30, fastMode: true, eliminationsPerRound: 2, lockedMode: false };
  socket.fire('update_elim_settings', cfg);
  assert.equal(tenant.elimState.timeLeft, 7);
  assert.equal(tenant.elimState.participants.length, 1);
  socket.fire('update_elim_settings', { ...cfg, baseTime: 90 });
  assert.equal(tenant.elimState.timeLeft, 90);
});

test('Ruleta: cambiar la palabra clave no reinicia la cuenta para entrar ni borra entradas', () => {
  const { tenant, socket } = liveTenant('roulette', 'registerRouletteHandlers', 'rouletteState',
    { isActive: true, mode: 'joining', timeLeft: 12, entryWindowSec: 300, entries: [{ username: 'ana' }] },
    { getRoulettePublicState() { return {}; } });
  const cfg = { entryMode: 'chat', keyword: 'yo', entryWindowSec: 300, winnerRule: 'first', winnerPosition: 1, fastMode: false, eliminationsPerRound: 1 };
  socket.fire('update_roulette_settings', cfg);
  assert.equal(tenant.rouletteState.timeLeft, 12);
  assert.equal(tenant.rouletteState.keyword, 'yo');
  assert.equal(tenant.rouletteState.entries.length, 1);
  socket.fire('update_roulette_settings', { ...cfg, entryWindowSec: 120 });
  assert.equal(tenant.rouletteState.timeLeft, 120);
});
