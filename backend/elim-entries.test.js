const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helpers = require('./lib/tenantHelpers');
const elimEntries = require('./lib/elimEntries');
const { setEntries, mergeParticipants, findParticipantName } = elimEntries;

// Edición a mano de las entradas de Eliminación (pedido explícito): quitar
// cualquier entrada, fijar cuántas tiene alguien, combinar dos participantes y
// dar entradas manuales con la foto de TikTok de quien mandó un regalo.

function counter(start = 100) {
  let n = start;
  return () => { n += 1; return n; };
}

function pool() {
  return [
    { id: 1, username: 'ana', avatar: 'ana.webp', source: 'gift' },
    { id: 2, username: 'beto', avatar: 'beto.webp', source: 'gift' },
    { id: 3, username: 'ana', avatar: 'ana.webp', source: 'manual' },
    { id: 4, username: 'caro', avatar: 'caro.webp' }, // guardado antes de `source`
    { id: 5, username: 'beto', avatar: 'beto.webp', source: 'manual' },
    { id: 6, username: 'beto', avatar: 'beto.webp', source: 'gift' },
  ];
}

const count = (p, name) => p.filter((s) => s.username === name).length;

test('findParticipantName no distingue mayúsculas ni la @', () => {
  assert.equal(findParticipantName(pool(), '@ANA'), 'ana');
  assert.equal(findParticipantName(pool(), 'nadie'), null);
});

test('setEntries sube con entradas manuales y la misma foto', () => {
  const p = pool();
  const r = setEntries(p, { username: 'Ana', count: 5, nextId: counter() });
  assert.deepEqual([r.ok, r.before, r.after], [true, 2, 5]);
  const added = p.filter((s) => s.id > 100);
  assert.equal(added.length, 3);
  assert.ok(added.every((s) => s.username === 'ana' && s.avatar === 'ana.webp' && s.source === 'manual'));
});

test('setEntries baja quitando las más recientes, sean de regalo o manuales', () => {
  const p = pool();
  setEntries(p, { username: 'beto', count: 1, nextId: counter() });
  assert.deepEqual(p.filter((s) => s.username === 'beto').map((s) => s.id), [2]);
});

test('setEntries en 0 saca al participante; un usuario que no está da error', () => {
  const p = pool();
  assert.equal(setEntries(p, { username: 'caro', count: 0, nextId: counter() }).ok, true);
  assert.equal(count(p, 'caro'), 0);
  assert.equal(setEntries(p, { username: 'nadie', count: 2, nextId: counter() }).ok, false);
  assert.equal(setEntries(p, { username: 'ana', count: 'x', nextId: counter() }).ok, false);
});

test('combinar en uno de los dos: el otro sale y sus entradas pasan con la foto del elegido', () => {
  const p = pool();
  const r = mergeParticipants(p, { a: 'ana', b: 'beto', target: 'b', avatarFor: () => 'x', nextId: counter() });
  assert.deepEqual([r.ok, r.username, r.total], [true, 'beto', 5]);
  assert.equal(count(p, 'ana'), 0);
  assert.ok(p.filter((s) => s.username === 'beto').every((s) => s.avatar === 'beto.webp'));
  // Cada entrada conserva su orden de llegada y si fue de regalo o manual.
  assert.deepEqual(p.filter((s) => s.username === 'beto').map((s) => [s.id, s.source]), [[1, 'gift'], [2, 'gift'], [3, 'manual'], [5, 'manual'], [6, 'gift']]);
});

test('combinar en un tercer perfil: salen los dos y entra la suma como manual', () => {
  const p = pool();
  const r = mergeParticipants(p, { a: 'ana', b: 'beto', target: 'custom', customUsername: '@dani', avatarFor: (n) => `${n}-tiktok.webp`, nextId: counter() });
  assert.deepEqual([r.ok, r.username, r.total], [true, 'dani', 5]);
  assert.equal(count(p, 'ana') + count(p, 'beto'), 0);
  const dani = p.filter((s) => s.username === 'dani');
  assert.equal(dani.length, 5);
  assert.ok(dani.every((s) => s.source === 'manual' && s.avatar === 'dani-tiktok.webp'));
});

test('combinar en un tercer perfil que ya participa: se le suman, sin duplicarlo', () => {
  const p = pool();
  const r = mergeParticipants(p, { a: 'ana', b: 'beto', target: 'custom', customUsername: 'CARO', avatarFor: () => 'x', nextId: counter() });
  assert.deepEqual([r.username, r.total], ['caro', 6]);
  assert.equal(new Set(p.map((s) => s.username)).size, 1);
});

test('combinar valida que sean dos participantes distintos y que haya destino', () => {
  const opts = { avatarFor: () => 'x', nextId: counter() };
  assert.equal(mergeParticipants(pool(), { ...opts, a: 'ana', b: 'ANA', target: 'a' }).ok, false);
  assert.equal(mergeParticipants(pool(), { ...opts, a: 'ana', b: 'nadie', target: 'a' }).ok, false);
  assert.equal(mergeParticipants(pool(), { ...opts, a: 'ana', b: 'beto', target: 'custom', customUsername: ' ' }).ok, false);
  assert.equal(mergeParticipants(pool(), { ...opts, a: 'ana', b: 'beto' }).ok, false);
});

// ── Con el módulo real de Eliminación (sin DB, como timer-tick.test.js) ──

function loadElim() {
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? helpers : name.includes('elimEntries') ? elimEntries : name.includes('/db') ? { incrementUsage: async () => {} } : {}),
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math, Number, String, Map, Set, Object, Array, Promise, JSON,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/elim'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.logId = 'test';
  const sent = [];
  tenant.broadcast = { emit: (name, payload) => sent.push({ name, payload }) };
  tenant.maybeDisconnectTikTok = () => {};
  tenant.accumulateGiftCoins = (accum, username, coins) => {
    const acc = accum[username] || (accum[username] = { total: 0, grantedUnits: 0 });
    acc.total += coins;
    return acc;
  };
  tenant.elimState = {
    isActive: true, mode: 'joining', paused: false, lockedMode: false,
    targetGiftCoins: 5, instaWinGiftCoins: 0,
    participants: [], revealTargetIds: [], lastEliminatedList: [],
  };
  tenant.elimSlotCounter = 0;
  tenant.elimEntryAccum = {};
  tenant.elimInstaWinAccum = {};
  tenant.elimSeenUsers = new Map();
  const handlers = {};
  tenant.registerElimHandlers({ on: (name, fn) => { handlers[name] = fn; } });
  const call = (name, payload) => { let reply; handlers[name](payload, (r) => { reply = r; }); return reply; };
  return { tenant, sent, call };
}

test('una rosa que no alcanza para entrar deja la foto de TikTok para las entradas manuales', () => {
  const { tenant, call } = loadElim();
  tenant.processGiftElim({ username: 'lucia', avatar: 'lucia-tiktok.webp', totalCoins: 1 });
  assert.equal(tenant.elimState.participants.length, 0);
  // JSON: los objetos vienen del contexto de vm (otro prototipo).
  assert.deepEqual(JSON.parse(JSON.stringify(tenant.getElimPublicState().recentGifters)), [{ username: 'lucia', avatar: 'lucia-tiktok.webp' }]);
  const r = call('elim_add_manual_entry', { username: '@Lucia', count: 3 });
  assert.deepEqual([r.ok, r.username, r.added], [true, 'lucia', 3]);
  assert.ok(tenant.elimState.participants.every((s) => s.username === 'lucia' && s.avatar === 'lucia-tiktok.webp' && s.source === 'manual'));
});

test('a quien entró con regalos se le suman entradas manuales con su misma foto', () => {
  const { tenant, call } = loadElim();
  tenant.processGiftElim({ username: 'pepe', avatar: 'pepe.webp', totalCoins: 10 });
  assert.equal(tenant.elimState.participants.length, 2);
  assert.ok(tenant.elimState.participants.every((s) => s.source === 'gift'));
  call('elim_add_manual_entry', { username: 'PEPE', count: 3 });
  const pepe = tenant.elimState.participants.filter((s) => s.username === 'pepe');
  assert.equal(pepe.length, 5);
  assert.ok(pepe.every((s) => s.avatar === 'pepe.webp'));
});

test('si alguien agregado a mano manda un regalo después, sus entradas toman su foto real', () => {
  const { tenant, call } = loadElim();
  call('elim_add_manual_entry', { username: 'zoe', count: 2 });
  assert.ok(tenant.elimState.participants[0].avatar.startsWith('data:image/svg+xml'));
  tenant.processGiftElim({ username: 'zoe', avatar: 'zoe-real.webp', totalCoins: 1 });
  assert.ok(tenant.elimState.participants.every((s) => s.avatar === 'zoe-real.webp'));
});

test('quitar y combinar desde el panel avisan al overlay; durante el sorteo no se puede', () => {
  const { tenant, sent, call } = loadElim();
  call('elim_add_manual_entry', { username: 'ana', count: 2 });
  call('elim_add_manual_entry', { username: 'beto', count: 1 });
  sent.length = 0;
  assert.equal(call('elim_set_entries', { username: 'ana', count: 0 }).ok, true);
  assert.equal(sent.at(-1).name, 'elim_state_update');
  call('elim_add_manual_entry', { username: 'ana', count: 2 });
  assert.equal(call('elim_merge_participants', { a: 'ana', b: 'beto', target: 'a' }).total, 3);

  tenant.elimState.mode = 'revealing';
  const blocked = call('elim_set_entries', { username: 'ana', count: 1 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /sorteo/);
  assert.equal(tenant.elimState.participants.length, 3);
});

test('sin ronda activa no se edita nada', () => {
  const { tenant, call } = loadElim();
  tenant.elimState.isActive = false;
  assert.equal(call('elim_add_manual_entry', { username: 'ana', count: 1 }).ok, false);
  assert.equal(call('elim_merge_participants', { a: 'a', b: 'b', target: 'a' }).ok, false);
});

// ── Orden al azar, Locked Mode, pausa y fase final (segunda ronda de ajustes) ──

test('insertSlotsRandomly reparte las entradas nuevas por toda la lista', () => {
  const p = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const rolls = [0, 0.99, 0.5];
  elimEntries.insertSlotsRandomly(p, [{ id: 10 }, { id: 11 }, { id: 12 }], () => rolls.shift());
  assert.deepEqual(p.map((s) => s.id), [10, 1, 2, 12, 3, 11]);
});

test('200 entradas de una persona no quedan en un bloque del overlay', () => {
  const { tenant, call } = loadElim();
  for (let i = 0; i < 10; i++) call('elim_add_manual_entry', { username: `otro${i}`, count: 1 });
  call('elim_add_manual_entry', { username: 'ana', count: 200 });
  const positions = tenant.elimState.participants.map((s, i) => (s.username === 'ana' ? i : -1)).filter((i) => i >= 0);
  assert.equal(positions.length, 200);
  // Si estuvieran juntas, la primera y la última estarían a 199 lugares.
  assert.ok(positions.at(-1) - positions[0] > 199, 'las entradas de ana se mezclan con las de los demás');
});

test('roundEliminationCount: de 100 en 100 hasta 15 entradas y de ahí de 1 en 1', () => {
  const cfg = { perRound: 100, finalAt: 15, finalPerRound: 1 };
  assert.equal(elimEntries.roundEliminationCount(500, cfg), 100);
  assert.equal(elimEntries.roundEliminationCount(40, cfg), 25, 'nunca baja de 15 en una ronda grande');
  assert.equal(elimEntries.roundEliminationCount(15, cfg), 1);
  assert.equal(elimEntries.roundEliminationCount(3, { ...cfg, finalPerRound: 2 }), 2);
  assert.equal(elimEntries.roundEliminationCount(500, { perRound: 500 }), 500, 'sin fase final: lo de siempre');
});

test('el sorteo usa la fase final', () => {
  const { tenant, call } = loadElim();
  for (let i = 0; i < 40; i++) call('elim_add_manual_entry', { username: `u${i}`, count: 1 });
  Object.assign(tenant.elimState, { eliminationsPerRound: 100, finalPhaseAt: 15, finalPhasePerRound: 1 });
  tenant.beginEliminationReveal();
  assert.equal(tenant.elimState.revealTargetIds.length, 25);
});

test('Locked Mode: se edita libre en el tiempo para unirse y nada después', () => {
  const { tenant, call } = loadElim();
  tenant.elimState.lockedMode = true;
  call('elim_add_manual_entry', { username: 'ana', count: 2 });
  call('elim_add_manual_entry', { username: 'beto', count: 2 });
  assert.equal(call('elim_set_entries', { username: 'ana', count: 3 }).ok, true);
  tenant.elimState.mode = 'rejoin';
  for (const [event, payload] of [
    ['elim_add_manual_entry', { username: 'ana', count: 1 }],
    ['elim_set_entries', { username: 'ana', count: 1 }],
    ['elim_merge_participants', { a: 'ana', b: 'beto', target: 'a' }],
  ]) {
    const r = call(event, payload);
    assert.equal(r.ok, false, event);
    assert.match(r.error, /Locked Mode/);
  }
  assert.equal(tenant.elimState.participants.length, 5);
});

test('modo normal: se edita también con las eliminaciones en curso (resultado y reingreso)', () => {
  const { tenant, call } = loadElim();
  call('elim_add_manual_entry', { username: 'ana', count: 2 });
  call('elim_add_manual_entry', { username: 'beto', count: 2 });
  for (const mode of ['result', 'rejoin']) {
    tenant.elimState.mode = mode;
    assert.equal(call('elim_add_manual_entry', { username: 'ana', count: 1 }).ok, true, mode);
    assert.equal(call('elim_set_entries', { username: 'beto', count: 3 }).ok, true, mode);
  }
  assert.equal(call('elim_merge_participants', { a: 'ana', b: 'beto', target: 'b' }).ok, true);
});

test('la pausa solo funciona durante el tiempo para unirse; reanudar, siempre', () => {
  const { tenant, call } = loadElim();
  call('pause_elimination');
  assert.equal(tenant.elimState.paused, true);
  call('resume_elimination');
  call('pause_elimination');
  call('resume_elimination');
  assert.equal(tenant.elimState.paused, false, 'se puede las veces que se quiera');
  for (const mode of ['rejoin', 'result', 'revealing']) {
    tenant.elimState.mode = mode;
    call('pause_elimination');
    assert.equal(tenant.elimState.paused, false, mode);
  }
  // Una ronda recuperada tras reiniciar el servidor vuelve pausada en el reingreso.
  tenant.elimState.paused = true;
  call('resume_elimination');
  assert.equal(tenant.elimState.paused, false);
});

// ── Offstream: la misma dinámica solo con entradas manuales, sin TikTok ──

function loadConnection() {
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? helpers : {}),
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math, Number, String, Map, Set, Object, Array, Promise, JSON, Date, Error,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/connection'), 'utf8'), context);
  return context.module.exports;
}

test('offstream: se inicia sin TikTok, sin regalos, y los regalos no cuentan', () => {
  const { tenant, call } = loadElim();
  let connected = false;
  tenant.ensureTikTokConnection = async () => { connected = true; };
  call('start_elimination', { offstream: true, tiktokUsername: 'streamer', targetGiftName: 'Rosa', targetGiftCoins: 1, instaWinGiftName: 'León', instaWinGiftCoins: 100, baseTime: 60, rejoinTime: 20 });
  assert.equal(connected, false, 'no conecta el LIVE');
  const s = tenant.getElimPublicState();
  assert.equal(s.offstream, true);
  assert.equal(s.targetGiftCoins, 0);
  assert.equal(s.instaWinGiftCoins, 0);

  tenant.processGiftElim({ username: 'ana', avatar: 'ana.webp', totalCoins: 500 });
  assert.equal(tenant.elimState.participants.length, 0, 'un regalo no da entradas');
  assert.equal(tenant.elimState.winner, null, 'ni Insta-Win');
  assert.equal(JSON.stringify(tenant.getElimPublicState().recentGifters), '[]');

  call('elim_add_manual_entry', { username: 'ana', count: 3 });
  call('elim_add_manual_entry', { username: 'beto', count: 2 });
  assert.equal(tenant.elimState.participants.length, 5);
  // Cambiar ajustes con la ronda en curso no le pone regalos.
  call('update_elim_settings', { targetGiftName: 'Rosa', targetGiftCoins: 1, baseTime: 60, rejoinTime: 20 });
  assert.equal(tenant.elimState.targetGiftCoins, 0);
});

test('offstream: el sorteo funciona igual que siempre', () => {
  const { tenant, call } = loadElim();
  call('start_elimination', { offstream: true, baseTime: 60, rejoinTime: 20, eliminationsPerRound: 2 });
  call('elim_add_manual_entry', { username: 'ana', count: 3 });
  call('elim_add_manual_entry', { username: 'beto', count: 3 });
  tenant.beginEliminationReveal();
  assert.equal(tenant.elimState.mode, 'revealing');
  assert.equal(tenant.elimState.revealTargetIds.length, 2);
});

test('offstream: no mantiene la conexión a TikTok, no se detiene si se corta el LIVE y no se suelta de memoria', () => {
  const conn = loadConnection();
  let stopped = 0;
  const tenant = Object.assign(Object.create(conn), {
    contestState: {}, zubState: {}, rouletteState: {}, extensibleState: {}, versusState: {}, goalState: {},
    elimState: { isActive: true, offstream: true },
    desiredUsername: '', liveConnected: false, connectingPromise: null, lastSocketActivityAt: 0,
    stopElimination: () => { stopped += 1; },
  });
  assert.equal(tenant.anyContestNeedsConnection(), false);
  tenant.stopAllActiveGames();
  assert.equal(stopped, 0);
  assert.equal(tenant.isEvictable(false, 1), false);

  // Con regalos (modo normal) sigue como siempre.
  tenant.elimState.offstream = false;
  assert.equal(tenant.anyContestNeedsConnection(), true);
  tenant.stopAllActiveGames();
  assert.equal(stopped, 1);
});

// ── Peso de lo que se manda por socket (mismo canal que los comentarios del TTS) ──

test('la lista viaja compacta: cada foto una sola vez por jugador', () => {
  const avatar = (u) => `https://p16-sign-va.tiktokcdn.com/${u}/${'x'.repeat(380)}.webp`;
  const pool = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, username: `u${i % 80}`, avatar: avatar(`u${i % 80}`), source: i % 2 ? 'manual' : 'gift' }));
  const packed = elimEntries.packElimParticipants(pool);
  assert.equal(packed.players.length, 80);
  assert.equal(packed.slots.length, 1000);
  assert.deepEqual(packed.slots[1], [2, 1, 1]);
  const before = JSON.stringify(pool).length;
  const after = JSON.stringify(packed).length;
  assert.ok(after * 5 < before, `de ${before} a ${after} bytes`);
});

test('un regalo de alguien nuevo manda solo el aviso chico, no la lista completa', () => {
  const { tenant, sent, call } = loadElim();
  call('elim_add_manual_entry', { username: 'ana', count: 50 });
  sent.length = 0;
  tenant.processGiftElim({ username: 'lucia', avatar: 'lucia.webp', totalCoins: 1 });
  assert.deepEqual(sent.map((e) => e.name), ['elim_recent_gifters']);
  assert.equal(sent[0].payload.recentGifters[0].username, 'lucia');
  // Si alguien con entradas manuales regala, sus entradas toman su foto: ahí sí va la lista.
  sent.length = 0;
  tenant.processGiftElim({ username: 'ana', avatar: 'ana-real.webp', totalCoins: 1 });
  assert.equal(sent[0].name, 'elim_state_update');
});
