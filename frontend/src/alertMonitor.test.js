import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldMonitorInPanel, loadMonitorMode, saveMonitorMode, loadMonitorSink, saveMonitorSink, routeToSink, DEFAULT_MONITOR_MODE } from './alertMonitor.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('auto: the panel only plays alerts when there is no overlay open, so nothing sounds twice', () => {
  assert.equal(shouldMonitorInPanel('auto', false), true, 'no OBS overlay: the streamer hears it in the browser');
  assert.equal(shouldMonitorInPanel('auto', true), false, 'overlay open: it already sounds there, the panel stays quiet');
});

test('always and never ignore the overlay', () => {
  assert.equal(shouldMonitorInPanel('always', true), true);
  assert.equal(shouldMonitorInPanel('always', false), true);
  assert.equal(shouldMonitorInPanel('never', true), false);
  assert.equal(shouldMonitorInPanel('never', false), false);
  assert.equal(shouldMonitorInPanel('something-else', true), false, 'unknown modes behave like auto');
});

test('the mode is remembered per browser and a bad value falls back to auto', () => {
  const storage = memoryStorage();
  assert.equal(loadMonitorMode(storage), DEFAULT_MONITOR_MODE);
  saveMonitorMode('never', storage);
  assert.equal(loadMonitorMode(storage), 'never');
  saveMonitorMode('nonsense', storage);
  assert.equal(loadMonitorMode(storage), 'never', 'an invalid mode is not saved');
  assert.equal(loadMonitorMode(memoryStorage({ tkc_alert_monitor: 'garbage' })), DEFAULT_MONITOR_MODE);
  assert.equal(loadMonitorMode({ getItem() { throw new Error('blocked'); } }), DEFAULT_MONITOR_MODE, 'blocked storage does not break the panel');
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
