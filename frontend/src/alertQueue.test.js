import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertQueue } from './alertQueue.js';

// Reloj de mentira: `tick(ms)` corre los temporizadores como lo haría un navegador
// sano; `freeze(ms)` deja pasar el tiempo SIN correr ninguno (una página congelada
// o con los temporizadores frenados, como pasa en OBS / TikTok Studio).
function clock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    schedule(fn, delay) { tasks.set(++id, { fn, at: now + delay }); return id; },
    cancel(taskId) { tasks.delete(taskId); },
    tick(ms) {
      const end = now + ms;
      while (tasks.size) {
        const [taskId, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (task.at > end) break;
        now = task.at;
        tasks.delete(taskId);
        task.fn();
      }
      now = end;
    },
    freeze(ms) { now += ms; },
  };
}

function recorder(timer) {
  const log = [];
  const queue = createAlertQueue((alert, phase) => log.push({ text: alert?.text ?? null, phase, at: timer.now() }), timer.schedule, timer.cancel, timer.now);
  return { queue, log, entered: () => log.filter((e) => e.phase === 'entering').map((e) => e.text), last: () => log.at(-1) };
}

test('a burst drains in FIFO order without another socket event; donor/gift snapshots stay paired', () => {
  const timer = clock();
  const shown = [];
  let current;
  const queue = createAlertQueue((alert, phase) => {
    current = alert;
    if (phase === 'entering') shown.push(alert);
  }, timer.schedule, timer.cancel, timer.now);
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

test('an alert goes through entering, visible and exiting, and the next one starts right after', () => {
  const timer = clock();
  const { queue, log } = recorder(timer);
  queue.enqueue({ text: 'a', durationMs: 2000 });
  queue.enqueue({ text: 'b', durationMs: 2000 });
  timer.tick(4000);
  assert.deepEqual(log.map((e) => `${e.text}:${e.phase}@${e.at}`), [
    'a:entering@0', 'a:visible@400', 'a:exiting@1600', 'null:visible@2000',
    'b:entering@2000', 'b:visible@2400', 'b:exiting@3600', 'null:visible@4000',
  ]);
});

test('identical media restarts with a unique playback key and durations are bounded', () => {
  const timer = clock();
  const shown = [];
  const queue = createAlertQueue((alert, phase) => {
    if (phase === 'entering') shown.push(alert);
  }, timer.schedule, timer.cancel, timer.now);
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
  const queue = createAlertQueue(() => changes++, timer.schedule, timer.cancel, timer.now);
  queue.enqueue({ durationMs: 1000 });
  queue.enqueue({ durationMs: 1000 });
  queue.dispose();
  queue.enqueue({ durationMs: 1000 });
  timer.tick(60000);
  assert.equal(changes, 1);
});

test('with frozen timers the ticker alone advances the phases and finishes the alert', () => {
  const timer = clock();
  const { queue, last } = recorder(timer);
  queue.enqueue({ text: 'a', durationMs: 2000 });
  timer.freeze(700); queue.tick();
  assert.equal(last().phase, 'visible');
  timer.freeze(1000); queue.tick();
  assert.equal(last().phase, 'exiting');
  timer.freeze(400); queue.tick();
  assert.equal(last().text, null, 'finished by the wall clock, not by a timer that never fired');
});

test('after a long freeze the queued alerts play one after another, not all at once', () => {
  const timer = clock();
  const { queue, log, entered } = recorder(timer);
  queue.enqueue({ text: 'a', durationMs: 3000 });
  queue.enqueue({ text: 'b', durationMs: 3000 });
  queue.enqueue({ text: 'c', durationMs: 3000 });
  timer.freeze(60_000); // la página estuvo congelada un minuto
  queue.tick();
  assert.equal(log.at(-1).text, 'b', 'only the next one starts');
  assert.deepEqual(entered(), ['a', 'b']);
  const bStartedAt = log.at(-1).at;
  assert.equal(bStartedAt, 60_000, 'and it starts with its whole duration from now');
  timer.freeze(2999); queue.tick();
  assert.deepEqual(entered(), ['a', 'b'], 'c waits for its turn');
  timer.freeze(1); queue.tick();
  assert.deepEqual(entered(), ['a', 'b', 'c']);
});

test('a new event arriving while the timers are frozen also wakes the queue up', () => {
  const timer = clock();
  const { queue, entered } = recorder(timer);
  queue.enqueue({ text: 'a', durationMs: 1000 });
  timer.freeze(5000); // el temporizador de 'a' nunca corrió
  queue.enqueue({ text: 'b', durationMs: 1000 });
  assert.deepEqual(entered(), ['a', 'b'], 'the stuck one is released and the new one takes its turn, nothing is left dead');
});

test('alerts can keep arriving while one is playing and all of them play', () => {
  const timer = clock();
  const { queue, entered } = recorder(timer);
  queue.enqueue({ text: '1', durationMs: 1000 });
  timer.tick(500); queue.enqueue({ text: '2', durationMs: 1000 });
  timer.tick(700); queue.enqueue({ text: '3', durationMs: 1000 });
  assert.equal(queue.size, 3 - 1, 'one finished, two still in the system');
  timer.tick(5000);
  assert.deepEqual(entered(), ['1', '2', '3']);
  assert.equal(queue.size, 0);
});
