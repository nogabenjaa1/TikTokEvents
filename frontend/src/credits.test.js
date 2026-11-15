import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditsForMxnCents, toMxnCents, fromMxnCents, parseAmountInput, topupAmountError, formatMoney, convertInput, formatCredits, topupLimitsMxnCents,
  topupPresets,
} from './credits.js';

const RATE = 1800;

test('the preview uses the same rule as the server: US$5 (MX$90) = 100 credits, rounded', () => {
  assert.equal(creditsForMxnCents(9000, RATE), 100);
  assert.equal(creditsForMxnCents(10000, RATE), 111);
  assert.equal(creditsForMxnCents(toMxnCents(1000, 'usd', RATE), RATE), 200);
});

test('dollars become the pesos that are charged, and back', () => {
  assert.equal(toMxnCents(1000, 'usd', RATE), 18000);
  assert.equal(toMxnCents(10000, 'mxn', RATE), 10000);
  assert.equal(fromMxnCents(18000, 'usd', RATE), 1000);
  assert.equal(fromMxnCents(18000, 'mxn', RATE), 18000);
});

test('typed amounts become cents in either currency', () => {
  assert.equal(parseAmountInput('3'), 300);
  assert.equal(parseAmountInput('3,50'), 350);
  assert.equal(parseAmountInput(' $10 '), 1000);
  assert.equal(parseAmountInput('MX$250'), 25000);
  assert.equal(parseAmountInput('US$7.25'), 725);
  for (const bad of ['', 'abc', '3.555', '-5', '1e3']) assert.equal(parseAmountInput(bad), null, bad);
});

test('limits are explained in the chosen currency', () => {
  assert.deepEqual(topupLimitsMxnCents(RATE), { min: 1800, max: 900000 });
  assert.equal(topupAmountError(10000, 'mxn', RATE), '');
  assert.equal(topupAmountError(300, 'usd', RATE), '');
  assert.match(topupAmountError(1000, 'mxn', RATE), /mínimo es MX\$18/);
  assert.match(topupAmountError(50, 'usd', RATE), /mínimo es US\$1/);
  assert.match(topupAmountError(60000, 'usd', RATE), /máximo por recarga es US\$500/);
  assert.match(topupAmountError(1000000, 'mxn', RATE), /máximo por recarga es MX\$9,000/);
  assert.match(topupAmountError(null, 'mxn', RATE), /Escribe un monto/);
});

test('quick amounts are the same in both currencies and give round credits', () => {
  assert.deepEqual(topupPresets('usd', RATE), [3, 5, 10, 20]);
  assert.deepEqual(topupPresets('mxn', RATE), [54, 90, 180, 360]);
  assert.deepEqual(topupPresets('mxn', RATE).map((mxn) => creditsForMxnCents(mxn * 100, RATE)), [60, 100, 200, 400]);
  assert.deepEqual(topupPresets('mxn', 2000), [60, 100, 200, 400]);
});

test('switching currency converts what was typed', () => {
  assert.equal(convertInput('180', 'mxn', 'usd', RATE), '10');
  assert.equal(convertInput('10', 'usd', 'mxn', RATE), '180');
  assert.equal(convertInput('100', 'mxn', 'usd', RATE), '5.56');
  assert.equal(convertInput('abc', 'mxn', 'usd', RATE), 'abc');
});

test('amounts and balances read naturally', () => {
  assert.equal(formatMoney(18000, 'mxn'), 'MX$180');
  assert.equal(formatMoney(5994, 'mxn'), 'MX$59.94');
  assert.equal(formatMoney(350, 'usd'), 'US$3.50');
  assert.equal(formatCredits(1500), '1,500');
});
