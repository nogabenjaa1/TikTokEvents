import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLocalEventSettings, saveLocalEventSettings, readLegacyEventSettings,
  planLegacyMigration, markLegacyMigrationDone, ownerFromToken,
} from './eventSettingsStore.js';

function memory(initial = {}) {
  const data = { ...initial };
  return { read: (k) => (k in data ? data[k] : null), write: (k, v) => { data[k] = String(v); }, data };
}
const LEGACY = {
  tkc_king_draft: JSON.stringify({ mainTime: 30, snipeTime: 5, selectedGift: { name: 'Rosa', coins: 1, icon: 'https://x/r.png' } }),
  tkc_zub_draft: JSON.stringify({ minCoins: 50 }),
};

test('la copia de este navegador es de una cuenta: otra cuenta no la ve', () => {
  const m = memory();
  saveLocalEventSettings('lic-A', { king: { mainTime: 90 } }, null, m.write);
  assert.deepEqual(loadLocalEventSettings('lic-A', m.read), { king: { mainTime: 90 } });
  assert.deepEqual(loadLocalEventSettings('lic-B', m.read), {});
  assert.deepEqual(loadLocalEventSettings(null, m.read), {}, 'sin sesión no hay copia');
});

test('sin sesión no se escribe nada', () => {
  const m = memory();
  saveLocalEventSettings(null, { king: { mainTime: 90 } }, null, m.write);
  assert.deepEqual(m.data, {});
});

test('las claves de antes nunca se usan para pintar el panel', () => {
  const m = memory(LEGACY);
  assert.deepEqual(loadLocalEventSettings('lic-A', m.read), {});
  assert.equal(readLegacyEventSettings(m.read).king.mainTime, 30);
});

test('datos corruptos o de otro tipo se ignoran, nunca rompen el panel', () => {
  assert.deepEqual(loadLocalEventSettings('A', memory({ tkc_event_settings: '{no' }).read), {});
  assert.deepEqual(loadLocalEventSettings('A', memory({ tkc_event_settings: '[1]' }).read), {});
  assert.deepEqual(loadLocalEventSettings('A', memory({ tkc_event_settings: JSON.stringify({ owner: 'A', settings: { king: 'x', otro: {} } }) }).read), {});
  assert.deepEqual(readLegacyEventSettings(memory({ tkc_king_draft: '"x"', tkc_zub_draft: '{mal' }).read), {});
});

test('migración: cuenta con claves viejas y nada en el servidor sube todo', () => {
  const m = memory(LEGACY);
  const plan = planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write);
  assert.deepEqual(Object.keys(plan).sort(), ['king', 'zub']);
  assert.deepEqual(plan.king.selectedGift, { name: 'Rosa', icon: 'https://x/r.png', coins: 1 }, 'ya con la forma del servidor');
});

test('migración: lo guardado en el servidor gana; solo se completa lo que falta', () => {
  const m = memory(LEGACY);
  const plan = planLegacyMigration({ owner: 'lic-A', server: { king: { mainTime: 120 } } }, m.read, m.write);
  assert.deepEqual(Object.keys(plan), ['zub'], 'king del servidor no se toca');
});

test('migración: si el servidor ya tiene todo, no hay nada que subir y queda hecha', () => {
  const m = memory(LEGACY);
  assert.equal(planLegacyMigration({ owner: 'lic-A', server: { king: {}, zub: {} } }, m.read, m.write), null);
  assert.equal(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), null, 'no se repite');
});

test('migración: navegador compartido, las claves viejas son solo de la primera cuenta', () => {
  const m = memory(LEGACY);
  assert.ok(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), 'A es la primera');
  assert.equal(planLegacyMigration({ owner: 'lic-B', server: {} }, m.read, m.write), null, 'B nunca las recibe');
  assert.ok(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), 'A todavía puede terminarla');
});

test('migración interrumpida: se repite hasta que el servidor la confirma, y después nunca más', () => {
  const m = memory(LEGACY);
  assert.ok(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write));
  assert.ok(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), 'sin confirmar: se vuelve a intentar');
  markLegacyMigrationDone(m.write);
  assert.equal(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), null);
});

test('sin claves viejas no hay nada que migrar', () => {
  const m = memory();
  assert.equal(planLegacyMigration({ owner: 'lic-A', server: {} }, m.read, m.write), null);
  assert.equal(m.data.tkc_event_settings_migrated, '1');
});

test('el dueño sale del token de sesión; un token raro no rompe nada', () => {
  const payload = btoa(JSON.stringify({ sub: 'lic-123', typ: 'session' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(ownerFromToken(`h.${payload}.firma`), 'lic-123');
  assert.equal(ownerFromToken(null), null);
  assert.equal(ownerFromToken('no-es-un-token'), null);
  assert.equal(ownerFromToken('a.%%%.b'), null);
});

test('la copia guarda también lo último confirmado, para no perder lo pendiente al recargar', async () => {
  const { loadLocalEventCache } = await import('./eventSettingsStore.js');
  const m = memory();
  saveLocalEventSettings('lic-A', { zub: { minCoins: 333 } }, { zub: { minCoins: 26 } }, m.write);
  assert.deepEqual(loadLocalEventCache('lic-A', m.read), { settings: { zub: { minCoins: 333 } }, base: { zub: { minCoins: 26 } } });
  assert.deepEqual(loadLocalEventCache('lic-B', m.read), { settings: {}, base: null }, 'de otra cuenta: nada');
  saveLocalEventSettings('lic-A', { zub: { minCoins: 1 } }, null, m.write);
  assert.equal(loadLocalEventCache('lic-A', m.read).base, null, 'copia sin base: no se sabe qué se confirmó');
});
