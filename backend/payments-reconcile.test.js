const test = require('node:test');
const assert = require('node:assert/strict');
const { listSucceededStripeIntents, findUnrecordedStripe, summarizeWithoutLicense } = require('./lib/paymentsReconcile');

// Reconciliation only reads and compares: applying a pending payment is always the admin's decision.

const intent = (id, extra = {}) => ({ id, status: 'succeeded', amount: 1260, amount_received: 1260, created: 1_780_000_000, metadata: { licenseId: `lic-${id}`, planType: 'month' }, ...extra });

function fakeStripe(pages) {
  const calls = [];
  return {
    calls,
    paymentIntents: {
      list: async (params) => {
        calls.push(params);
        return pages[calls.length - 1] || { data: [], has_more: false };
      },
    },
  };
}

test('only succeeded charges that carry a license of this site are collected', async () => {
  const stripe = fakeStripe([{ data: [
    intent('pi_ok1'),
    intent('pi_failed', { status: 'requires_payment_method' }),
    intent('pi_canceled', { status: 'canceled' }),
    intent('pi_nolicense', { metadata: {} }),
    intent('pi_ok2'),
  ], has_more: false }]);
  const found = await listSucceededStripeIntents(stripe, { sinceSec: 1_779_000_000 });
  assert.deepEqual(found.map((i) => i.id), ['pi_ok1', 'pi_ok2']);
  assert.deepEqual(stripe.calls[0], { limit: 100, created: { gte: 1_779_000_000 } });
});

test('it pages through the results, continuing after the last one it saw', async () => {
  const stripe = fakeStripe([
    { data: [intent('pi_1'), intent('pi_2')], has_more: true },
    { data: [intent('pi_3')], has_more: false },
  ]);
  const found = await listSucceededStripeIntents(stripe, { sinceSec: 1 });
  assert.deepEqual(found.map((i) => i.id), ['pi_1', 'pi_2', 'pi_3']);
  assert.equal(stripe.calls.length, 2);
  assert.equal(stripe.calls[0].starting_after, undefined);
  assert.equal(stripe.calls[1].starting_after, 'pi_2');
});

test('paging is capped, and an empty page ends it even if Stripe says there is more', async () => {
  const endless = { data: [intent('pi_x')], has_more: true };
  const capped = fakeStripe(Array.from({ length: 10 }, () => endless));
  await listSucceededStripeIntents(capped, { sinceSec: 1, maxPages: 3 });
  assert.equal(capped.calls.length, 3);
  const empty = fakeStripe([{ data: [], has_more: true }]);
  assert.deepEqual(await listSucceededStripeIntents(empty, { sinceSec: 1 }), []);
  assert.equal(empty.calls.length, 1);
  const noData = fakeStripe([{ has_more: true }]);
  assert.deepEqual(await listSucceededStripeIntents(noData, { sinceSec: 1 }), []);
});

test('a Stripe error is not hidden: the caller decides what to tell the admin', async () => {
  const stripe = { paymentIntents: { list: async () => { throw new Error('invalid api key'); } } };
  await assert.rejects(() => listSucceededStripeIntents(stripe, { sinceSec: 1 }), /invalid api key/);
});

test('a charge missing from the payments table is reported with what is needed to apply it', () => {
  const intents = [
    intent('pi_known'),
    intent('pi_missing', { amount_received: 30600, created: 1_780_000_123, metadata: { licenseId: 'lic-9', planType: 'annual', diceTier: 'pro', spotifyAddon: 'true' } }),
    intent('pi_plain', { amount_received: undefined, amount: 500, metadata: { licenseId: 'lic-2' } }),
  ];
  const missing = findUnrecordedStripe(intents, new Set(['pi_known']));
  assert.deepEqual(missing, [
    { paymentIntentId: 'pi_missing', licenseId: 'lic-9', planType: 'annual', diceTier: 'pro', spotifyAddon: true, amountCents: 30600, createdAt: 1_780_000_123_000 },
    { paymentIntentId: 'pi_plain', licenseId: 'lic-2', planType: null, diceTier: null, spotifyAddon: false, amountCents: 500, createdAt: 1_780_000_000_000 },
  ]);
  assert.deepEqual(findUnrecordedStripe(intents, new Set(['pi_known', 'pi_missing', 'pi_plain'])), []);
  assert.deepEqual(findUnrecordedStripe([], new Set()), []);
});

test('payments whose license was deleted are only summarised: the revenue history is kept on purpose', () => {
  const rows = [
    { provider: 'stripe', license_id: 'gone-1', plan_type: 'month', amount_cents: 1260, created_at: '1780000000000' },
    { provider: null, license_id: 'gone-2', plan_type: 'annual', amount_cents: '3060', created_at: 1780000001000 },
    { provider: 'mp', license_id: 'gone-3', plan_type: null, amount_cents: null, created_at: null },
  ];
  const summary = summarizeWithoutLicense(rows);
  assert.equal(summary.count, 3);
  assert.equal(summary.amountCents, 1260 + 3060);
  assert.deepEqual(summary.latest[1], { provider: 'mercadopago', licenseId: 'gone-2', planType: 'annual', amountCents: 3060, createdAt: 1780000001000 });
  assert.deepEqual(summary.latest[2], { provider: 'mp', licenseId: 'gone-3', planType: null, amountCents: 0, createdAt: 0 });
  assert.equal(summarizeWithoutLicense(Array.from({ length: 50 }, (_, i) => ({ license_id: `l${i}`, amount_cents: 1 }))).latest.length, 20, 'the list is short, the total is not');
  assert.deepEqual(summarizeWithoutLicense([]), { count: 0, amountCents: 0, latest: [] });
});
