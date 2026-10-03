const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helpers = require('./lib/tenantHelpers');

// El segundero de Eliminación y Ruleta: ancho de banda. Antes cada segundo
// salía el estado completo (con la lista de participantes y sus avatares) a
// cada pantalla abierta; ahora solo el reloj, salvo en el tick que cambia de
// fase. Carga el módulo real sin DB, con un setInterval que se dispara a mano.
function load(file) {
  const intervals = [];
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? helpers : {}),
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math, Number, String, Map, Set, Object, Array, Promise, JSON,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.logId = 'test';
  const sent = [];
  tenant.broadcast = { emit: (name, payload) => sent.push({ name, payload }) };
  tenant.maybeDisconnectTikTok = () => {};
  return { tenant, sent, tick: () => intervals.at(-1)() };
}

const participants = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, username: `user${i % 3}`, avatar: `https://cdn.example/avatar/${i}.webp` }));

test('Eliminación: el segundero manda solo el reloj mientras no cambia de fase', () => {
  const { tenant, sent, tick } = load('./lib/tenant/elim');
  tenant.elimState = { isActive: true, mode: 'joining', paused: false, timeLeft: 10, participants: participants(6), revealTargetIds: [], lastEliminatedList: [], eliminationsPerRound: 1 };
  tenant.startElimTimer();
  tick();
  assert.deepEqual(sent, [{ name: 'elim_tick', payload: { isActive: true, mode: 'joining', paused: false, timeLeft: 9 } }]);
});

test('Eliminación: el tick que cambia de fase sí manda el estado completo', () => {
  const { tenant, sent, tick } = load('./lib/tenant/elim');
  tenant.elimState = { isActive: true, mode: 'joining', paused: false, timeLeft: 1, participants: participants(6), revealTargetIds: [], lastEliminatedList: [], eliminationsPerRound: 1 };
  tenant.startElimTimer();
  tick();
  const last = sent.at(-1);
  assert.equal(last.name, 'elim_timer_updated');
  assert.equal(last.payload.mode, 'revealing');
  assert.equal(last.payload.participants.length, 6);
  assert.ok(!sent.some((e) => e.name === 'elim_tick'));
});

test('Ruleta: el segundero de las entradas manda solo el reloj', () => {
  const { tenant, sent, tick } = load('./lib/tenant/roulette');
  tenant.rouletteState = { isActive: true, mode: 'joining', paused: false, timeLeft: 30, entries: participants(4) };
  tenant.startRouletteTimer();
  tick();
  assert.deepEqual(sent, [{ name: 'roulette_tick', payload: { isActive: true, mode: 'joining', paused: false, timeLeft: 29 } }]);
});
