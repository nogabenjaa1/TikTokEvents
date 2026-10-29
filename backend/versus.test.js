const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Carga el módulo real de Versus sin DB ni el directorio global de regalos —
// mismo criterio que alerts.test.js/gift-events.test.js.
function load({ dbOverrides = {} } = {}) {
  const insertedRows = [];
  const deletedIds = [];
  let settingsSaved = null;
  const db = {
    insertVersusConfig: async (config) => {
      const row = {
        id: config.id, license_id: config.licenseId, kind: config.kind, gift_name: config.giftName,
        gift_id: config.giftId, gift_icon: config.giftIcon, action_text: config.actionText, seconds_delta: config.secondsDelta,
      };
      insertedRows.push(row);
      return row;
    },
    deleteVersusConfig: async (id) => { deletedIds.push(id); },
    setVersusSettings: async (id, settings) => { settingsSaved = settings; },
    ...dbOverrides,
  };
  const giftDirectory = { load: async () => {}, list: () => [{ id: 5655, name: 'Rose', coins: 1, icon: 'https://x/rose.png' }] };
  const context = {
    module: { exports: {} },
    require: (name) => (
      name.includes('giftCatalog') ? require('./lib/giftCatalog')
      : name.includes('giftDirectory') ? giftDirectory
      : name === 'crypto' ? require('node:crypto')
      : name.includes('/db') ? db
      : {}
    ),
    console, Math, Number, String, Map, Set, Object, Array, Promise,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/versus'), 'utf8'), context);
  const Tenant = { prototype: context.module.exports };
  const tenant = Object.create(Tenant.prototype);
  tenant.licenseId = 'license-1';
  tenant.logId = 'test';
  tenant.versusState = { isActive: false, paused: false, scores: { hero: 0, villain: 0 } };
  tenant.versusSettings = { heroLabel: 'HÉROES', villainLabel: 'VILLANOS', extensibleLinkEnabled: false };
  tenant.versusConfigs = { heroes: [], villains: [], extHeroes: [], extVillains: [] };
  tenant.extensibleState = { isActive: false, finished: false, timeLeft: 0 };
  const broadcast = [];
  tenant.broadcast = { emit: (name, payload) => broadcast.push({ name, payload }) };
  const extensibleAdjustments = [];
  tenant.adjustExtensibleTime = (delta) => extensibleAdjustments.push(delta);
  tenant.maybeDisconnectTikTok = () => {};
  tenant.ensureTikTokConnection = async () => {};
  return { tenant, insertedRows, deletedIds, getSettingsSaved: () => settingsSaved, broadcast, extensibleAdjustments };
}

function fakeSocket() {
  const handlers = {};
  return {
    on: (name, fn) => { handlers[name] = fn; },
    emit: async (name, payload) => { await handlers[name]?.(payload); },
  };
}

// Un regalo como lo arma dispatchGiftEvent (events.js): totalCoins ya es
// monedas x repeatCount.
const gift = (giftName, giftId, diamondCount, repeatCount = 1) => ({ giftName, giftId, diamondCount, repeatCount, totalCoins: diamondCount * repeatCount });

test('un regalo que matchea por id suma sus monedas (de la racha completa) al marcador de su lado', () => {
  const { tenant } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.processGiftVersus(gift('algo distinto que no debería importar', '5655', 1, 3));
  assert.equal(tenant.versusState.scores.hero, 3);
  assert.equal(tenant.versusState.scores.villain, 0);
});

test('varios regalos del mismo lado suman a UN solo marcador (no uno por regalo)', async () => {
  const { tenant } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.versusConfigs.heroes.push({ id: 'h2', giftName: 'Finger Heart', giftId: '5487' });
  tenant.processGiftVersus(gift('Rosa', '5655', 1, 2));
  tenant.processGiftVersus(gift('Finger Heart', '5487', 5));
  assert.equal(tenant.versusState.scores.hero, 7);
  const state = await tenant.getVersusPublicState();
  assert.equal(state.heroScore, 7);
  assert.equal(state.villainScore, 0);
  assert.equal(state.heroes.length, 2, 'la lista sigue siendo la de regalos, cada uno con su ícono');
  assert.equal(state.heroes[0].count, undefined, 'ya no hay contador por regalo');
});

test('sin id, el nombre normalizado (sin acentos/mayúsculas) también matchea', () => {
  const { tenant } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.villains.push({ id: 'v1', giftName: 'Corazón', giftId: null });
  tenant.processGiftVersus(gift('CORAZON', null, 10));
  assert.equal(tenant.versusState.scores.villain, 10);
});

test('un regalo que no está en ninguna lista no suma nada, y no revienta', () => {
  const { tenant, broadcast } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.processGiftVersus(gift('León', '999', 29999));
  assert.equal(tenant.versusState.scores.hero + tenant.versusState.scores.villain, 0);
  assert.equal(broadcast.length, 0);
});

test('pausado o sin iniciar, los regalos no cuentan', () => {
  const { tenant } = load();
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.equal(tenant.versusState.scores.hero, 0, 'isActive: false');

  tenant.versusState.isActive = true;
  tenant.versusState.paused = true;
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.equal(tenant.versusState.scores.hero, 0, 'paused: true');
});

test('el vínculo con Extensible es independiente del marcador: puede ajustar tiempo sin que el regalo esté en la lista base', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.extensibleState.isActive = true;
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 15 });
  // Versus ni siquiera está iniciado -- el vínculo con Extensible no depende de eso.
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.deepEqual(extensibleAdjustments, [15]);
  assert.equal(tenant.versusState.scores.hero, 0, 'no está en la lista base, no suma al marcador');
});

test('un mismo regalo en la lista base Y en la de Extensible hace las dos cosas a la vez', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusState.isActive = true;
  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.extensibleState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 10 });
  tenant.processGiftVersus(gift('Rosa', '5655', 1, 2));
  assert.equal(tenant.versusState.scores.hero, 2);
  assert.deepEqual(extensibleAdjustments, [10]);
});

test('el vínculo con Extensible no aplica si el interruptor está apagado o Extensible no está activo', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 10 });
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.deepEqual(extensibleAdjustments, [], 'interruptor apagado');

  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.deepEqual(extensibleAdjustments, [], 'Extensible no está activo');
});

test('agregar un regalo lo guarda en la DB (con el ícono del panel) y en memoria, y lo transmite', async () => {
  const { tenant, insertedRows, broadcast } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', giftIcon: 'https://x/rosa.png' });
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].kind, 'hero');
  assert.equal(insertedRows[0].gift_icon, 'https://x/rosa.png');
  assert.equal(tenant.versusConfigs.heroes.length, 1);
  // emitVersusState() es fire-and-forget (mismo criterio que setAlertConfig
  // en alerts.js) -- el propio handler ya devolvió antes de que termine de
  // resolver el ícono, así que hace falta dejar pasar esa cadena de
  // promesas antes de revisar qué se transmitió.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(broadcast.some((b) => b.name === 'versus_state_update'));
});

test('el ícono que manda el panel solo se guarda si es una imagen por https', async () => {
  const { tenant, insertedRows } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', giftIcon: 'javascript:alert(1)' });
  assert.equal(insertedRows[0].gift_icon, null);
});

test('el mismo regalo no se puede agregar dos veces al mismo lado, ni al lado contrario de la misma lista', async () => {
  const { tenant, insertedRows } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655' });
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655' });
  await socket.emit('versus_add_gift', { kind: 'villain', giftName: 'Rosa', giftId: '5655' });
  assert.equal(insertedRows.length, 1, 'solo el primer intento se guarda');
  assert.equal(tenant.versusConfigs.villains.length, 0);
});

test('un regalo SÍ puede repetirse entre la lista base y la de Extensible (son listas independientes)', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655' });
  await socket.emit('versus_add_gift', { kind: 'ext_hero', giftName: 'Rosa', giftId: '5655', secondsDelta: 10 });
  assert.equal(tenant.versusConfigs.heroes.length, 1);
  assert.equal(tenant.versusConfigs.extHeroes.length, 1);
});

test('la lista base tiene tope de 30 y la de Extensible de 10', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  for (let i = 0; i < 10; i++) {
    await socket.emit('versus_add_gift', { kind: 'ext_hero', giftName: `Regalo${i}`, giftId: String(i), secondsDelta: 1 });
  }
  await socket.emit('versus_add_gift', { kind: 'ext_hero', giftName: 'Uno más', giftId: '999', secondsDelta: 1 });
  assert.equal(tenant.versusConfigs.extHeroes.length, 10, 'no pasa del tope de 10');
});

test('borrar un regalo lo saca de la DB y de la lista; lo que ya sumó se queda en el marcador', async () => {
  const { tenant, deletedIds } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655' });
  const id = tenant.versusConfigs.heroes[0].id;
  tenant.versusState.scores.hero = 4;
  await socket.emit('versus_remove_gift', { id });
  assert.deepEqual(deletedIds, [id]);
  assert.equal(tenant.versusConfigs.heroes.length, 0);
  assert.equal(tenant.versusState.scores.hero, 4);
});

test('iniciar arranca en 0 y activo; reiniciar pone el marcador en 0 sin desactivar; detener apaga todo', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('start_versus', {});
  assert.equal(tenant.versusState.isActive, true);
  assert.equal(tenant.versusState.scores.hero + tenant.versusState.scores.villain, 0);

  tenant.versusState.scores.hero = 5;
  tenant.versusState.scores.villain = 2;
  await socket.emit('restart_versus');
  assert.equal(tenant.versusState.isActive, true);
  assert.equal(tenant.versusState.scores.hero + tenant.versusState.scores.villain, 0);

  await socket.emit('stop_versus');
  assert.equal(tenant.versusState.isActive, false);
});

test('pausar congela el marcador; reanudar lo retoma', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  await socket.emit('start_versus', {});
  await socket.emit('pause_versus');
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.equal(tenant.versusState.scores.hero, 0, 'pausado, no cuenta');
  await socket.emit('resume_versus');
  tenant.processGiftVersus(gift('Rosa', '5655', 1));
  assert.equal(tenant.versusState.scores.hero, 1);
});

test('las etiquetas y el interruptor de vínculo se guardan y sobreviven a valores vacíos (se mantiene lo anterior)', async () => {
  const { tenant, getSettingsSaved } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('update_versus_settings', { heroLabel: 'BUENOS', villainLabel: '', extensibleLinkEnabled: true });
  assert.equal(tenant.versusSettings.heroLabel, 'BUENOS');
  assert.equal(tenant.versusSettings.villainLabel, 'VILLANOS', 'string vacío no pisa el valor anterior');
  assert.equal(tenant.versusSettings.extensibleLinkEnabled, true);
  assert.deepEqual(getSettingsSaved(), tenant.versusSettings);
});

test('la acción es una por lado; sin guardar, toma la que tenía el primer regalo (versión anterior)', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  let state = await tenant.getVersusPublicState();
  assert.equal(state.heroAction, 'hablar');
  assert.equal(state.villainAction, '');

  await socket.emit('update_versus_settings', { heroAction: '', villainAction: '  silencio  ' });
  state = await tenant.getVersusPublicState();
  assert.equal(state.heroAction, '', 'vaciarla a propósito sí se respeta');
  assert.equal(state.villainAction, 'silencio');
});

test('getVersusPublicState resuelve el ícono contra el directorio global y, si no está, usa el que guardó el panel', async () => {
  const { tenant } = load();
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rose', giftId: '5655', savedIcon: 'https://x/viejo.png' });
  tenant.versusConfigs.heroes.push({ id: 'h2', giftName: 'Finger Heart', giftId: '5487', savedIcon: 'https://x/finger.png' });
  tenant.versusState.scores.hero = 3;
  const state = await tenant.getVersusPublicState();
  assert.equal(state.heroes[0].giftIcon, 'https://x/rose.png', 'el directorio manda si lo tiene');
  assert.equal(state.heroes[1].giftIcon, 'https://x/finger.png', 'no está en el directorio: el del panel');
  assert.equal(state.heroes[1].savedIcon, undefined, 'el dato interno no viaja');
  assert.equal(state.heroScore, 3);
});
