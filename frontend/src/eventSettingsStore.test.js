import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLocalEventSettings, saveLocalEventSettings, mergeMissingEvents, sameEventSettings,
  legacyMigrationPending, markLegacyMigrationDone,
} from './eventSettingsStore.js';

function memory(initial = {}) {
  const data = { ...initial };
  return { read: (k) => (k in data ? data[k] : null), write: (k, v) => { data[k] = String(v); }, data };
}

test('lo guardado se vuelve a leer igual', () => {
  const m = memory();
  saveLocalEventSettings({ king: { mainTime: 90 }, goal: { targetType: 'followers' } }, m.write);
  assert.deepEqual(loadLocalEventSettings(m.read), { king: { mainTime: 90 }, goal: { targetType: 'followers' } });
});

test('las claves de antes (una por evento) se leen si no hay nada nuevo', () => {
  const m = memory({
    tkc_king_draft: JSON.stringify({ mainTime: 30 }),
    'tiktok-concurso-extensible-settings': JSON.stringify({ baseTimeSec: 120 }),
  });
  assert.deepEqual(loadLocalEventSettings(m.read), { king: { mainTime: 30 }, extensible: { baseTimeSec: 120 } });
});

test('lo nuevo gana sobre las claves de antes', () => {
  const m = memory({
    tkc_king_draft: JSON.stringify({ mainTime: 30 }),
    tkc_event_settings: JSON.stringify({ king: { mainTime: 45 } }),
  });
  assert.equal(loadLocalEventSettings(m.read).king.mainTime, 45);
});

test('datos corruptos o de otro tipo se ignoran, nunca rompen el panel', () => {
  assert.deepEqual(loadLocalEventSettings(memory({ tkc_event_settings: '{no' }).read), {});
  assert.deepEqual(loadLocalEventSettings(memory({ tkc_event_settings: '[1]', tkc_zub_draft: '"x"' }).read), {});
  assert.deepEqual(loadLocalEventSettings(memory({ tkc_event_settings: JSON.stringify({ king: 'x', otro: {} }) }).read), {});
});

test('migración: lo del servidor manda y solo se completan los eventos que no tiene', () => {
  const { merged, added } = mergeMissingEvents(
    { king: { mainTime: 60 } },
    { king: { mainTime: 10 }, zub: { minCoins: 5 } },
  );
  assert.deepEqual(merged, { king: { mainTime: 60 }, zub: { minCoins: 5 } });
  assert.equal(added, true);
});

test('migración: si el servidor ya tiene todo, no hay nada que subir', () => {
  const { merged, added } = mergeMissingEvents({ king: { mainTime: 60 } }, { king: { mainTime: 10 } });
  assert.deepEqual(merged, { king: { mainTime: 60 } });
  assert.equal(added, false);
});

test('la migración ocurre una sola vez por navegador (no mezcla cuentas)', () => {
  const m = memory();
  assert.equal(legacyMigrationPending(m.read), true);
  markLegacyMigrationDone(m.write);
  assert.equal(legacyMigrationPending(m.read), false);
});

test('comparación por contenido', () => {
  assert.equal(sameEventSettings({ a: { b: 1 } }, { a: { b: 1 } }), true);
  assert.equal(sameEventSettings(undefined, {}), true);
  assert.equal(sameEventSettings({ a: 1 }, { a: 2 }), false);
});
