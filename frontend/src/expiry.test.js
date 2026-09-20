import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryNotice, dismissalKey } from './expiry.js';

const NOW = Date.parse('2026-09-20T12:00:00Z');
const H = 3600 * 1000;
const D = 24 * H;
const lic = (licenseType, msLeft, extra = {}) => ({ licenseType, expiresAt: NOW + msLeft, ...extra });

test('nothing to warn without a session, for admins, or for licenses that never expire', () => {
  assert.equal(expiryNotice(null, NOW), null);
  assert.equal(expiryNotice(lic('lifetime', 1 * D, { expiresAt: null }), NOW), null);
  assert.equal(expiryNotice(lic('month', 1 * D, { isAdmin: true }), NOW), null);
});

test('each plan warns with its own margin', () => {
  assert.equal(expiryNotice(lic('month', 6 * D), NOW), null);
  assert.ok(expiryNotice(lic('month', 5 * D), NOW));
  assert.equal(expiryNotice(lic('annual', 15 * D), NOW), null);
  assert.ok(expiryNotice(lic('annual', 14 * D), NOW));
  assert.equal(expiryNotice(lic('week', 3 * D), NOW), null);
  assert.ok(expiryNotice(lic('week', 2 * D), NOW));
  assert.equal(expiryNotice(lic('day', 10 * H), NOW), null);
  assert.ok(expiryNotice(lic('day', 5 * H), NOW));
});

test('the message counts days, then hours, and is urgent from the last day on', () => {
  const soon = expiryNotice(lic('month', 3 * D - H), NOW);
  assert.equal(soon.level, 'soon');
  assert.equal(soon.message, 'Tu licencia vence en 3 días.');
  const one = expiryNotice(lic('month', 1 * D + H), NOW);
  assert.equal(one.message, 'Tu licencia vence en 2 días.');
  const hours = expiryNotice(lic('month', 5 * H), NOW);
  assert.equal(hours.level, 'urgent');
  assert.equal(hours.message, 'Tu licencia vence en 5 horas.');
  assert.equal(expiryNotice(lic('month', 30 * 60 * 1000), NOW).message, 'Tu licencia vence en 1 hora.');
  assert.equal(expiryNotice(lic('month', -H), NOW).message, 'Tu licencia ya venció.');
});

test('a free trial is worded as a trial and asks to pick a plan', () => {
  const n = expiryNotice(lic('trial', 2 * D), NOW);
  assert.equal(n.trial, true);
  assert.match(n.message, /^Tu prueba gratis vence en 2 días\.$/);
  assert.match(n.detail, /Elige un plan/);
});

test('dismissal is per day and per expiry date', () => {
  const s = lic('month', 2 * D);
  const a = dismissalKey(s, new Date(2026, 8, 20));
  assert.equal(a, dismissalKey(s, new Date(2026, 8, 20, 23)));
  assert.notEqual(a, dismissalKey(s, new Date(2026, 8, 21)));
  assert.notEqual(a, dismissalKey({ ...s, expiresAt: s.expiresAt + 30 * D }, new Date(2026, 8, 20)));
});
