const test = require('node:test');
const assert = require('node:assert/strict');
const credits = require('./lib/credits');

const RATE = 1800; // MX$18 por dólar

test('5 dollars (MX$90 at 18) are 100 credits', () => {
  assert.equal(credits.creditsForMxnCents(9000, RATE), 100);
  assert.equal(credits.creditsForMxnCents(18000, RATE), 200);
  assert.equal(credits.creditsForMxnCents(5400, RATE), 60); // US$3
});

test('credits from pesos are rounded to the nearest whole credit', () => {
  assert.equal(credits.creditsForMxnCents(10000, RATE), 111); // 111.1
  assert.equal(credits.creditsForMxnCents(5000, RATE), 56); // 55.6
  assert.ok(Number.isInteger(credits.creditsForMxnCents(12345, RATE)));
});

test('the credits follow the exchange rate in force', () => {
  assert.equal(credits.creditsForMxnCents(10000, 2000), 100); // MX$100 at 20 = US$5
  assert.equal(credits.creditsForMxnCents(9000, 1800), 100);
});

test('an amount typed in dollars is charged in pesos', () => {
  assert.equal(credits.parseTopup({ amountCents: 1000, currency: 'usd' }, RATE), 18000);
  assert.equal(credits.parseTopup({ amountCents: 333, currency: 'usd' }, RATE), 5994);
  assert.equal(credits.parseTopup({ amountCents: 10000, currency: 'mxn' }, RATE), 10000);
});

test('top-ups must be between US$1 and US$500 in pesos, and at least MX$10', () => {
  assert.deepEqual(credits.topupLimitsMxnCents(RATE), { min: 1800, max: 900000 });
  assert.equal(credits.topupLimitsMxnCents(500).min, 1000); // Stripe minimum wins
  assert.equal(credits.parseTopup({ amountCents: 1799, currency: 'mxn' }, RATE), null);
  assert.equal(credits.parseTopup({ amountCents: 1800, currency: 'mxn' }, RATE), 1800);
  assert.equal(credits.parseTopup({ amountCents: 99, currency: 'usd' }, RATE), null);
  assert.equal(credits.parseTopup({ amountCents: 50001, currency: 'usd' }, RATE), null);
  assert.equal(credits.parseTopup({ amountCents: 900001, currency: 'mxn' }, RATE), null);
  for (const bad of [{ amountCents: 300 }, { amountCents: 300, currency: 'eur' }, { amountCents: 3.5, currency: 'usd' },
    { amountCents: '300', currency: 'usd' }, { amountCents: -500, currency: 'mxn' }, {}, undefined]) {
    assert.equal(credits.parseTopup(bad, RATE), null, JSON.stringify(bad));
  }
});

test('only sensible exchange rates are accepted', () => {
  assert.ok(credits.isValidRate(1800));
  for (const bad of [499, 5001, 18.5, '1800', null, 0]) assert.equal(credits.isValidRate(bad), false, String(bad));
});

test('amounts read naturally', () => {
  assert.equal(credits.formatMxn(18000), 'MX$180');
  assert.equal(credits.formatMxn(5994), 'MX$59.94');
  assert.equal(credits.formatUsd(350), 'US$3.50');
  assert.equal(credits.usdCentsForMxnCents(18000, RATE), 1000);
});
