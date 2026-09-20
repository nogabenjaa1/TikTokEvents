import test from 'node:test';
import assert from 'node:assert/strict';
import { randomVoicePool, utteranceTimeoutMs, TTS_MIN_TIMEOUT_MS, TTS_MAX_TIMEOUT_MS } from './ttsVoice.js';

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
