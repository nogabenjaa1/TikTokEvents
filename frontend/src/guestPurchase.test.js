import test from 'node:test';
import assert from 'node:assert/strict';
import { savePendingGuestPurchase, loadPendingGuestPurchase, clearPendingGuestPurchase, confirmGuestPurchase } from './guestPurchase.js';

const memoryStore = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};

test('a pending purchase is kept for two days so the buyer can collect the key after closing the tab, then forgotten', () => {
  const store = memoryStore();
  savePendingGuestPurchase({ checkoutSessionId: 'cs_test_1', claimToken: 'tok', alias: 'novia', planType: 'annual' }, store, 1000);
  assert.deepEqual(loadPendingGuestPurchase(store, 1000 + 60_000), { checkoutSessionId: 'cs_test_1', claimToken: 'tok', alias: 'novia', planType: 'annual', savedAt: 1000 });
  assert.equal(loadPendingGuestPurchase(store, 1000 + 3 * 24 * 60 * 60 * 1000), null, 'too old');
  assert.equal(store.data.size, 0, 'and an old one is removed');

  savePendingGuestPurchase({ checkoutSessionId: 'cs_test_2', claimToken: 'tok' }, store, 5);
  clearPendingGuestPurchase(store);
  assert.equal(loadPendingGuestPurchase(store, 6), null);

  store.setItem('tkc_guest_purchase', '{not json');
  assert.equal(loadPendingGuestPurchase(store), null, 'garbage never breaks the page');
});

const reply = (status, body) => async () => ({ status, json: async () => body });

test('collecting the key: approved returns it, pending retries, and a purchase that is gone is not retried', async () => {
  const noSleep = async () => {};
  const approved = await confirmGuestPurchase({ backendUrl: '', checkoutSessionId: 'cs', claimToken: 't', sleep: noSleep,
    fetchImpl: reply(200, { success: true, status: 'approved', key: 'novia-yearly-AAA', token: 'jwt', license: { licenseType: 'annual' } }) });
  assert.deepEqual(approved, { status: 'approved', key: 'novia-yearly-AAA', token: 'jwt', license: { licenseType: 'annual' } });

  let calls = 0;
  const pending = await confirmGuestPurchase({ backendUrl: '', checkoutSessionId: 'cs', claimToken: 't', attempts: 3, sleep: noSleep,
    fetchImpl: async () => { calls += 1; return { status: 200, json: async () => ({ success: true, status: 'pending' }) }; } });
  assert.deepEqual(pending, { status: 'pending' });
  assert.equal(calls, 3);

  let later = 0;
  const thenApproved = await confirmGuestPurchase({ backendUrl: '', checkoutSessionId: 'cs', claimToken: 't', sleep: noSleep,
    fetchImpl: async () => { later += 1; return { status: 200, json: async () => (later < 2 ? { success: true, status: 'pending' } : { success: true, status: 'approved', key: 'k', token: 'j', license: {} }) }; } });
  assert.equal(thenApproved.status, 'approved');

  for (const status of [404, 409]) {
    let tries = 0;
    const gone = await confirmGuestPurchase({ backendUrl: '', checkoutSessionId: 'cs', claimToken: 't', sleep: noSleep,
      fetchImpl: async () => { tries += 1; return { status, json: async () => ({ success: false, error: 'ya se entregó' }) }; } });
    assert.deepEqual(gone, { status: 'gone', error: 'ya se entregó' });
    assert.equal(tries, 1);
  }

  const offline = await confirmGuestPurchase({ backendUrl: '', checkoutSessionId: 'cs', claimToken: 't', attempts: 2, sleep: noSleep,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(offline, { status: 'pending' }, 'a network error is retried, never treated as gone');
});
