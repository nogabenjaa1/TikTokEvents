import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeElimEntries, entriesBreakdown, mergeDestination } from './elimEntries.js';

test('resume las entradas por usuario y por tipo', () => {
  const rows = summarizeElimEntries([
    { id: 1, username: 'ana', avatar: 'a', source: 'gift' },
    { id: 2, username: 'beto', avatar: 'b', source: 'manual' },
    { id: 3, username: 'ana', avatar: 'a', source: 'manual' },
    { id: 4, username: 'ana', avatar: 'a' },
  ]);
  assert.deepEqual(rows.map((r) => [r.username, r.total, r.gift, r.manual]), [['ana', 3, 2, 1], ['beto', 1, 0, 1]]);
});

test('a igualdad de entradas va primero quien entró antes', () => {
  const rows = summarizeElimEntries([{ id: 5, username: 'zoe' }, { id: 2, username: 'max' }]);
  assert.deepEqual(rows.map((r) => r.username), ['max', 'zoe']);
  assert.deepEqual(summarizeElimEntries(undefined), []);
});

test('entriesBreakdown dice de dónde salen las entradas', () => {
  assert.equal(entriesBreakdown({ gift: 2, manual: 0 }), '2 por regalo');
  assert.equal(entriesBreakdown({ gift: 0, manual: 1 }), '1 manual');
  assert.equal(entriesBreakdown({ gift: 1, manual: 3 }), '1 por regalo · 3 manuales');
});

test('mergeDestination elige al primero, al segundo u otro perfil', () => {
  assert.equal(mergeDestination('ana', 'beto', 'a'), 'ana');
  assert.equal(mergeDestination('ana', 'beto', 'b'), 'beto');
  assert.equal(mergeDestination('ana', 'beto', 'custom', ' @dani '), 'dani');
  assert.equal(mergeDestination('ana', 'beto', 'custom', ''), null);
});
