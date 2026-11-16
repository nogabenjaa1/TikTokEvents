import test from 'node:test';
import assert from 'node:assert/strict';
import { computeElimGrid, labelFontSize, MAX_BUBBLES, LABEL_LINE_HEIGHT } from './elimGrid.js';

// Alto real que ocupa la grilla con el resultado calculado (mismo dibujo que
// ElimParticipantsGrid: foto + @ debajo, separación entre filas).
function usedHeight(width, count, g) {
  const cols = Math.max(1, Math.floor((width + g.gap) / (g.size + g.gap)));
  const rows = Math.ceil(count / cols);
  const label = g.showLabel ? Math.ceil(labelFontSize(g.size) * LABEL_LINE_HEIGHT) + 2 : 0;
  return rows * (g.size + label) + (rows - 1) * g.gap;
}

test('pocas entradas: burbujas del tamaño máximo con su @', () => {
  const g = computeElimGrid(316, 430, 3, { maxSize: 64 });
  assert.deepEqual([g.size, g.showLabel, g.dot, g.hidden], [64, true, false, false]);
});

test('las burbujas se achican con la cantidad y siempre caben en el espacio', () => {
  let prev = Infinity;
  for (const count of [1, 10, 25, 60, 150, 400, 900, 1500]) {
    const g = computeElimGrid(316, 430, count, { maxSize: 64 });
    assert.equal(g.hidden, false, `${count} todavía se dibujan`);
    assert.ok(g.size <= prev, `${count}: más entradas, burbuja igual o más chica`);
    assert.ok(usedHeight(316, count, g) <= 430, `${count} entradas caben`);
    prev = g.size;
  }
});

test('muy chicas pasan a ser puntos sin @', () => {
  const g = computeElimGrid(316, 430, 1200, { maxSize: 64 });
  assert.equal(g.dot, true);
  assert.equal(g.showLabel, false);
});

test('si no caben ni como puntos, o son demasiadas, desaparecen', () => {
  assert.equal(computeElimGrid(100, 40, 1000, { maxSize: 64 }).hidden, true);
  assert.equal(computeElimGrid(1000, 900, MAX_BUBBLES + 1, { maxSize: 140 }).hidden, true);
});

test('el overlay cuadrado aprovecha burbujas más grandes', () => {
  const small = computeElimGrid(316, 430, 40, { maxSize: 64 });
  const square = computeElimGrid(1000, 700, 40, { maxSize: 140 });
  assert.ok(square.size > small.size);
  assert.ok(usedHeight(1000, 40, square) <= 700);
});
