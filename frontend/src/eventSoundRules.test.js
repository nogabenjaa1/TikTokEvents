import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kingSnapshot, kingSounds, zubSnapshot, zubSounds, elimSnapshot, elimSounds,
  rouletteSnapshot, rouletteSounds, goalSnapshot, goalSounds,
} from './eventSoundRules.js';

const step = (snapshot, sounds, states) => {
  let prev = null;
  return states.map((state) => { const out = sounds(prev, state); prev = snapshot(state); return out; });
};

test('the first state seen never makes a sound, so opening the page mid-round is silent', () => {
  assert.deepEqual(kingSounds(null, { mode: 'main', lastParticipant: { username: 'ana' } }), []);
  assert.deepEqual(zubSounds(null, { mode: 'finished', winner: { username: 'ana' } }), []);
  assert.deepEqual(elimSounds(null, { mode: 'result' }), []);
  assert.deepEqual(rouletteSounds(null, { mode: 'finished', winner: {} }), []);
  assert.deepEqual(goalSounds(null, { finished: true, audioUrl: '/a.mp3' }), []);
  assert.deepEqual(kingSounds(kingSnapshot({ mode: 'main' }), null), []);
});

test('Rey del Trono: a new person taking the throne, then the winner', () => {
  const out = step(kingSnapshot, kingSounds, [
    { mode: 'main', lastParticipant: { username: 'ana' } },
    { mode: 'main', lastParticipant: { username: 'ana' } },
    { mode: 'main', lastParticipant: { username: 'bob' } },
    { mode: 'main', lastParticipant: null },
    { mode: 'finished', lastParticipant: { username: 'bob' }, winner: { username: 'bob' } },
    { mode: 'finished', lastParticipant: { username: 'bob' }, winner: { username: 'bob' } },
  ]);
  assert.deepEqual(out, [[], [], ['throneSteal'], [], ['winner'], []]);
});

test('Zubastinis: only the winner, once', () => {
  const out = step(zubSnapshot, zubSounds, [{ mode: 'main' }, { mode: 'finished', winner: { username: 'ana' } }, { mode: 'finished', winner: { username: 'ana' } }]);
  assert.deepEqual(out, [[], ['winner'], []]);
  assert.deepEqual(zubSounds(zubSnapshot({ mode: 'main' }), { mode: 'finished', winner: null }), [], 'finished with no winner is silent');
});

test('Eliminación: the draw starts, the round resolves, then the winner', () => {
  const out = step(elimSnapshot, elimSounds, [
    { mode: 'rejoin' }, { mode: 'revealing' }, { mode: 'revealing' }, { mode: 'result' }, { mode: 'rejoin' }, { mode: 'finished', winner: { username: 'ana' } },
  ]);
  assert.deepEqual(out, [[], ['selecting'], [], ['eliminate'], [], ['winner']]);
});

test('Ruleta: the spin starts, the step resolves, then the winner', () => {
  const out = step(rouletteSnapshot, rouletteSounds, [
    { mode: 'joining' }, { mode: 'spinning' }, { mode: 'result' }, { mode: 'spinning' }, { mode: 'result' }, { mode: 'finished', winner: { username: 'bob' } },
  ]);
  assert.deepEqual(out, [[], ['selecting'], ['eliminate'], ['selecting'], ['eliminate'], ['winner']]);
  assert.deepEqual(rouletteSounds(rouletteSnapshot({ mode: 'revealing' }), { mode: 'result' }), [], "Ruleta's draw mode is 'spinning', not Eliminación's");
});

test('Objetivo: the streamer audio plays once when the goal is completed, and only if there is one', () => {
  const out = step(goalSnapshot, goalSounds, [
    { finished: false, audioUrl: '/a.mp3' }, { finished: true, audioUrl: '/a.mp3' }, { finished: true, audioUrl: '/a.mp3' }, { finished: false, audioUrl: '/a.mp3' }, { finished: true, audioUrl: '/a.mp3' },
  ]);
  assert.deepEqual(out, [[], ['goalAudio'], [], [], ['goalAudio']]);
  assert.deepEqual(goalSounds(goalSnapshot({ finished: false }), { finished: true, audioUrl: '' }), [], 'no audio configured');
});
