const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeBilling, TRIAL_DAYS } = require('./lib/stripeBilling');

// Subscriptions (Monthly/Annual), the 14-day trial and the Lifetime trial that charges the one-time price on
// day 14. The database and Stripe are in-memory fakes; the module only talks to them through these methods.

const DAY = 24 * 60 * 60 * 1000;
const sec = (ms) => Math.floor(ms / 1000);

function setup({ licenses = {}, subs = {}, setupIntents = {} } = {}) {
  const rows = new Map(Object.entries(licenses).map(([id, row]) => [id, { id, revoked: false, expires_at: null, ...row }]));
  const fingerprints = new Map();
  const events = { canceled: [], created: [], applied: [], pushed: [], intents: [], logs: [] };
  let intentOutcome = 'succeeded';
  const db = {
    findCoreById: async (id) => (rows.has(id) ? { ...rows.get(id) } : undefined),
    findByStripeSubscriptionId: async (subId) => [...rows.values()].find((r) => r.stripe_subscription_id === subId),
    insertLicense: async (row) => {
      if (rows.has(row.id)) { const err = new Error('dup'); err.code = '23505'; throw err; }
      events.created.push({ ...row });
      rows.set(row.id, { id: row.id, username: row.username, license_type: row.licenseType, expires_at: row.expiresAt, pending_key_reveal: row.pendingKeyReveal, revoked: false });
    },
    applyBillingState: async (id, f) => {
      const r = rows.get(id);
      const map = { licenseType: 'license_type', expiresAt: 'expires_at', stripeSubscriptionId: 'stripe_subscription_id', stripeCustomerId: 'stripe_customer_id', subscriptionStatus: 'subscription_status', subscriptionPlan: 'subscription_plan', subscriptionCancelAt: 'subscription_cancel_at', lifetimeTrialChargeAt: 'lifetime_trial_charge_at', lifetimeTrialAmountCents: 'lifetime_trial_amount_cents', lifetimeTrialPaymentMethod: 'lifetime_trial_payment_method' };
      for (const [k, v] of Object.entries(f)) if (v !== undefined) r[map[k]] = v;
    },
    claimTrialFingerprint: async (fp, licenseId) => { if (!fingerprints.has(fp)) fingerprints.set(fp, licenseId); return fingerprints.get(fp) === licenseId; },
    listDueLifetimeTrials: async (now) => [...rows.values()].filter((r) => r.lifetime_trial_charge_at && r.lifetime_trial_charge_at <= now && !r.revoked).map((r) => ({ ...r })),
  };
  const stripe = {
    subscriptions: {
      retrieve: async (id) => structuredClone(subs[id]),
      cancel: async (id) => { events.canceled.push(id); if (subs[id]) subs[id].status = 'canceled'; return subs[id]; },
    },
    setupIntents: { retrieve: async (id) => structuredClone(setupIntents[id]) },
    paymentIntents: {
      create: async (params, opts) => {
        events.intents.push({ params, opts });
        if (intentOutcome === 'throw') throw new Error('Your card was declined.');
        return { id: `pi_${events.intents.length}`, status: intentOutcome };
      },
    },
  };
  const billing = createStripeBilling({
    db,
    auth: { generateLabeledKey: (alias, label) => `${alias}-${label}-KEY` },
    pricing: { getPlanPriceCents: (plan) => ({ month: 12600, annual: 108000, lifetime: 180000 }[plan]) },
    getStripeClient: () => stripe,
    apiVersion: '2026-10-28.endive',
    storedKeyFields: (key) => ({ keyHash: `hash(${key})`, keyPrefix: key.slice(0, 4), keyEncrypted: `enc(${key})` }),
    planKeyLabels: { month: 'monthly', annual: 'yearly', lifetime: 'lifetime' },
    pushLicenseState: (id) => events.pushed.push(id),
    applyApprovedStripePaymentIfNew: async (args) => { events.applied.push(args); return { applied: true }; },
    log: { log: () => {}, error: (...a) => events.logs.push(a.join(' ')) },
  });
  return { billing, rows, fingerprints, subs, events, stripe, setIntentOutcome: (v) => { intentOutcome = v; } };
}

const trialSub = (id, { licenseId, planType = 'month', fingerprint = 'fp_1', trial = '1', trialEnd = Date.now() + TRIAL_DAYS * DAY, extra = {} } = {}) => ({
  id, status: 'trialing', customer: 'cus_1', trial_end: sec(trialEnd), cancel_at: null, cancel_at_period_end: false,
  metadata: { licenseId, planType, trial }, default_payment_method: { id: 'pm_1', card: { fingerprint } },
  items: { data: [{ current_period_end: sec(trialEnd) }] }, ...extra,
});
const session = (over) => ({ id: 'cs_test_1', status: 'complete', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', ...over });

test('a 14-day trial without an account creates a trial license that ends when the trial does, and remembers the card', async () => {
  const end = Date.now() + TRIAL_DAYS * DAY;
  const t = setup({ subs: { sub_1: trialSub('sub_1', { licenseId: 'lic-new', trialEnd: end }) } });
  const result = await t.billing.fulfillBillingSession(session({ metadata: { licenseId: 'lic-new', planType: 'month', trial: '1', newLicenseAlias: 'novia' } }));
  assert.equal(result.status, 'approved');
  const row = t.rows.get('lic-new');
  assert.equal(row.license_type, 'trial', 'no Spotify or paid perks until the first charge');
  assert.equal(row.expires_at, sec(end) * 1000);
  assert.equal(row.stripe_subscription_id, 'sub_1');
  assert.equal(row.subscription_status, 'trialing');
  assert.equal(row.subscription_plan, 'month');
  assert.equal(row.pending_key_reveal, 'novia-monthly-KEY', 'the buyer collects the key');
  assert.equal(t.fingerprints.get('fp_1'), 'lic-new');

  // The webhook and the browser both arrive: nothing is created twice.
  const again = await t.billing.fulfillBillingSession(session({ metadata: { licenseId: 'lic-new', planType: 'month', trial: '1', newLicenseAlias: 'novia' } }));
  assert.equal(again.status, 'approved');
  assert.equal(t.events.created.length, 1);
  assert.deepEqual(t.events.canceled, []);
});

test('a card that already had its trial gets no second one: the subscription is canceled before any charge and no license is made', async () => {
  const t = setup({ subs: { sub_1: trialSub('sub_1', { licenseId: 'lic-a' }), sub_2: trialSub('sub_2', { licenseId: 'lic-b' }) } });
  await t.billing.fulfillBillingSession(session({ metadata: { licenseId: 'lic-a', planType: 'month', trial: '1', newLicenseAlias: 'a' } }));
  const second = await t.billing.fulfillBillingSession(session({ id: 'cs_2', subscription: 'sub_2', metadata: { licenseId: 'lic-b', planType: 'annual', trial: '1', newLicenseAlias: 'b' } }));
  assert.equal(second.status, 'trial_used');
  assert.deepEqual(t.events.canceled, ['sub_2']);
  assert.equal(t.rows.has('lic-b'), false);

  // No fingerprint (it should not happen: trials are card only) is never a free trial either.
  const t2 = setup({ subs: { sub_3: trialSub('sub_3', { licenseId: 'lic-c', fingerprint: null }) } });
  assert.equal((await t2.billing.fulfillBillingSession(session({ subscription: 'sub_3', metadata: { licenseId: 'lic-c', planType: 'month', trial: '1', newLicenseAlias: 'c' } }))).status, 'trial_used');
});

test('when the trial ends and Stripe charges, the license becomes the plan until the period end plus a short grace', async () => {
  const t = setup({ subs: { sub_1: trialSub('sub_1', { licenseId: 'lic-1' }) } });
  await t.billing.fulfillBillingSession(session({ metadata: { licenseId: 'lic-1', planType: 'annual', trial: '1', newLicenseAlias: 'x' } }));
  const periodEnd = Date.now() + 365 * DAY;
  // The newer API keeps the period on the subscription item; older ones on the subscription. Both work.
  for (const shape of [{ items: { data: [{ current_period_end: sec(periodEnd) }] } }, { items: { data: [{}] }, current_period_end: sec(periodEnd) }]) {
    const active = { ...trialSub('sub_1', { licenseId: 'lic-1', planType: 'annual' }), status: 'active', ...shape };
    await t.billing.syncLicenseFromSubscription(active);
    const row = t.rows.get('lic-1');
    assert.equal(row.license_type, 'annual');
    assert.equal(row.expires_at, sec(periodEnd) * 1000 + 2 * DAY);
    assert.equal(row.subscription_status, 'active');
  }
});

test('a canceled or unpaid subscription keeps what was paid and never extends; a cancel scheduled for later is shown', async () => {
  const end = Date.now() + 10 * DAY;
  const t = setup({ licenses: { 'lic-1': { license_type: 'month', expires_at: end, stripe_subscription_id: 'sub_1', subscription_plan: 'month' } } });
  const base = { ...trialSub('sub_1', { licenseId: 'lic-1', trial: '' }), items: { data: [{ current_period_end: sec(end + 30 * DAY) }] } };
  await t.billing.syncLicenseFromSubscription({ ...base, status: 'active', cancel_at_period_end: true });
  assert.equal(t.rows.get('lic-1').subscription_cancel_at, sec(end + 30 * DAY) * 1000, 'shows when it ends');
  const before = t.rows.get('lic-1').expires_at;
  for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
    await t.billing.syncLicenseFromSubscription({ ...base, status, items: { data: [{ current_period_end: sec(end + 999 * DAY) }] } });
    assert.equal(t.rows.get('lic-1').expires_at, before, status);
    assert.equal(t.rows.get('lic-1').subscription_status, status);
  }
});

test('changing plan cancels the previous subscription, and its later notices no longer touch the license', async () => {
  const t = setup({
    licenses: { 'lic-1': { license_type: 'month', expires_at: Date.now() + 20 * DAY, stripe_subscription_id: 'sub_old', subscription_plan: 'month' } },
    subs: { sub_new: { ...trialSub('sub_new', { licenseId: 'lic-1', planType: 'annual', trial: '' }), status: 'active', items: { data: [{ current_period_end: sec(Date.now() + 365 * DAY) }] } } },
  });
  const res = await t.billing.fulfillBillingSession(session({ subscription: 'sub_new', metadata: { licenseId: 'lic-1', planType: 'annual', trial: '' } }));
  assert.equal(res.status, 'approved');
  assert.deepEqual(t.events.canceled, ['sub_old']);
  assert.equal(t.rows.get('lic-1').stripe_subscription_id, 'sub_new');
  assert.equal(t.rows.get('lic-1').license_type, 'annual');
  const stale = await t.billing.syncLicenseFromSubscription({ id: 'sub_old', status: 'canceled', metadata: { licenseId: 'lic-1', planType: 'month' } });
  assert.equal(stale.reason, 'superseded');
  assert.equal(t.rows.get('lic-1').subscription_status, 'active');
});

test('upgrading charges now and adds the days left to the new plan, moving the next renewal by those days, once', async () => {
  const periodEnd = Date.now() + 365 * DAY;
  const bonus = 20 * DAY;
  const t = setup({
    licenses: { 'lic-1': { license_type: 'month', expires_at: Date.now() + bonus + 2 * DAY, stripe_subscription_id: 'sub_old', subscription_status: 'active', subscription_plan: 'month' } },
    subs: { sub_new: { ...trialSub('sub_new', { licenseId: 'lic-1', planType: 'annual', trial: '' }), status: 'active', trial_end: null, items: { data: [{ current_period_end: sec(periodEnd) }] } } },
  });
  // The days left exclude the renewal grace (it was never paid time).
  const left = t.billing.remainingPaidMs(await t.rows.get('lic-1'));
  assert.ok(Math.abs(left - bonus) < 5000, `left ${left}`);
  const updates = [];
  // Capture the subscription update through the fake Stripe client.
  const fakeUpdate = async (id, params) => { updates.push({ id, params }); Object.assign(t.subs[id], { status: 'trialing', trial_end: params.trial_end }); return structuredClone(t.subs[id]); };
  t.stripe.subscriptions.update = fakeUpdate;
  const res = await t.billing.fulfillBillingSession(session({ subscription: 'sub_new', metadata: { licenseId: 'lic-1', planType: 'annual', trial: '', bonusMs: String(bonus) } }));
  assert.equal(res.status, 'approved');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params.trial_end, Math.floor((sec(periodEnd) * 1000 + bonus) / 1000), 'next renewal moved by the days left');
  assert.equal(updates[0].params.proration_behavior, 'none');
  const row = t.rows.get('lic-1');
  assert.equal(row.license_type, 'annual', 'the plan applies right away, never a trial');
  assert.equal(row.expires_at, updates[0].params.trial_end * 1000, 'access until the new period plus the days left');
  assert.deepEqual(t.events.canceled, ['sub_old']);
  assert.equal(t.fingerprints.size, 0, 'not a free trial: the card keeps its trial');
  // The webhook and the browser both arrive: the renewal is moved only once.
  await t.billing.fulfillBillingSession(session({ subscription: 'sub_new', metadata: { licenseId: 'lic-1', planType: 'annual', trial: '', bonusMs: String(bonus) } }));
  assert.equal(updates.length, 1);
  // Nothing left (a trial, or already expired) means nothing to add.
  assert.equal(t.billing.remainingPaidMs({ license_type: 'trial', expires_at: Date.now() + 9 * DAY }), 0);
  assert.equal(t.billing.remainingPaidMs({ license_type: 'month', expires_at: Date.now() - DAY }), 0);
  assert.equal(t.billing.remainingPaidMs({ license_type: 'lifetime', expires_at: null }), 0);
});

test('the Lifetime trial saves the card, charges the one-time price on day 14 without changing the key, once', async () => {
  const t = setup({ setupIntents: { seti_1: { id: 'seti_1', status: 'succeeded', payment_method: { id: 'pm_9', card: { fingerprint: 'fp_life' } } } } });
  const s = { id: 'cs_life', status: 'complete', mode: 'setup', setup_intent: 'seti_1', customer: 'cus_9', metadata: { licenseId: 'lic-life', planType: 'lifetime', lifetimeTrial: '1', amountCents: '180000', newLicenseAlias: 'reina' } };
  assert.equal((await t.billing.fulfillBillingSession(s)).status, 'approved');
  const row = t.rows.get('lic-life');
  assert.equal(row.license_type, 'trial');
  assert.equal(row.subscription_plan, 'lifetime');
  assert.equal(row.lifetime_trial_payment_method, 'pm_9');
  assert.equal(row.lifetime_trial_amount_cents, 180000, 'the price shown when the trial started');
  assert.ok(Math.abs(row.lifetime_trial_charge_at - (Date.now() + TRIAL_DAYS * DAY)) < 5000);
  assert.equal((await t.billing.fulfillBillingSession(s)).status, 'approved', 'a repeat is harmless');
  assert.equal(t.events.created.length, 1);

  assert.deepEqual(await t.billing.chargeDueLifetimeTrials(Date.now()), [], 'nothing is due yet');
  const results = await t.billing.chargeDueLifetimeTrials(row.lifetime_trial_charge_at + 1);
  assert.deepEqual(results.map((r) => r.status), ['charged']);
  const { params, opts } = t.events.intents[0];
  assert.deepEqual([params.amount, params.currency, params.customer, params.payment_method, params.off_session, params.confirm], [180000, 'mxn', 'cus_9', 'pm_9', true, true]);
  assert.match(opts.idempotencyKey, /^lifetime-trial-lic-life-/);
  assert.deepEqual(t.events.applied, [{ licenseId: 'lic-life', planType: 'lifetime', stripePaymentId: 'pi_1', rotateKey: false }]);
  assert.equal(t.rows.get('lic-life').lifetime_trial_charge_at, null);
  assert.deepEqual(await t.billing.chargeDueLifetimeTrials(Date.now() + 100 * DAY), [], 'never charged twice');
});

test('a Lifetime trial whose card fails at the end is not retried and simply expires', async () => {
  const t = setup({ licenses: { 'lic-x': { license_type: 'trial', expires_at: Date.now(), lifetime_trial_charge_at: Date.now() - 1, lifetime_trial_amount_cents: 180000, stripe_customer_id: 'cus', lifetime_trial_payment_method: 'pm' } } });
  t.setIntentOutcome('throw');
  const results = await t.billing.chargeDueLifetimeTrials();
  assert.deepEqual(results.map((r) => r.status), ['failed']);
  assert.equal(t.rows.get('lic-x').subscription_status, 'payment_failed');
  assert.equal(t.rows.get('lic-x').lifetime_trial_charge_at, null);
  assert.equal(t.rows.get('lic-x').license_type, 'trial');
  assert.deepEqual(t.events.applied, []);
  assert.deepEqual(await t.billing.chargeDueLifetimeTrials(), []);
});

test('sessions that are not complete, or not ours, apply nothing; one-time payments are left to the usual path', async () => {
  const t = setup({ subs: { sub_1: trialSub('sub_1', { licenseId: 'lic-1' }) } });
  assert.equal((await t.billing.fulfillBillingSession(session({ status: 'open', metadata: { licenseId: 'lic-1', planType: 'month', trial: '1' } }))).status, 'pending');
  assert.equal((await t.billing.fulfillBillingSession(session({ metadata: { licenseId: 'lic-1', planType: 'lifetime' } }))).status, 'invalid');
  assert.equal(await t.billing.fulfillBillingSession({ mode: 'payment', status: 'complete', metadata: {} }), null);
  assert.equal(await t.billing.fulfillBillingSession({ mode: 'setup', status: 'complete', metadata: {} }), null, 'old 7-day trial sessions');
  assert.equal(t.rows.size, 0);
});
