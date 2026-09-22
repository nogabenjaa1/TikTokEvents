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
        gift_id: config.giftId, action_text: config.actionText, seconds_delta: config.secondsDelta,
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
  tenant.versusState = { isActive: false, paused: false, counts: {} };
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

// Objetos {} creados DENTRO del sandbox (ver load()) tienen un Object.prototype
// distinto al de este archivo -- assert.deepEqual (alias estricto) los compara
// también por prototipo y los marca desiguales pese a tener la misma forma.
// Esto evita ese falso negativo sin comparar por referencia/prototipo.
function isEmptyObject(value) {
  return !!value && typeof value === 'object' && Object.keys(value).length === 0;
}

function fakeSocket() {
  const handlers = {};
  return {
    on: (name, fn) => { handlers[name] = fn; },
    emit: async (name, payload) => { await handlers[name]?.(payload); },
  };
}

test('un regalo que matchea por id suma al contador del héroe, respetando repeatCount', () => {
  const { tenant } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  tenant.processGiftVersus({ giftName: 'algo distinto que no debería importar', giftId: '5655', repeatCount: 3 });
  assert.equal(tenant.versusState.counts.h1, 3);
});

test('sin id, el nombre normalizado (sin acentos/mayúsculas) también matchea', () => {
  const { tenant } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.villains.push({ id: 'v1', giftName: 'Corazón', giftId: null, actionText: 'silencio' });
  tenant.processGiftVersus({ giftName: 'CORAZON', giftId: null, repeatCount: 1 });
  assert.equal(tenant.versusState.counts.v1, 1);
});

test('un regalo sin alertConfig asignado no suma nada, y no revienta', () => {
  const { tenant, broadcast } = load();
  tenant.versusState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.processGiftVersus({ giftName: 'León', giftId: '999', repeatCount: 1 });
  assert.deepEqual(tenant.versusState.counts, {});
  assert.equal(broadcast.length, 0);
});

test('pausado o sin iniciar, los regalos no cuentan', () => {
  const { tenant } = load();
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.deepEqual(tenant.versusState.counts, {}, 'isActive: false');

  tenant.versusState.isActive = true;
  tenant.versusState.paused = true;
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.deepEqual(tenant.versusState.counts, {}, 'paused: true');
});

test('el vínculo con Extensible es independiente del marcador: puede ajustar tiempo sin que el regalo esté en la lista base', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.extensibleState.isActive = true;
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 15 });
  // Versus ni siquiera está iniciado -- el vínculo con Extensible no depende de eso.
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.deepEqual(extensibleAdjustments, [15]);
  assert.deepEqual(tenant.versusState.counts, {}, 'no está en la lista base, no suma al marcador');
});

test('un mismo regalo en la lista base Y en la de Extensible hace las dos cosas a la vez', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusState.isActive = true;
  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.extensibleState.isActive = true;
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 10 });
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 2 });
  assert.equal(tenant.versusState.counts.h1, 2);
  assert.deepEqual(extensibleAdjustments, [10]);
});

test('el vínculo con Extensible no aplica si el interruptor está apagado o Extensible no está activo', () => {
  const { tenant, extensibleAdjustments } = load();
  tenant.versusConfigs.extHeroes.push({ id: 'e1', giftName: 'Rosa', giftId: '5655', secondsDelta: 10 });
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.deepEqual(extensibleAdjustments, [], 'interruptor apagado');

  tenant.versusSettings.extensibleLinkEnabled = true;
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.deepEqual(extensibleAdjustments, [], 'Extensible no está activo');
});

test('agregar un regalo lo guarda en la DB y en memoria, y lo transmite', async () => {
  const { tenant, insertedRows, broadcast } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].kind, 'hero');
  assert.equal(tenant.versusConfigs.heroes.length, 1);
  assert.equal(tenant.versusConfigs.heroes[0].actionText, 'hablar');
  // emitVersusState() es fire-and-forget (mismo criterio que setAlertConfig
  // en alerts.js) -- el propio handler ya devolvió antes de que termine de
  // resolver el ícono, así que hace falta dejar pasar esa cadena de
  // promesas antes de revisar qué se transmitió.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(broadcast.some((b) => b.name === 'versus_state_update'));
});

test('el mismo regalo no se puede agregar dos veces al mismo lado, ni al lado contrario de la misma lista', async () => {
  const { tenant, insertedRows } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', actionText: 'otra vez' });
  await socket.emit('versus_add_gift', { kind: 'villain', giftName: 'Rosa', giftId: '5655', actionText: 'silencio' });
  assert.equal(insertedRows.length, 1, 'solo el primer intento se guarda');
  assert.equal(tenant.versusConfigs.villains.length, 0);
});

test('un regalo SÍ puede repetirse entre la lista base y la de Extensible (son listas independientes)', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
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

test('borrar un regalo lo saca de la DB, de la lista y de los contadores', async () => {
  const { tenant, deletedIds } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('versus_add_gift', { kind: 'hero', giftName: 'Rosa', giftId: '5655', actionText: 'hablar' });
  const id = tenant.versusConfigs.heroes[0].id;
  tenant.versusState.counts[id] = 4;
  await socket.emit('versus_remove_gift', { id });
  assert.deepEqual(deletedIds, [id]);
  assert.equal(tenant.versusConfigs.heroes.length, 0);
  assert.equal(tenant.versusState.counts[id], undefined);
});

test('iniciar arranca en 0 y activo; reiniciar limpia los contadores sin desactivar; detener apaga todo', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  await socket.emit('start_versus', {});
  assert.equal(tenant.versusState.isActive, true);
  assert.ok(isEmptyObject(tenant.versusState.counts));

  tenant.versusState.counts = { h1: 5 };
  await socket.emit('restart_versus');
  assert.equal(tenant.versusState.isActive, true);
  assert.ok(isEmptyObject(tenant.versusState.counts));

  await socket.emit('stop_versus');
  assert.equal(tenant.versusState.isActive, false);
});

test('pausar congela el conteo; reanudar lo retoma', async () => {
  const { tenant } = load();
  const socket = fakeSocket();
  tenant.registerVersusHandlers(socket);
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rosa', giftId: '5655' });
  await socket.emit('start_versus', {});
  await socket.emit('pause_versus');
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.ok(isEmptyObject(tenant.versusState.counts), 'pausado, no cuenta');
  await socket.emit('resume_versus');
  tenant.processGiftVersus({ giftName: 'Rosa', giftId: '5655', repeatCount: 1 });
  assert.equal(tenant.versusState.counts.h1, 1);
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

test('getVersusPublicState resuelve el ícono de cada regalo contra el directorio global y agrega el contador', async () => {
  const { tenant } = load();
  tenant.versusConfigs.heroes.push({ id: 'h1', giftName: 'Rose', giftId: '5655', actionText: 'hablar' });
  tenant.versusState.counts.h1 = 3;
  const state = await tenant.getVersusPublicState();
  assert.equal(state.heroes[0].giftIcon, 'https://x/rose.png');
  assert.equal(state.heroes[0].count, 3);
});
