const test = require('node:test');
const assert = require('node:assert/strict');
const credits = require('./lib/credits');

test('5 dollars are 100 credits, and any amount converts at the same rate', () => {
  assert.equal(credits.creditsForUsdCents(500), 100);
  assert.equal(credits.creditsForUsdCents(300), 60);
  assert.equal(credits.creditsForUsdCents(100), 20);
  assert.equal(credits.creditsForUsdCents(1000), 200);
  assert.equal(credits.creditsForUsdCents(50000), 10000);
});

test('credits are always rounded to the nearest whole credit', () => {
  assert.equal(credits.creditsForUsdCents(333), 67); // 66.6
  assert.equal(credits.creditsForUsdCents(102), 20); // 20.4
  assert.equal(credits.creditsForUsdCents(103), 21); // 20.6
  assert.equal(credits.creditsForUsdCents(1999), 400); // 399.8
  assert.ok(Number.isInteger(credits.creditsForUsdCents(777)));
});

test('the top-up amount must be whole cents between US$1 and US$500', () => {
  assert.equal(credits.parseTopupUsdCents(300), 300);
  assert.equal(credits.parseTopupUsdCents(100), 100);
  assert.equal(credits.parseTopupUsdCents(50000), 50000);
  for (const bad of [99, 50001, 0, -500, 3.5, '300', null, undefined, NaN, Infinity]) {
    assert.equal(credits.parseTopupUsdCents(bad), null, String(bad));
  }
});

test('dollar amounts read naturally', () => {
  assert.equal(credits.formatUsd(300), 'US$3');
  assert.equal(credits.formatUsd(350), 'US$3.50');
  assert.equal(credits.formatUsd(50000), 'US$500');
});
