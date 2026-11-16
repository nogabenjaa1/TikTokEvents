import test from 'node:test';
import assert from 'node:assert/strict';
import { unpackElimState } from './elimPacking.js';

test('rearma la lista compacta en el mismo orden, con foto y tipo', () => {
  const state = unpackElimState({
    mode: 'joining',
    players: [{ username: 'ana', avatar: 'a.webp' }, { username: 'beto', avatar: 'b.webp' }],
    slots: [[3, 1, 0], [1, 0, 1], [2, 0, 0]],
  });
  assert.deepEqual(state.participants, [
    { id: 3, username: 'beto', avatar: 'b.webp', source: 'gift' },
    { id: 1, username: 'ana', avatar: 'a.webp', source: 'manual' },
    { id: 2, username: 'ana', avatar: 'a.webp', source: 'gift' },
  ]);
  assert.equal(state.mode, 'joining');
  assert.equal('slots' in state, false);
});

test('un estado con el formato anterior queda igual', () => {
  const old = { mode: 'joining', participants: [{ id: 1, username: 'ana', avatar: 'a.webp' }] };
  assert.equal(unpackElimState(old), old);
  assert.equal(unpackElimState(null), null);
});
