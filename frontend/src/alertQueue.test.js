import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertQueue } from './alertQueue.js';

function clock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  return {
    schedule(fn, delay) { tasks.set(++id, { fn, at: now + delay }); return id; },
    cancel(id) { tasks.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (tasks.size) {
        const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (task.at > end) break;
        now = task.at;
        tasks.delete(id);
        task.fn();
      }
      now = end;
    },
  };
}

test('a burst drains in FIFO order without another socket event; donor/gift snapshots stay paired', () => {
  const timer = clock();
  const shown = [];
  let current;
  const queue = createAlertQueue((alert, phase) => {
    current = alert;
    if (phase === 'entering') shown.push(alert);
  }, timer.schedule, timer.cancel);
  const first = { text: 'ana: Rose', durationMs: 1000 };
  queue.enqueue(first);
  queue.enqueue({ text: 'bob: Lion', durationMs: 1000 });
  queue.enqueue({ text: 'carla: follow', durationMs: 1000 });
  first.text = 'changed after dispatch';
  assert.equal(current.text, 'ana: Rose');
  timer.tick(999);
  assert.equal(shown.length, 1);
  timer.tick(1);
  assert.equal(current.text, 'bob: Lion');
  timer.tick(2000);
  assert.equal(current, null);
  assert.deepEqual(shown.map((a) => a.text), ['ana: Rose', 'bob: Lion', 'carla: follow']);
  assert.equal(new Set(shown.map((a) => a.playbackId)).size, 3);
  queue.enqueue({ text: 'new after idle', durationMs: 1000 });
  assert.equal(current.text, 'new after idle');
});

test('identical media restarts with a unique playback key and durations are bounded', () => {
  const timer = clock();
  const shown = [];
  const queue = createAlertQueue((alert, phase) => {
    if (phase === 'entering') shown.push(alert);
  }, timer.schedule, timer.cancel);
  const alert = { triggerId: 1, audioUrl: '/same.mp3', durationMs: 999999 };
  queue.enqueue(alert);
  queue.enqueue(alert);
  timer.tick(14999);
  assert.equal(shown.length, 1);
  timer.tick(1);
  assert.equal(shown.length, 2);
  assert.notEqual(shown[0].playbackId, shown[1].playbackId);
});

test('cleanup cancels the current alert and pending work', () => {
  const timer = clock();
  let changes = 0;
  const queue = createAlertQueue(() => changes++, timer.schedule, timer.cancel);
  queue.enqueue({ durationMs: 1000 });
  queue.enqueue({ durationMs: 1000 });
  queue.dispose();
  queue.enqueue({ durationMs: 1000 });
  timer.tick(60000);
  assert.equal(changes, 1);
});
