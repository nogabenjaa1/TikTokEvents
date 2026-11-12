// Suscripciones y prueba de 14 días con Stripe (pedido del dueño):
// - Mensual y Anual son suscripciones: Stripe cobra solo cada mes o cada año.
//   Se pueden comprar al momento o con 14 días gratis; al terminar la prueba,
//   Stripe cobra la tarjeta (salvo que se cancele antes desde el portal).
// - Lifetime sigue siendo un pago único. Su prueba de 14 días guarda la tarjeta
//   (Checkout en modo setup) y al día 14 este módulo cobra el pago único con
//   esa tarjeta (chargeDueLifetimeTrials).
// - Una prueba por tarjeta física (huella de Stripe, tabla trial_fingerprints):
//   si la tarjeta ya tuvo prueba, la suscripción se cancela al instante sin
//   cobrar nada y no se da la prueba.
// - Durante la prueba la licencia es de tipo 'trial' (sin Spotify de la
//   plataforma, como cualquier prueba); al cobrarse pasa al plan.
//
// Todo lo que viene de Stripe se vuelve a pedir a Stripe (nunca se cree lo que
// diga el navegador ni el cuerpo de un webhook): las funciones reciben ids o la
// sesión ya pedida por el servidor.

const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
// Margen tras el fin del periodo: si el cobro de la renovación falla, Stripe
// reintenta unos días; la licencia no se corta en el primer intento.
const RENEWAL_GRACE_MS = 2 * DAY_MS;
const SUBSCRIPTION_PLANS = ['month', 'annual'];

function createStripeBilling(deps) {
    const { db, auth, pricing, getStripeClient, apiVersion, storedKeyFields, planKeyLabels, pushLicenseState, applyApprovedStripePaymentIfNew, log = console } = deps;

    const subscriptionId = (value) => (typeof value === 'string' ? value : value?.id) || null;

    // El fin del periodo actual: en las versiones nuevas de la API vive en cada
    // renglón de la suscripción; en las anteriores, en la suscripción.
    function periodEndMs(sub) {
        const end = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end;
        return end ? end * 1000 : null;
    }

    // Crea la licencia de una compra sin cuenta con el id que se reservó al
    // crear la sesión. Si ya existe (el webhook y el navegador llegaron casi
    // juntos), no hace nada.
    async function ensureGuestLicense({ licenseId, alias, planType, licenseType, expiresAt }) {
        if (await db.findCoreById(licenseId)) return false;
        const key = auth.generateLabeledKey(alias, planKeyLabels[planType] || planType);
        try {
            await db.insertLicense({
                id: licenseId, ...storedKeyFields(key), pendingKeyReveal: key,
                username: alias, licenseType, isAdmin: false, createdAt: Date.now(), expiresAt,
            });
        } catch (err) {
            if (err.code === '23505' && (await db.findCoreById(licenseId))) return false;
            throw err;
        }
        log.log(`[Stripe] ✅ Licencia nueva — ${licenseId} (@${alias}, ${licenseType})`);
        return true;
    }

    // Pasa el estado de una suscripción de Stripe a su licencia.
    async function syncLicenseFromSubscription(sub) {
        const meta = sub?.metadata || {};
        let license = meta.licenseId ? await db.findCoreById(meta.licenseId) : null;
        if (!license) license = await db.findByStripeSubscriptionId(sub.id);
        if (!license) return { synced: false, reason: 'license_missing' };
        // Una suscripción anterior de la licencia (se cambió de plan): sus avisos
        // ya no mandan.
        if (license.stripe_subscription_id && license.stripe_subscription_id !== sub.id) return { synced: false, reason: 'superseded' };
        const planType = SUBSCRIPTION_PLANS.includes(meta.planType) ? meta.planType : license.subscription_plan;
        const isTrial = meta.trial === '1';
        const fields = {
            stripeSubscriptionId: sub.id,
            stripeCustomerId: subscriptionId(sub.customer) || undefined,
            subscriptionStatus: sub.status,
            subscriptionPlan: planType,
            subscriptionCancelAt: sub.cancel_at ? sub.cancel_at * 1000 : (sub.cancel_at_period_end ? periodEndMs(sub) : null),
        };
        const current = Number(license.expires_at) || 0;
        if (sub.status === 'trialing') {
            // Prueba pedida: tipo 'trial' hasta que se cobre. Un trial_end puesto
            // para respetar el tiempo que ya tenía pagado sigue siendo su plan.
            fields.licenseType = isTrial ? 'trial' : planType;
            fields.expiresAt = Math.max(current, (sub.trial_end || 0) * 1000);
        } else if (sub.status === 'active' || sub.status === 'past_due') {
            fields.licenseType = planType;
            const end = periodEndMs(sub);
            if (end) fields.expiresAt = Math.max(current, end + RENEWAL_GRACE_MS);
        }
        // canceled / unpaid / incomplete_expired: la licencia conserva lo que
        // ya tenía pagado y vence sola; solo se guarda el estado.
        await db.applyBillingState(license.id, fields);
        pushLicenseState?.(license.id);
        return { synced: true, licenseId: license.id, status: sub.status };
    }

    // Reserva la prueba de la tarjeta; false si esa tarjeta ya tuvo prueba.
    async function claimTrial(fingerprint, licenseId) {
        if (!fingerprint) return false;
        return db.claimTrialFingerprint(fingerprint, licenseId);
    }

    // Cierra la suscripción anterior de una licencia que cambió de plan (o pasó
    // a Lifetime). Sin cobro ni reembolso: el tiempo pagado se conserva en la
    // licencia.
    async function cancelPreviousSubscription(stripe, license, keepId) {
        const previous = license?.stripe_subscription_id;
        if (!previous || previous === keepId) return;
        try {
            await stripe.subscriptions.cancel(previous, {}, { apiVersion });
            log.log(`[Stripe] Suscripción anterior ${previous} cancelada (licencia ${license.id} cambió de plan).`);
        } catch (err) {
            log.error(`[Stripe] No se pudo cancelar la suscripción anterior ${previous}:`, err.message);
        }
    }

    // Una sesión de Checkout en modo 'subscription' ya completada.
    async function fulfillSubscriptionSession(session) {
        if (session.status !== 'complete') return { status: 'pending' };
        const meta = session.metadata || {};
        const { licenseId, planType } = meta;
        const subId = subscriptionId(session.subscription);
        if (!licenseId || !SUBSCRIPTION_PLANS.includes(planType) || !subId) return { status: 'invalid' };
        const stripe = getStripeClient();
        const sub = await stripe.subscriptions.retrieve(subId, { expand: ['default_payment_method'] }, { apiVersion });
        if (meta.trial === '1' && sub.status === 'trialing') {
            const fingerprint = sub.default_payment_method?.card?.fingerprint;
            if (!(await claimTrial(fingerprint, licenseId))) {
                // Esa tarjeta ya tuvo su prueba: se cancela antes de cobrar nada.
                await stripe.subscriptions.cancel(subId, {}, { apiVersion });
                log.log(`[Stripe] Prueba rechazada: la tarjeta ya se usó en otra prueba (sesión ${session.id}).`);
                return { status: 'trial_used' };
            }
        }
        if (meta.newLicenseAlias) {
            // Nace con el vencimiento que dice Stripe (fin de la prueba o del
            // periodo); syncLicenseFromSubscription lo deja igual.
            const firstEnd = sub.status === 'trialing' ? (sub.trial_end || 0) * 1000 : (periodEndMs(sub) || Date.now()) + RENEWAL_GRACE_MS;
            await ensureGuestLicense({ licenseId, alias: meta.newLicenseAlias, planType, licenseType: meta.trial === '1' && sub.status === 'trialing' ? 'trial' : planType, expiresAt: firstEnd });
        }
        const license = await db.findCoreById(licenseId);
        if (!license) return { status: 'invalid' };
        await cancelPreviousSubscription(stripe, license, subId);
        // Si tenía una prueba de Lifetime en curso, la reemplaza esta compra.
        await db.applyBillingState(licenseId, { stripeSubscriptionId: subId, lifetimeTrialChargeAt: null });
        await syncLicenseFromSubscription(sub);
        return { status: 'approved', licenseId };
    }

    // Una sesión de Checkout en modo 'setup' de la prueba de Lifetime.
    async function fulfillLifetimeTrialSession(session) {
        if (session.status !== 'complete') return { status: 'pending' };
        const meta = session.metadata || {};
        const { licenseId } = meta;
        if (!licenseId || meta.lifetimeTrial !== '1') return { status: 'invalid' };
        const stripe = getStripeClient();
        const setupIntentId = subscriptionId(session.setup_intent);
        const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] }, { apiVersion });
        if (intent.status !== 'succeeded') return { status: 'pending' };
        const existing = await db.findCoreById(licenseId);
        // Ya se procesó (el webhook y el navegador llegaron los dos).
        if (existing?.lifetime_trial_payment_method === intent.payment_method?.id) return { status: 'approved', licenseId };
        if (!(await claimTrial(intent.payment_method?.card?.fingerprint, licenseId))) return { status: 'trial_used' };
        const chargeAt = Date.now() + TRIAL_DAYS * DAY_MS;
        if (meta.newLicenseAlias) {
            await ensureGuestLicense({ licenseId, alias: meta.newLicenseAlias, planType: 'lifetime', licenseType: 'trial', expiresAt: chargeAt });
        }
        const license = await db.findCoreById(licenseId);
        if (!license) return { status: 'invalid' };
        await db.applyBillingState(licenseId, {
            licenseType: 'trial',
            expiresAt: Math.max(Number(license.expires_at) || 0, chargeAt),
            stripeCustomerId: subscriptionId(session.customer) || undefined,
            subscriptionStatus: 'trialing',
            subscriptionPlan: 'lifetime',
            subscriptionCancelAt: null,
            lifetimeTrialChargeAt: chargeAt,
            lifetimeTrialAmountCents: Number(meta.amountCents) || pricing.getPlanPriceCents('lifetime'),
            lifetimeTrialPaymentMethod: intent.payment_method?.id,
        });
        pushLicenseState?.(licenseId);
        return { status: 'approved', licenseId };
    }

    // Cualquier sesión de Checkout ya pedida a Stripe que sea de suscripción o
    // de prueba de Lifetime. null si es de otro tipo (pago único: lo atiende el
    // camino de siempre).
    async function fulfillBillingSession(session) {
        if (session.mode === 'subscription') return fulfillSubscriptionSession(session);
        if (session.mode === 'setup' && session.metadata?.lifetimeTrial === '1') return fulfillLifetimeTrialSession(session);
        return null;
    }

    // Cobra el pago único de las pruebas de Lifetime que ya terminaron.
    async function chargeDueLifetimeTrials(now = Date.now()) {
        const due = await db.listDueLifetimeTrials(now);
        const results = [];
        for (const license of due) {
            // Se apaga ANTES de cobrar: si el proceso se cae a la mitad, nunca se
            // cobra dos veces (la clave de idempotencia de Stripe cubre el resto).
            await db.applyBillingState(license.id, { lifetimeTrialChargeAt: null });
            const amount = Number(license.lifetime_trial_amount_cents) || pricing.getPlanPriceCents('lifetime');
            try {
                const stripe = getStripeClient();
                const intent = await stripe.paymentIntents.create({
                    amount, currency: 'mxn',
                    customer: license.stripe_customer_id,
                    payment_method: license.lifetime_trial_payment_method,
                    off_session: true, confirm: true,
                    description: 'BenjaApis - Lifetime (fin de la prueba de 14 días)',
                    metadata: { licenseId: license.id, planType: 'lifetime', diceTier: '', spotifyAddon: '', lifetimeTrial: '1' },
                }, { apiVersion, idempotencyKey: `lifetime-trial-${license.id}-${license.lifetime_trial_charge_at}` });
                if (intent.status === 'succeeded') {
                    await db.applyBillingState(license.id, { subscriptionStatus: 'active', subscriptionCancelAt: null, lifetimeTrialPaymentMethod: null });
                    await applyApprovedStripePaymentIfNew({ licenseId: license.id, planType: 'lifetime', stripePaymentId: intent.id, rotateKey: false });
                    results.push({ licenseId: license.id, status: 'charged' });
                } else {
                    await db.applyBillingState(license.id, { subscriptionStatus: 'payment_failed' });
                    results.push({ licenseId: license.id, status: intent.status });
                }
            } catch (err) {
                // Tarjeta rechazada o que pide autenticarse: no se reintenta; la
                // prueba vence sola y puede comprar Lifetime desde Membresía.
                log.error(`[Stripe] No se pudo cobrar el fin de la prueba de Lifetime (licencia ${license.id}):`, err.message);
                await db.applyBillingState(license.id, { subscriptionStatus: 'payment_failed' });
                pushLicenseState?.(license.id);
                results.push({ licenseId: license.id, status: 'failed' });
            }
        }
        return results;
    }

    return { TRIAL_DAYS, SUBSCRIPTION_PLANS, periodEndMs, syncLicenseFromSubscription, fulfillBillingSession, fulfillSubscriptionSession, fulfillLifetimeTrialSession, chargeDueLifetimeTrials, cancelPreviousSubscription, subscriptionId };
}

module.exports = { createStripeBilling, TRIAL_DAYS, SUBSCRIPTION_PLANS };
