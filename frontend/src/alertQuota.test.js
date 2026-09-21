import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaSummary } from './alertQuota.js';

const monthly = { max: 50, used: 0, unlimited: false, plan: 'month' };

test('a plan with a cap shows "used of max", how full it is and stays quiet while there is room', () => {
  const summary = quotaSummary(monthly, 12);
  assert.deepEqual(summary, { unlimited: false, used: 12, max: 50, label: '12 de 50 alertas', percent: 24, level: 'ok', full: false, message: null });
  assert.equal(quotaSummary(monthly, 0).percent, 0);
});

test('close to the cap it warns, and at the cap it is full with the server message', () => {
  assert.equal(quotaSummary(monthly, 44).level, 'ok');
  assert.equal(quotaSummary(monthly, 45).level, 'warn', '90 percent of 50');
  assert.equal(quotaSummary(monthly, 49).level, 'warn');
  assert.equal(quotaSummary(monthly, 49).full, false);
  const full = quotaSummary(monthly, 50, 'Tu plan Mensual permite hasta 50 alertas. Borra alguna o pasa al plan Anual (150) o Lifetime (ilimitadas).');
  assert.deepEqual([full.level, full.full, full.percent], ['full', true, 100]);
  assert.match(full.message, /Anual \(150\)/);
});

test('without the server text a full plan still explains itself, and going over never breaks the bar', () => {
  const over = quotaSummary(monthly, 60);
  assert.equal(over.percent, 100);
  assert.equal(over.full, true);
  assert.match(over.message, /límite de 50 alertas/);
});

test('an annual plan scales the same way', () => {
  const annual = { max: 150, used: 0, unlimited: false, plan: 'annual' };
  assert.equal(quotaSummary(annual, 134).level, 'ok');
  assert.equal(quotaSummary(annual, 135).level, 'warn');
  assert.equal(quotaSummary(annual, 150).full, true);
});

test('an unlimited plan never warns and never blocks', () => {
  for (const quota of [{ max: null, used: 3, unlimited: true, plan: 'lifetime' }, { max: null, unlimited: true }, { unlimited: false }, { max: 0, unlimited: false }, { max: NaN, unlimited: false }]) {
    const summary = quotaSummary(quota, 900);
    assert.deepEqual([summary.unlimited, summary.full, summary.level, summary.message], [true, false, 'ok', null], JSON.stringify(quota));
  }
});

test('no quota from the server means nothing to show', () => {
  for (const quota of [undefined, null, 'x', 5]) assert.equal(quotaSummary(quota, 3), null, String(quota));
});
