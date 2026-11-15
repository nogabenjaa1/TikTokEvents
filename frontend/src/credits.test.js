import test from 'node:test';
import assert from 'node:assert/strict';
import { creditsForUsdCents, parseUsdInput, topupAmountError, formatUsd, formatCredits } from './credits.js';

test('the preview uses the same rate as the server: US$5 = 100 credits, rounded', () => {
  assert.equal(creditsForUsdCents(500), 100);
  assert.equal(creditsForUsdCents(300), 60);
  assert.equal(creditsForUsdCents(333), 67);
  assert.equal(creditsForUsdCents(102), 20);
});

test('typed dollar amounts become cents', () => {
  assert.equal(parseUsdInput('3'), 300);
  assert.equal(parseUsdInput('3.5'), 350);
  assert.equal(parseUsdInput('3,50'), 350);
  assert.equal(parseUsdInput(' $10 '), 1000);
  assert.equal(parseUsdInput('US$7.25'), 725);
  assert.equal(parseUsdInput('0.99'), 99);
  for (const bad of ['', 'abc', '3.555', '-5', '1e3', '3.5.1']) assert.equal(parseUsdInput(bad), null, bad);
});

test('amounts outside US$1 to US$500 explain the limit', () => {
  assert.equal(topupAmountError(300), '');
  assert.match(topupAmountError(99), /mínimo es US\$1/);
  assert.match(topupAmountError(50001), /máximo por recarga es US\$500/);
  assert.match(topupAmountError(null), /Escribe un monto/);
});

test('amounts and balances read naturally', () => {
  assert.equal(formatUsd(350), 'US$3.50');
  assert.equal(formatUsd(500), 'US$5');
  assert.equal(formatCredits(1500), '1,500');
});
