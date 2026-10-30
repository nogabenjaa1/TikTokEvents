import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsSync } from './settingsSync.js';

// Simulación del flujo real de una conexión (ver App.jsx y attachSocket en
// tenant.js): el servidor tiene lo guardado en la base y lo manda al conectar;
// el cliente arranca con lo de este navegador (o los valores de fábrica).
const FACTORY = { style: 'default', accent: 'purple', customColor: '#7C3AED' };
const same = (a, b) => a.style === b.style && a.accent === b.accent && a.customColor === b.customColor;

function fakeServer(saved) {
  return { saved, set(value) { this.saved = value; } };
}

// Política de ANTES: al conectar se mandaba lo local a ciegas (resincronización
// de 'connect' y el primer envío del efecto), y recién después llegaba lo
// guardado. Se deja aquí para reproducir el bug.
function connectOld(server, local) {
  server.set(local); // el panel lo mandaba primero
  return server.saved; // y lo que "recibía" ya era su propio valor
}

// Política de AHORA: el cliente espera el estado del servidor y decide.
function connectNew(server, sync, local) {
  const decision = sync.receive(server.saved, local);
  if (decision === 'keep-local') { server.set(local); sync.sent(local); return local; }
  return server.saved;
}

test('reproduce el bug: un navegador nuevo pisaba el tema guardado con los valores de fábrica', () => {
  const server = fakeServer({ style: 'cute', accent: 'pink', customColor: '#7C3AED' });
  connectOld(server, FACTORY);
  assert.deepEqual(server.saved, FACTORY, 'con la política anterior se perdía lo guardado');
});

test('un navegador nuevo recupera lo guardado sin pisarlo', () => {
  const saved = { style: 'cute', accent: 'pink', customColor: '#7C3AED' };
  const server = fakeServer(saved);
  const sync = createSettingsSync({ initial: FACTORY, same });
  assert.equal(sync.canSend(), false, 'no manda nada antes de recibir el estado');
  const shown = connectNew(server, sync, FACTORY);
  assert.deepEqual(server.saved, saved, 'el servidor conserva lo guardado');
  assert.deepEqual(shown, saved, 'el panel muestra lo guardado');
  assert.equal(sync.canSend(), true);
});

test('un navegador con una copia vieja adopta lo cambiado desde otro dispositivo', () => {
  const stale = { style: 'default', accent: 'blue', customColor: '#7C3AED' };
  const newer = { style: 'cute', accent: 'purple', customColor: '#7C3AED' };
  const server = fakeServer(newer);
  const sync = createSettingsSync({ initial: stale, same });
  const shown = connectNew(server, sync, stale);
  assert.deepEqual(server.saved, newer);
  assert.deepEqual(shown, newer);
});

test('con copia local igual a lo del servidor no cambia nada', () => {
  const value = { style: 'cute', accent: 'blue', customColor: '#7C3AED' };
  const server = fakeServer(value);
  const sync = createSettingsSync({ initial: value, same });
  assert.equal(sync.receive(server.saved, value), 'adopt');
  assert.deepEqual(server.saved, value);
});

test('un cambio hecho antes de recibir el estado se conserva y se guarda', () => {
  const server = fakeServer({ style: 'cute', accent: 'pink', customColor: '#7C3AED' });
  const sync = createSettingsSync({ initial: FACTORY, same });
  const chosen = { style: 'default', accent: 'blue', customColor: '#7C3AED' }; // la persona eligió otro antes de conectar
  const shown = connectNew(server, sync, chosen);
  assert.deepEqual(server.saved, chosen);
  assert.deepEqual(shown, chosen);
});

test('después de sincronizar, los mensajes del servidor son ecos y los cambios se mandan', () => {
  const server = fakeServer(FACTORY);
  const sync = createSettingsSync({ initial: FACTORY, same });
  connectNew(server, sync, FACTORY);
  assert.equal(sync.receive(FACTORY, FACTORY), 'echo');
  const next = { style: 'cute', accent: 'purple', customColor: '#7C3AED' };
  assert.equal(sync.canSend(), true);
  server.set(next); sync.sent(next);
  assert.deepEqual(server.saved, next);
});

test('reconexión sin cambios: adopta lo del servidor (puede haber cambiado en otro dispositivo)', () => {
  const server = fakeServer(FACTORY);
  const sync = createSettingsSync({ initial: FACTORY, same });
  connectNew(server, sync, FACTORY);
  sync.disconnected();
  assert.equal(sync.canSend(), false, 'sin conexión no se manda');
  const fromOther = { style: 'cute', accent: 'blue', customColor: '#7C3AED' };
  server.set(fromOther); // otro dispositivo lo cambió mientras tanto
  const shown = connectNew(server, sync, FACTORY);
  assert.deepEqual(shown, fromOther);
  assert.deepEqual(server.saved, fromOther);
});

test('reconexión con un cambio hecho sin conexión: se manda al reconectar', () => {
  const server = fakeServer(FACTORY);
  const sync = createSettingsSync({ initial: FACTORY, same });
  connectNew(server, sync, FACTORY);
  sync.disconnected();
  const offlineEdit = { style: 'default', accent: 'pink', customColor: '#7C3AED' };
  const shown = connectNew(server, sync, offlineEdit);
  assert.deepEqual(shown, offlineEdit);
  assert.deepEqual(server.saved, offlineEdit);
});

test('funciona igual con la personalización de overlays (comparación por contenido)', () => {
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const factory = { games: { background: { type: 'solid' } } };
  const saved = { games: { background: { type: 'gradient', from: '#14082E', to: '#3B0A63' } } };
  const server = fakeServer(saved);
  const sync = createSettingsSync({ initial: factory, same: sameJson });
  const shown = connectNew(server, sync, structuredClone(factory)); // otro objeto, mismo contenido
  assert.deepEqual(shown, saved);
  assert.deepEqual(server.saved, saved);
});
