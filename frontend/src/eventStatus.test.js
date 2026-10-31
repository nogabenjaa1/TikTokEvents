import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventStatus, getAllEventStatuses, isRunning } from './app/eventStatus.js';

test('un evento en curso se ve como en curso, y en pausa si está pausado', () => {
  assert.equal(getEventStatus('king', { isActive: true }).tone, 'live');
  assert.equal(getEventStatus('elim', { isActive: true, paused: true }).tone, 'paused');
  assert.equal(isRunning(getEventStatus('elim', { isActive: true, paused: true })), true);
});

test('terminado: por mode o por la marca finished', () => {
  assert.equal(getEventStatus('roulette', { isActive: false, mode: 'finished' }).tone, 'finished');
  assert.equal(getEventStatus('extensible', { isActive: false, finished: true }).tone, 'finished');
});

test('falta configurar: regalo obligatorio sin elegir', () => {
  const s = getEventStatus('king', { isActive: false, mode: 'idle' }, {});
  assert.equal(s.tone, 'setup');
  assert.match(s.detail, /regalo/);
  assert.equal(getEventStatus('king', {}, { selectedGift: { name: 'Rosa', coins: 1 } }).tone, 'ready');
});

test('la Ruleta solo pide regalo si se entra con regalo', () => {
  assert.equal(getEventStatus('roulette', {}, { entryMode: 'chat' }).tone, 'ready');
  assert.equal(getEventStatus('roulette', {}, { entryMode: 'gift', selectedGift: null }).tone, 'setup');
});

test('Objetivo sin meta válida pide escribirla; en curso muestra el avance', () => {
  assert.equal(getEventStatus('goal', {}, { targetInput: '' }).tone, 'setup');
  assert.equal(getEventStatus('goal', {}, { targetInput: '0' }).tone, 'setup');
  assert.equal(getEventStatus('goal', {}, { targetInput: '500' }).tone, 'ready');
  assert.equal(getEventStatus('goal', { isActive: true, current: 120, target: 500 }).detail, '120 de 500');
});

test('Versus sin regalos asignados pide asignarlos', () => {
  assert.equal(getEventStatus('versus', { isActive: false, heroes: [], villains: [] }).tone, 'setup');
  assert.equal(getEventStatus('versus', { isActive: false, heroes: [{ id: 1 }], villains: [] }).tone, 'ready');
});

test('orden: lo urgente primero y, a igualdad, el de la barra de Eventos', () => {
  const list = getAllEventStatuses(
    { goal: { isActive: true, target: 10, current: 1 }, zub: { isActive: true, paused: true } },
    { king: { selectedGift: { name: 'Rosa' } }, elim: { selectedGift: { name: 'Rosa' } }, goal: { targetInput: '10' } },
  );
  assert.deepEqual(list.slice(0, 2).map((s) => s.id), ['goal', 'zub']);
  assert.ok(list.findIndex((s) => s.tone === 'ready') > list.findIndex((s) => s.tone === 'setup') || !list.some((s) => s.tone === 'setup'));
  assert.equal(list.length, 7);
});
