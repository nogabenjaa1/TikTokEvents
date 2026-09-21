import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReloadState, OVERLAY_MAX_RELOADS, OVERLAY_RELOAD_WINDOW_MS } from './errorRecovery.js';

test('the first failure of an overlay can reload it, and the count is remembered', () => {
  const first = nextReloadState(null, 1000);
  assert.equal(first.allowed, true);
  assert.deepEqual(JSON.parse(first.state), { count: 1, since: 1000 });
});

test('a fixed error stops reloading after the limit instead of looping forever', () => {
  let raw = null;
  const results = [];
  for (let i = 0; i < OVERLAY_MAX_RELOADS + 2; i++) {
    const next = nextReloadState(raw, 1000 + i * 6000);
    results.push(next.allowed);
    raw = next.state;
  }
  assert.deepEqual(results, [true, true, true, false, false]);
});

test('after the window passes it can reload again', () => {
  const stuck = JSON.stringify({ count: OVERLAY_MAX_RELOADS, since: 1000 });
  assert.equal(nextReloadState(stuck, 1000 + OVERLAY_RELOAD_WINDOW_MS - 1).allowed, false);
  const later = nextReloadState(stuck, 1000 + OVERLAY_RELOAD_WINDOW_MS + 1);
  assert.equal(later.allowed, true);
  assert.deepEqual(JSON.parse(later.state), { count: 1, since: 1000 + OVERLAY_RELOAD_WINDOW_MS + 1 });
});

test('a corrupted or impossible saved value counts as no history', () => {
  for (const bad of ['', 'no es json', '{}', '{"count":"x","since":1}', '{"count":1}', 'null', '[]', '{"count":99,"since":999999999}']) {
    const next = nextReloadState(bad, 5000);
    assert.equal(next.allowed, true, bad);
    assert.equal(JSON.parse(next.state).count, 1, bad);
  }
});
