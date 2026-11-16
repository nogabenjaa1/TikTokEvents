import test from 'node:test';
import assert from 'node:assert/strict';
import { randomVoicePool, utteranceTimeoutMs, TTS_MIN_TIMEOUT_MS, TTS_MAX_TIMEOUT_MS, engineTick, TTS_START_GRACE_MS, TTS_NUDGE_EVERY_MS } from './ttsVoice.js';
import { createTicker } from './ttsTicker.js';

const v = (name, lang, localService) => ({ name, lang, localService });

test('the random pool keeps only local Spanish voices when there are at least two', () => {
  const pool = randomVoicePool([
    v('Google 日本語', 'ja-JP', false), v('Sabina', 'es-MX', true), v('Helena', 'es-ES', true),
    v('Google español', 'es-ES', false), v('Zira', 'en-US', true),
  ]);
  assert.deepEqual(pool.map((x) => x.name), ['Sabina', 'Helena']);
});

test('with fewer than two local Spanish voices it falls back to every Spanish voice', () => {
  const pool = randomVoicePool([v('Sabina', 'es-MX', true), v('Google español', 'es-US', false), v('Zira', 'en-US', true)]);
  assert.deepEqual(pool.map((x) => x.name), ['Sabina', 'Google español']);
});

test('with no Spanish voice at all it uses whatever the browser has, and never returns nothing to pick from', () => {
  const all = [v('Zira', 'en-US', true), v('Hiro', 'ja-JP', true)];
  assert.deepEqual(randomVoicePool(all), all);
  assert.deepEqual(randomVoicePool([]), []);
  assert.deepEqual(randomVoicePool(undefined), []);
});

test('the utterance timeout grows with the text and shrinks with the speed, within its limits', () => {
  const short = utteranceTimeoutMs('hola', 1);
  const long = utteranceTimeoutMs('a'.repeat(300), 1);
  assert.equal(short, TTS_MIN_TIMEOUT_MS);
  assert.ok(long > short && long > 20000, `long message got ${long} ms`);
  assert.ok(utteranceTimeoutMs('a'.repeat(300), 0.5) > long, 'slower voice needs more time');
  assert.ok(utteranceTimeoutMs('a'.repeat(300), 3) < long, 'faster voice needs less time');
  assert.equal(utteranceTimeoutMs('a'.repeat(100000), 0.5), TTS_MAX_TIMEOUT_MS);
  assert.equal(utteranceTimeoutMs(undefined, undefined), TTS_MIN_TIMEOUT_MS);
});

const base = { now: 100000, speaking: true, synthSpeaking: true, synthPending: false, startedAt: 99000, deadline: 120000, lastNudgeAt: 99000, remoteVoice: false, queued: 0 };

test('a message past its deadline is cut and the queue moves on', () => {
  assert.equal(engineTick({ ...base, now: 120000 }), 'timeout');
});

test('when the browser stops speaking without saying so, the next message starts (bug: the queue waited until the safety timeout)', () => {
  assert.equal(engineTick({ ...base, synthSpeaking: false, now: base.startedAt + TTS_START_GRACE_MS }), 'finished');
});

test('right after starting, a voice that has not begun yet is not mistaken for finished', () => {
  assert.equal(engineTick({ ...base, synthSpeaking: false, now: base.startedAt + 500 }), 'none');
  assert.equal(engineTick({ ...base, synthSpeaking: false, synthPending: true, now: base.startedAt + 5000 }), 'none');
});

test('internet voices get a nudge every 10 s so Chrome does not cut them; local voices are left alone', () => {
  const later = base.lastNudgeAt + TTS_NUDGE_EVERY_MS;
  assert.equal(engineTick({ ...base, remoteVoice: true, now: later }), 'nudge');
  assert.equal(engineTick({ ...base, remoteVoice: true, now: later - 1 }), 'none');
  assert.equal(engineTick({ ...base, remoteVoice: false, now: later }), 'none');
});

test('idle with messages waiting starts the next one; idle and empty does nothing', () => {
  assert.equal(engineTick({ ...base, speaking: false, queued: 2 }), 'next');
  assert.equal(engineTick({ ...base, speaking: false, queued: 0 }), 'none');
});

test('the engine clock falls back to a normal timer where Web Workers do not exist, and stops cleanly', async () => {
  let ticks = 0;
  const stop = createTicker(100, () => { ticks += 1; });
  await new Promise((resolve) => setTimeout(resolve, 350));
  stop();
  const after = ticks;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(after >= 2, `ticked ${after} times`);
  assert.equal(ticks, after, 'no ticks after stop');
});
