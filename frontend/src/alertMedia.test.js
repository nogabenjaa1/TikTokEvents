import test from 'node:test';
import assert from 'node:assert/strict';
import { stopMedia, preloadAlertMedia, clearPreloaded } from './alertMedia.js';
import { alertTiming, ANIM_DURATION_MS } from './alertQueue.js';

test('stopping media pauses it and releases its source, and never throws', () => {
  const calls = [];
  stopMedia({ pause: () => calls.push('pause'), removeAttribute: (a) => calls.push(`remove:${a}`), load: () => calls.push('load') });
  assert.deepEqual(calls, ['pause', 'remove:src', 'load']);
  assert.doesNotThrow(() => stopMedia(null));
  assert.doesNotThrow(() => stopMedia({ pause() { throw new Error('gone'); } }));
});

test('an alert starts loading its files while it waits for its turn, once per file', () => {
  clearPreloaded();
  const made = [];
  const create = (kind) => { const el = { kind }; made.push(el); return el; };
  preloadAlertMedia({ visualType: 'video', visualUrl: '/v.mp4', audioUrl: '/a.mp3' }, create);
  assert.deepEqual(made.map((e) => [e.kind, e.src, e.preload]), [['video', '/v.mp4', 'auto'], ['audio', '/a.mp3', 'auto']]);
  preloadAlertMedia({ visualType: 'video', visualUrl: '/v.mp4' }, create);
  assert.equal(made.length, 2, 'the same file is not requested twice');
  preloadAlertMedia({ visualType: 'gif', visualUrl: '/g.gif' }, create);
  assert.deepEqual([made[2].kind, made[2].src, made[2].preload], ['image', '/g.gif', undefined], 'images just get a source');
  assert.doesNotThrow(() => preloadAlertMedia(null, create));
  assert.doesNotThrow(() => preloadAlertMedia({ audioUrl: '/x.mp3' }, () => { throw new Error('blocked'); }));
});

test('the animation time adapts to the alert duration so it is never cut', () => {
  assert.deepEqual(alertTiming({ durationMs: 5000 }), { duration: 5000, animation: ANIM_DURATION_MS });
  assert.deepEqual(alertTiming({ durationMs: 600 }), { duration: 600, animation: 300 }, 'a short alert gets a shorter animation: in + out fit');
  assert.deepEqual(alertTiming({ durationMs: 100 }), { duration: 500, animation: 250 }, 'a minimum of half a second');
  assert.deepEqual(alertTiming({ durationMs: 60000 }), { duration: 15000, animation: ANIM_DURATION_MS }, 'a maximum of fifteen seconds');
  assert.deepEqual(alertTiming({}), { duration: 5000, animation: ANIM_DURATION_MS }, 'no duration: the default');
  for (const durationMs of [500, 600, 800, 1000, 3000]) {
    const { duration, animation } = alertTiming({ durationMs });
    assert.ok(animation * 2 <= duration, `${durationMs}: entering + exiting fit inside the alert`);
  }
});
