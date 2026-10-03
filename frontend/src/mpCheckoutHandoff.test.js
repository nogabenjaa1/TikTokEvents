import test from 'node:test';
import assert from 'node:assert/strict';
import { saveMpCheckout, loadMpCheckout, clearMpCheckout } from './mpCheckoutHandoff.js';

function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const purchase = { planType: 'month', amount: 126, email: 'a@b.mx', firstName: 'Ana', lastName: 'Ruiz', policyAcceptedAt: '2026-10-03T10:00:00.000Z' };

test('lo guardado se recupera tal cual y se borra', () => {
  const store = memoryStore();
  assert.ok(saveMpCheckout(purchase, store));
  const loaded = loadMpCheckout(store);
  assert.equal(loaded.planType, 'month');
  assert.equal(loaded.amount, 126);
  clearMpCheckout(store);
  assert.equal(loadMpCheckout(store), null);
});

test('una compra vieja o incompleta no se retoma', () => {
  const store = memoryStore();
  saveMpCheckout(purchase, store);
  assert.equal(loadMpCheckout(store, Date.now() + 31 * 60 * 1000), null);
  saveMpCheckout({ ...purchase, policyAcceptedAt: null }, store);
  assert.equal(loadMpCheckout(store), null);
  saveMpCheckout({ ...purchase, planType: undefined }, store);
  assert.equal(loadMpCheckout(store), null);
  saveMpCheckout({ ...purchase, planType: undefined, spotifyAddon: true }, store);
  assert.equal(loadMpCheckout(store).spotifyAddon, true);
});

test('sin almacenamiento disponible no revienta', () => {
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  assert.equal(saveMpCheckout(purchase, broken), false);
  assert.equal(loadMpCheckout(broken), null);
  assert.doesNotThrow(() => clearMpCheckout(broken));
  const bad = memoryStore();
  bad.setItem('mpCheckoutPending', '{no es json');
  assert.equal(loadMpCheckout(bad), null);
});
