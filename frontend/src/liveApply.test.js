import test from 'node:test';
import assert from 'node:assert/strict';
import { liveApplyPhase, liveKey } from './liveApply.js';

test('sin evento en curso o sin cambios del streamer no se dice nada', () => {
  assert.equal(liveApplyPhase({ active: false, touched: true, localKey: 'a', serverKey: 'b' }), null);
  assert.equal(liveApplyPhase({ active: true, touched: false, localKey: 'a', serverKey: 'b' }), null);
});

test('aplicado cuando el servidor ya refleja lo del panel; si no, pendiente', () => {
  assert.equal(liveApplyPhase({ active: true, touched: true, localKey: liveKey([30, 5]), serverKey: liveKey([30, 5]) }), 'applied');
  assert.equal(liveApplyPhase({ active: true, touched: true, localKey: liveKey([30, 5]), serverKey: liveKey([15, 5]) }), 'pending');
});
