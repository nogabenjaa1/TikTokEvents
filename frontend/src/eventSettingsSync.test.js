import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventSync, createFieldTracker, sameValue } from './eventSettingsSync.js';
import { normalizeEventEntry } from './eventSettingsSchema.js';

const KING_A = { mainTime: 30, snipeTime: 5 };
const KING_B = { mainTime: 60, snipeTime: 5 };

// Sincronización ya conectada, con `server` como lo último confirmado.
function connected(server = {}) {
  const sync = createEventSync();
  sync.rebase(server, server, 'lic-A');
  sync.receive(server, server);
  return sync;
}

test('comparación por contenido, sin importar el orden de las claves', () => {
  assert.equal(sameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue({ a: [1, 2] }, { a: [2, 1] }), false);
});

test('el regalo elegido, ya normalizado, es igual a lo que devuelve el servidor (sin ciclos)', () => {
  const fromPicker = { coins: 1, id: '5655', icon: 'https://x/r.png', name: 'Rosa', diamond_count: 1 };
  const local = normalizeEventEntry('king', { selectedGift: fromPicker, mainTime: 15 });
  const server = { mainTime: 15, selectedGift: { name: 'Rosa', icon: 'https://x/r.png', coins: 1, id: 5655 } };
  assert.equal(sameValue(local, server), true);
});

test('nada se manda antes de recibir lo del servidor', () => {
  const sync = createEventSync();
  sync.rebase({}, null, 'lic-A');
  assert.equal(sync.outgoing({ king: KING_A }), null);
});

test('panel: el montaje no se guarda, y después solo los campos que cambiaron', () => {
  const patchOf = createFieldTracker();
  assert.equal(patchOf({ mainTime: 15, snipeTime: 5 }), null, 'montaje');
  assert.equal(patchOf({ mainTime: 15, snipeTime: 5 }), null, 'segunda pasada del modo estricto');
  assert.deepEqual(patchOf({ mainTime: 20, snipeTime: 5 }), { mainTime: 20 });
  assert.deepEqual(patchOf({ mainTime: 20, snipeTime: 9 }), { snipeTime: 9 }, 'mainTime no se repite');
});

test('copia vieja en este navegador y versión más nueva en el servidor: se muestra la del servidor', () => {
  const sync = createEventSync();
  sync.rebase({ king: KING_A }, { king: KING_A }, 'lic-A');
  const r = sync.receive({ king: KING_B }, { king: KING_A });
  assert.deepEqual(r.merged, { king: KING_B });
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.replaced, ['king']);
  assert.equal(sync.outgoing(r.merged), null, 'y no se reenvía nada');
});

test('recargar con un cambio sin confirmar: se conserva y se manda (antes se perdía)', () => {
  // Lo que quedó en el navegador: se veía 333, lo último confirmado era 26.
  const sync = createEventSync();
  sync.rebase({ zub: { minCoins: 333 } }, { zub: { minCoins: 26 } }, 'lic-A');
  const r = sync.receive({ zub: { minCoins: 26 } }, { zub: { minCoins: 333 } });
  assert.deepEqual(r.merged, { zub: { minCoins: 333 } });
  assert.deepEqual(r.pending, ['zub']);
  assert.deepEqual(sync.outgoing(r.merged), { zub: { minCoins: 333 } });
});

test('sin conexión: lo cambiado aquí se manda al volver, y lo cambiado en otro evento se respeta', () => {
  const sync = connected({ king: KING_A, zub: { minCoins: 0 } });
  sync.disconnected();
  const local = { king: KING_B, zub: { minCoins: 0 } };
  assert.equal(sync.outgoing(local), null, 'desconectado: no se manda');
  const r = sync.receive({ king: KING_A, zub: { minCoins: 99 } }, local);
  assert.deepEqual(r.merged, { king: KING_B, zub: { minCoins: 99 } });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(sync.outgoing(r.merged), { king: { mainTime: 60 } }, 'solo el campo cambiado');
});

test('dos pestañas, campos distintos del mismo evento: no se pisan', () => {
  const sync = connected({ zub: { mainTime: 60, snipeTime: 20, minCoins: 0 } });
  const local = { zub: { mainTime: 60, snipeTime: 20, minCoins: 25 } }; // aquí: mínimo, sin confirmar
  const r = sync.receive({ zub: { mainTime: 60, snipeTime: 40, minCoins: 0 } }, local); // allá: snipe
  assert.deepEqual(r.merged.zub, { mainTime: 60, snipeTime: 40, minCoins: 25 });
  assert.deepEqual(r.conflicts, [], 'no es un conflicto: son campos distintos');
  assert.deepEqual(sync.outgoing(r.merged), { zub: { minCoins: 25 } }, 'no se reenvía el snipe viejo');
});

test('el mismo campo cambiado en los dos lados: gana lo de aquí y se avisa', () => {
  const sync = connected({ king: KING_A });
  sync.disconnected();
  const r = sync.receive({ king: { mainTime: 45, snipeTime: 5 } }, { king: KING_B });
  assert.deepEqual(r.merged.king, KING_B);
  assert.deepEqual(r.conflicts, ['king']);
});

test('dos pestañas: lo que llega de la otra no pisa lo que esta tiene sin confirmar', () => {
  const sync = connected({});
  const r = sync.receive({ zub: { minCoins: 5 } }, { king: KING_A });
  assert.deepEqual(r.merged, { king: KING_A, zub: { minCoins: 5 } });
  assert.deepEqual(r.replaced, ['zub']);
});

test('dos pestañas, mismo ajuste: si esta ya no tiene nada pendiente, se ve lo último guardado', () => {
  const sync = connected({});
  sync.accepted({ king: KING_A });
  const r = sync.receive({ king: KING_B }, { king: KING_A });
  assert.deepEqual(r.merged, { king: KING_B });
  assert.deepEqual(r.replaced, ['king']);
  assert.deepEqual(r.conflicts, []);
});

test('lo enviado sin respuesta (o que falló al guardarse) sigue pendiente', () => {
  const sync = connected({});
  assert.deepEqual(sync.outgoing({ king: KING_A }), { king: KING_A });
  sync.disconnected(); // sin respuesta, o respondió ok: false
  const r = sync.receive({}, { king: KING_A });
  assert.deepEqual(r.pending, ['king']);
  sync.accepted({ king: KING_A });
  assert.equal(sync.outgoing({ king: KING_A }), null, 'confirmado: ya no hay nada pendiente');
});

test('cuenta nueva en el mismo navegador: lo de la cuenta anterior no se sube ni se guarda como base', () => {
  const sync = createEventSync();
  sync.rebase({ king: KING_A }, { king: KING_A }, 'lic-A');
  sync.rebase({}, null, 'lic-B');
  const r = sync.receive({ zub: { minCoins: 1 } }, {});
  assert.deepEqual(r.merged, { zub: { minCoins: 1 } });
  assert.equal(sync.outgoing(r.merged), null);
  assert.equal(sync.baseFor('lic-A'), null, 'la base de B nunca se guarda con la copia de A');
  assert.deepEqual(sync.baseFor('lic-B'), { zub: { minCoins: 1 } });
});

test('el eco de un guardado propio más viejo no es un conflicto', () => {
  const sync = connected({ zub: { minCoins: 0 } });
  assert.deepEqual(sync.outgoing({ zub: { minCoins: 5 } }), { zub: { minCoins: 5 } }); // se manda 5
  // Antes de la respuesta se escribe 6; llega el anuncio del guardado del 5.
  const r = sync.receive({ zub: { minCoins: 5 } }, { zub: { minCoins: 6 } });
  assert.deepEqual(r.merged.zub, { minCoins: 6 }, 'lo de ahora se conserva');
  assert.deepEqual(r.conflicts, [], 'no hubo nadie más');
  assert.deepEqual(sync.outgoing(r.merged), { zub: { minCoins: 6 } });
});

test('un anuncio igual a lo que ya se tiene no cambia nada (quien guardó recibe su propio anuncio)', () => {
  const sync = connected({ zub: { minCoins: 0 } });
  sync.outgoing({ zub: { minCoins: 5 } });
  const r = sync.receive({ zub: { minCoins: 5 } }, { zub: { minCoins: 5 } });
  assert.deepEqual(r.replaced, []);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.pending, []);
});
