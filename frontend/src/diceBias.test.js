import test from 'node:test';
import assert from 'node:assert/strict';
import { rollFair, streamerFavoredRoll, rollWithWinBonus, rollForSafeMode, outcomeForCount } from './diceBias.js';

const counts = (dice) => dice.reduce((acc, c) => ({ ...acc, [c]: (acc[c] || 0) + 1 }), {});

test('reglas: 0 pierde, 1 gana, 2 pierde, 3 re-tiro, 4 doble', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(outcomeForCount), ['lose', 'win', 'lose', 'reroll', 'double']);
});

test('tirada a favor del streamer: ningún color sale 1 ni 4 veces', () => {
  for (let n = 2; n <= 6; n++) {
    for (let i = 0; i < 200; i++) {
      const dice = streamerFavoredRoll(n);
      assert.equal(dice.length, n);
      const values = Object.values(counts(dice));
      assert.ok(values.every((c) => c === 2 || c === 3), `${n} dados: ${dice}`);
      assert.ok(values.filter((c) => c === 3).length === n % 2, 'un trío solo con dados impares');
    }
  }
});

test('win bonus al 100% siempre favorece al streamer; al 0% es una tirada normal', () => {
  for (let i = 0; i < 100; i++) {
    assert.ok(Object.values(counts(rollWithWinBonus(4, 1))).every((c) => c === 2));
  }
  let singles = 0;
  for (let i = 0; i < 300; i++) if (Object.values(counts(rollWithWinBonus(4, 0))).includes(1)) singles++;
  assert.ok(singles > 0, 'sin bonus aparecen colores que salen 1 vez');
});

test('Modo Seguro: Asegurar = 1 vez (gana); Bloquear = 0 o 2 veces (pierde), nunca 3 ni 4', () => {
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i < 100; i++) {
      assert.equal(counts(rollForSafeMode(n, 2, 'ensure'))[2], 1);
      const blocked = counts(rollForSafeMode(n, 2, 'block'))[2] || 0;
      assert.ok(blocked === 0 || blocked === 2, `${n} dados: ${blocked}`);
      assert.equal(outcomeForCount(blocked), 'lose');
    }
  }
});

test('rollFair da la cantidad de dados pedida', () => {
  assert.equal(rollFair(5).length, 5);
});
