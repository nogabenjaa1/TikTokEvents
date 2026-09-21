import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mxn, formatBytes, formatUptime, formatWhen, formatDateTime, sourceLabel, kindLabel, actionLabel, describeDetails, describeTarget, reasonLabel,
  providerLabel, describePurchase,
} from './systemFormat.js';

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('money is shown in Mexican pesos from cents', () => {
  assert.equal(mxn(12600), 'MX$ 126');
  assert.equal(mxn(30650), 'MX$ 306.5');
  assert.equal(mxn(0), 'MX$ 0');
  assert.equal(mxn(undefined), 'MX$ 0');
  assert.equal(mxn('abc'), 'MX$ 0');
});

test('file sizes read naturally from bytes up to gigabytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(3.25 * 1024 * 1024 * 1024), '3.3 GB');
  assert.equal(formatBytes(-5), '-5 B');
  assert.equal(formatBytes(null), '0 B');
});

test('the server uptime is a short human phrase', () => {
  assert.equal(formatUptime(3), 'menos de 1 min');
  assert.equal(formatUptime(60), '1 min');
  assert.equal(formatUptime(59 * 60 + 40), '59 min');
  assert.equal(formatUptime(3 * 3600 + 20 * 60), '3 h 20 min');
  assert.equal(formatUptime(2 * 86400 + 4 * 3600), '2 d 4 h');
  assert.equal(formatUptime(undefined), 'menos de 1 min');
});

test('when something happened is relative for a week, then a date', () => {
  assert.equal(formatWhen(NOW - 10 * 1000, NOW), 'hace un momento');
  assert.equal(formatWhen(NOW - 5 * MIN, NOW), 'hace 5 min');
  assert.equal(formatWhen(NOW - 3 * HOUR, NOW), 'hace 3 h');
  assert.equal(formatWhen(NOW - DAY, NOW), 'hace 1 día');
  assert.equal(formatWhen(NOW - 4 * DAY, NOW), 'hace 4 días');
  assert.match(formatWhen(NOW - 20 * DAY, NOW), /2026/);
  assert.equal(formatWhen(0, NOW), '—');
  assert.equal(formatWhen(NaN, NOW), '—');
  assert.equal(formatWhen(NOW + 5000, NOW), 'hace un momento', 'a clock a little ahead never shows a negative time');
  assert.equal(formatDateTime(0), '—');
  assert.match(formatDateTime(NOW), /\d/);
});

test('error sources, kinds and history actions have Spanish names, and unknown ones show as they are', () => {
  assert.deepEqual(['frontend', 'backend', 'csp', 'otro'].map(sourceLabel), ['Navegador', 'Servidor', 'Seguridad', 'otro']);
  assert.deepEqual(['render', 'promise', 'rejection', 'csp', 'http', 'raro'].map(kindLabel), ['Fallo al dibujar', 'Promesa rechazada', 'Promesa rechazada', 'Política de seguridad', 'Petición HTTP', 'raro']);
  assert.equal(actionLabel('license.delete'), 'Eliminó la licencia');
  assert.equal(actionLabel('payment.apply_failure'), 'Aplicó un pago pendiente');
  assert.equal(actionLabel('algo.nuevo'), 'algo.nuevo');
});

test('every action the server writes to the history has a label', () => {
  for (const action of ['license.create', 'license.regenerate_key', 'license.revoke', 'license.multi_device', 'license.win_bonus', 'license.spotify_addon',
    'license.edit', 'license.extend', 'license.delete', 'license.bulk_delete', 'pricing.set', 'errors.clear', 'storage.cleanup', 'payment.apply_failure', 'payment.apply_stripe']) {
    assert.notEqual(actionLabel(action), action, action);
  }
});

test('the details of each action are summed up in one line', () => {
  assert.equal(describeDetails('license.create', { licenseType: 'month', spotifyAddon: true }), 'Plan Mensual con Spotify');
  assert.equal(describeDetails('license.create', { licenseType: 'annual', spotifyAddon: false }), 'Plan Anual');
  assert.equal(describeDetails('license.extend', { licenseType: 'lifetime' }), 'Plan Lifetime');
  assert.equal(describeDetails('license.edit', { licenseType: 'annual', multiDevice: true, spotifyAddon: false, diceTier: 'pro' }), 'plan: Anual · multi-dispositivo activado · Spotify desactivado · nivel de Color Says: pro');
  assert.equal(describeDetails('license.multi_device', { enabled: true }), 'Activado');
  assert.equal(describeDetails('license.spotify_addon', { enabled: false }), 'Desactivado');
  assert.equal(describeDetails('license.bulk_delete', { deleted: 3, skipped: 1 }), '3 eliminadas, 1 omitidas');
  assert.equal(describeDetails('pricing.set', { oldAmountCents: 12600, newAmountCents: 13500 }), 'MX$ 126 → MX$ 135');
  assert.equal(describeDetails('errors.clear', { removed: 12 }), '12 errores borrados');
  assert.equal(describeDetails('storage.cleanup', { deleted: 4, failed: 1, orphans: 9 }), '4 borrados, 1 con error, 9 huérfanos encontrados');
  assert.equal(describeDetails('payment.apply_failure', { provider: 'stripe', paymentId: 'pi_123' }), 'Stripe · pi_123');
  assert.equal(describeDetails('payment.apply_failure', { provider: 'mp', paymentId: '99' }), 'MercadoPago · 99');
  assert.equal(describeDetails('payment.apply_stripe', { paymentIntentId: 'pi_1', alreadyProcessed: true }), 'pi_1 (ya estaba registrado)');
});

test('details that are missing, odd or from a future action never break the history', () => {
  for (const details of [null, undefined, '', 'texto', 5]) assert.equal(describeDetails('license.create', details), '');
  assert.equal(describeDetails('license.create', {}), 'Plan undefined', 'a create with no data still renders');
  assert.equal(describeDetails('accion.futura', { a: 1 }), '{"a":1}');
  assert.equal(describeDetails('license.bulk_delete', {}), '0 eliminadas, 0 omitidas');
});

test('the target of an action is a license with an @, or a plan for a price change', () => {
  assert.equal(describeTarget({ action: 'license.create', target: 'ana', targetLicenseId: 'lic-1' }), '@ana');
  assert.equal(describeTarget({ action: 'license.delete', target: 'zoe', targetLicenseId: null }), '@zoe', 'a deleted license still reads as a user');
  assert.equal(describeTarget({ action: 'pricing.set', target: 'month' }), 'Mensual');
  assert.equal(describeTarget({ action: 'pricing.set', target: 'raro' }), 'raro');
  assert.equal(describeTarget({ action: 'payment.apply_failure', target: 'ana', targetLicenseId: 'lic-1' }), '@ana');
  assert.equal(describeTarget({ action: 'errors.clear', target: null }), '');
  assert.equal(describeTarget({ action: 'storage.cleanup', target: 'algo' }), 'algo');
});

test('pending payments explain why they are pending and what they bought', () => {
  assert.equal(reasonLabel('apply_failed'), 'No se pudo guardar el cambio en la licencia');
  assert.equal(reasonLabel('license_missing'), 'La licencia no existía en ese momento');
  assert.equal(reasonLabel('nuevo'), 'nuevo');
  assert.deepEqual([providerLabel('stripe'), providerLabel('mp'), providerLabel(undefined)], ['Stripe', 'MercadoPago', 'MercadoPago']);
  assert.equal(describePurchase({ planType: 'annual', diceTier: null, spotifyAddon: true }), 'Anual + Spotify');
  assert.equal(describePurchase({ planType: null, diceTier: 'pro', spotifyAddon: false }), 'Color Says PRO');
  assert.equal(describePurchase({ planType: null, diceTier: null, spotifyAddon: true }), 'Complemento de Spotify');
  assert.equal(describePurchase({ planType: 'month', diceTier: 'regular' }), 'Mensual');
  assert.equal(describePurchase({}), 'Sin detalle');
});
