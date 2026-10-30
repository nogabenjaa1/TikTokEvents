import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventSync, createMountGuard, sameValue } from './eventSettingsSync.js';
import { normalizeEventEntry } from './eventSettingsSchema.js';

const KING_A = { mainTime: 30, snipeTime: 5 };
const KING_B = { mainTime: 60, snipeTime: 5 };

test('comparación por contenido, sin importar el orden de las claves', () => {
  assert.equal(sameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue({ a: [1, 2] }, { a: [2, 1] }), false);
});

test('el regalo elegido, ya normalizado, es igual a lo que devuelve el servidor (sin ciclos)', () => {
  // Lo que el selector entrega: campos de más, id como texto.
  const fromPicker = { coins: 1, id: '5655', icon: 'https://x/r.png', name: 'Rosa', diamond_count: 1 };
  const local = normalizeEventEntry('king', { selectedGift: fromPicker, mainTime: 15 });
  const server = { mainTime: 15, selectedGift: { name: 'Rosa', icon: 'https://x/r.png', coins: 1, id: 5655 } };
  assert.equal(sameValue(local, server), true);
});

test('nada se manda antes de recibir lo del servidor', () => {
  const sync = createEventSync();
  sync.rebase({});
  assert.equal(sync.outgoing({ king: KING_A }), null);
});

test('copia vieja en este navegador y versión más nueva en el servidor: se muestra la del servidor', () => {
  const sync = createEventSync();
  sync.rebase({ king: KING_A }); // lo que había en este navegador
  const r = sync.receive({ king: KING_B }, { king: KING_A });
  assert.deepEqual(r.merged, { king: KING_B });
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.replaced, ['king']);
  assert.equal(sync.outgoing(r.merged), null, 'y no se reenvía nada');
});

test('abrir un panel antes de que responda el servidor no sube sus valores de fábrica', () => {
  // El panel guarda al montarse: el filtro lo descarta (y también la segunda
  // pasada del modo estricto de React).
  const shouldSave = createMountGuard();
  assert.equal(shouldSave({ mainTime: 15 }), false);
  assert.equal(shouldSave({ mainTime: 15 }), false);
  assert.equal(shouldSave({ mainTime: 20 }), true, 'el primer cambio de verdad sí se guarda');
  assert.equal(shouldSave({ mainTime: 15 }), true, 'y desde ahí todo');
});

test('un cambio hecho antes de que llegue lo del servidor se conserva y se manda (solo ese evento)', () => {
  const sync = createEventSync();
  sync.rebase({});
  const local = { king: KING_A };
  const r = sync.receive({ king: KING_B, zub: { minCoins: 5 } }, local);
  assert.deepEqual(r.merged, { king: KING_A, zub: { minCoins: 5 } });
  assert.deepEqual(r.pending, ['king']);
  assert.deepEqual(sync.outgoing(r.merged), { king: KING_A });
});

test('sin conexión: lo cambiado aquí se manda al volver, y lo cambiado en otro evento desde otro lado se respeta', () => {
  const sync = createEventSync();
  sync.rebase({});
  sync.receive({ king: KING_A, zub: { minCoins: 0 } }, {});
  sync.disconnected();
  const local = { king: KING_B, zub: { minCoins: 0 } }; // editado sin conexión
  assert.equal(sync.outgoing(local), null, 'desconectado: no se manda');
  const r = sync.receive({ king: KING_A, zub: { minCoins: 99 } }, local);
  assert.deepEqual(r.merged, { king: KING_B, zub: { minCoins: 99 } });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(sync.outgoing(r.merged), { king: KING_B });
});

test('el mismo evento cambiado en los dos lados: gana lo de aquí y se avisa', () => {
  const sync = createEventSync();
  sync.rebase({});
  sync.receive({ king: KING_A }, {});
  sync.disconnected();
  const r = sync.receive({ king: { mainTime: 45, snipeTime: 5 } }, { king: KING_B });
  assert.deepEqual(r.merged.king, KING_B);
  assert.deepEqual(r.conflicts, ['king']);
});

test('dos pestañas: lo que llega de la otra no pisa lo que esta tiene sin confirmar', () => {
  const sync = createEventSync();
  sync.rebase({});
  sync.receive({}, {});
  const local = { king: KING_A }; // editado aquí, enviado y sin respuesta todavía
  const r = sync.receive({ zub: { minCoins: 5 } }, local); // la otra pestaña cambió zub
  assert.deepEqual(r.merged, { king: KING_A, zub: { minCoins: 5 } });
  assert.deepEqual(r.replaced, ['zub']);
});

test('dos pestañas, mismo ajuste: si esta ya no tiene nada pendiente, se ve lo último guardado', () => {
  const sync = createEventSync();
  sync.rebase({});
  sync.receive({}, {});
  sync.accepted({ king: KING_A }); // esta pestaña guardó A
  const r = sync.receive({ king: KING_B }, { king: KING_A }); // la otra guardó B después
  assert.deepEqual(r.merged, { king: KING_B });
  assert.deepEqual(r.replaced, ['king'], 'el panel se vuelve a abrir con B y se avisa');
  assert.deepEqual(r.conflicts, []);
});

test('lo enviado sin respuesta sigue pendiente: si se corta la conexión, se vuelve a mandar', () => {
  const sync = createEventSync();
  sync.rebase({});
  sync.receive({}, {});
  assert.deepEqual(sync.outgoing({ king: KING_A }), { king: KING_A });
  sync.disconnected(); // sin respuesta del servidor
  const r = sync.receive({}, { king: KING_A });
  assert.deepEqual(r.pending, ['king']);
  sync.accepted({ king: KING_A });
  assert.equal(sync.outgoing({ king: KING_A }), null, 'confirmado: ya no hay nada pendiente');
});

test('cuenta nueva en el mismo navegador: lo de la cuenta anterior no se sube', () => {
  const sync = createEventSync();
  sync.rebase({ king: KING_A }); // lo que se veía de la cuenta A
  sync.rebase({}); // cambio de cuenta: App.jsx carga la copia de B (vacía) y rebasa
  const r = sync.receive({ zub: { minCoins: 1 } }, {});
  assert.deepEqual(r.merged, { zub: { minCoins: 1 } });
  assert.equal(sync.outgoing(r.merged), null);
});
