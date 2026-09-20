import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSoundEnabled, saveSoundEnabled, loadMonitorSink, saveMonitorSink, routeToSink } from './alertMonitor.js';
import { overlayAudioFromLocation } from './overlayAudio.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('the sound is on by default and remembered per browser', () => {
  const storage = memoryStorage();
  assert.equal(loadSoundEnabled(storage), true);
  saveSoundEnabled(false, storage);
  assert.equal(loadSoundEnabled(storage), false);
  saveSoundEnabled(true, storage);
  assert.equal(loadSoundEnabled(storage), true);
});

test('someone who had turned the old alert sound off ("never") keeps it off; the other old modes mean on', () => {
  assert.equal(loadSoundEnabled(memoryStorage({ tkc_alert_monitor: 'never' })), false);
  assert.equal(loadSoundEnabled(memoryStorage({ tkc_alert_monitor: 'auto' })), true);
  assert.equal(loadSoundEnabled(memoryStorage({ tkc_alert_monitor: 'always' })), true);
  assert.equal(loadSoundEnabled(memoryStorage({ tkc_alert_monitor: 'never', tkc_sound_enabled: '1' })), true, 'the new setting wins over the old one');
});

test('blocked storage never breaks the panel', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadSoundEnabled(blocked), true);
  assert.doesNotThrow(() => saveSoundEnabled(false, blocked));
  assert.deepEqual(loadMonitorSink(blocked), { id: '', label: '' });
  assert.doesNotThrow(() => saveMonitorSink({ id: 'x' }, blocked));
});

test('the chosen output device is remembered and can be cleared', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadMonitorSink(storage), { id: '', label: '' });
  saveMonitorSink({ id: 'abc', label: 'Audífonos' }, storage);
  assert.deepEqual(loadMonitorSink(storage), { id: 'abc', label: 'Audífonos' });
  saveMonitorSink({ id: '', label: '' }, storage);
  assert.deepEqual(loadMonitorSink(storage), { id: '', label: '' });
  assert.deepEqual(loadMonitorSink(memoryStorage({ tkc_alert_monitor_sink: '{bad' })), { id: '', label: '' });
});

test('routing to an output device is skipped when there is none or the browser cannot do it', async () => {
  let routed = null;
  routeToSink({ setSinkId: async (id) => { routed = id; } }, 'device-1');
  assert.equal(routed, 'device-1');
  routeToSink({ setSinkId: async (id) => { routed = id; } }, '');
  assert.equal(routed, 'device-1', 'an empty id means the system default: nothing to do');
  routeToSink({}, 'device-2');
  routeToSink(null, 'device-2');
  await new Promise((resolve) => { routeToSink({ setSinkId: () => Promise.reject(new Error('gone')) }, 'x'); setTimeout(resolve, 0); });
});

test('an OBS overlay is silent unless its URL asks for audio; the panel never counts as an overlay with audio', () => {
  assert.equal(overlayAudioFromLocation({ search: '?overlay=true&screen=alerts&key=k', hash: '' }), false, 'silent by default: the panel plays the sound');
  assert.equal(overlayAudioFromLocation({ search: '?overlay=true&screen=alerts&key=k&audio=1', hash: '' }), true, 'explicit opt-in for OBS on another computer');
  assert.equal(overlayAudioFromLocation({ search: '?overlay=true&audio=0', hash: '' }), false);
  assert.equal(overlayAudioFromLocation({ search: '?audio=1', hash: '' }), false, 'the panel (not an overlay) ignores the parameter');
  assert.equal(overlayAudioFromLocation({ search: '', hash: '' }), false);
  assert.equal(overlayAudioFromLocation(), false);
});
