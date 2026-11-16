import test from 'node:test';
import assert from 'node:assert/strict';
import { groupElimEntries, rowsPerPage, paginate } from './eliminationList.js';

test('agrupa los slots por usuario y cuenta sus entradas', () => {
  const rows = groupElimEntries([
    { id: 1, username: 'ana', avatar: 'a.png' },
    { id: 2, username: 'beto', avatar: 'b.png' },
    { id: 3, username: 'ana', avatar: 'a.png' },
    { id: 4, username: 'ana', avatar: 'a.png' },
    { id: 5, username: 'caro', avatar: 'c.png' },
  ]);
  assert.deepEqual(rows.map((r) => [r.username, r.entries]), [['ana', 3], ['beto', 1], ['caro', 1]]);
  assert.equal(rows[0].avatar, 'a.png');
});

test('a igualdad de entradas, va primero quien entró antes', () => {
  const rows = groupElimEntries([
    { id: 7, username: 'zoe' },
    { id: 2, username: 'max' },
    { id: 9, username: 'zoe' },
    { id: 3, username: 'max' },
  ]);
  assert.deepEqual(rows.map((r) => r.username), ['max', 'zoe']);
});

test('ignora entradas sin usuario y una lista vacía o ausente', () => {
  assert.deepEqual(groupElimEntries(undefined), []);
  assert.deepEqual(groupElimEntries([null, { id: 1 }]), []);
});

test('rowsPerPage cuenta las filas que caben con su separación', () => {
  // 5 filas de 50 + 4 separaciones de 10 = 290
  assert.equal(rowsPerPage(290, 50, 10), 5);
  assert.equal(rowsPerPage(289, 50, 10), 4);
  // Sin medida todavía: al menos una fila
  assert.equal(rowsPerPage(0, 50, 10), 1);
  assert.equal(rowsPerPage(20, 50, 10), 1);
});

test('paginate manda a la página siguiente lo que no cabe', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(paginate(rows, 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(paginate(rows, 7), [rows]);
  assert.deepEqual(paginate([], 3), [[]]);
  assert.deepEqual(paginate(rows, 0), rows.map((r) => [r]));
});
