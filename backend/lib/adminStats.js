// Estadísticas del negocio para el panel de admin (Licencias). Función pura
// sobre las filas de `licenses` y `payments`, para poder probarla sin DB.

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 7;
const MONTHS_SHOWN = 6;
const RECENT_PAYMENTS = 8;
// El negocio cobra en pesos mexicanos: los meses se cortan a la medianoche de
// allá, no en UTC (un pago a las 8 pm del día 31 no debe contar en el mes siguiente).
const BUSINESS_TZ = 'America/Mexico_City';

function monthKey(ms, timeZone = BUSINESS_TZ) {
    // 'en-CA' da AAAA-MM-DD; con year+month solo, AAAA-MM.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date(ms));
}

function previousMonthKey(key) {
    const [year, month] = key.split('-').map(Number);
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

// Clave de lo que se vendió en un pago: el plan, o el complemento suelto.
function paymentItem(payment) {
    if (payment.plan_type) return payment.plan_type;
    if (payment.spotify_addon) return 'spotify_addon';
    return payment.dice_tier ? `dice_${payment.dice_tier}` : 'otro';
}

function computeAdminStats(licenses, payments, now = Date.now(), timeZone = BUSINESS_TZ) {
    const isActive = (l) => !l.revoked && (l.expires_at === null || l.expires_at === undefined || Number(l.expires_at) > now);
    const customers = licenses.filter((l) => !l.is_admin);

    const byPlan = {};
    let active = 0, expired = 0, revoked = 0, spotifyAddon = 0, multiDevice = 0;
    const expiringSoon = [];
    for (const l of customers) {
        if (l.revoked) { revoked += 1; continue; }
        if (!isActive(l)) { expired += 1; continue; }
        active += 1;
        byPlan[l.license_type] = (byPlan[l.license_type] || 0) + 1;
        if (l.spotify_addon) spotifyAddon += 1;
        if (l.multi_device) multiDevice += 1;
        const expiresAt = l.expires_at === null || l.expires_at === undefined ? null : Number(l.expires_at);
        if (expiresAt !== null && expiresAt - now <= EXPIRING_WINDOW_DAYS * DAY_MS) {
            expiringSoon.push({ username: l.username, licenseType: l.license_type, expiresAt });
        }
    }
    expiringSoon.sort((a, b) => a.expiresAt - b.expiresAt);

    // Pruebas: `trial_alias` solo lo tienen las licencias nacidas como prueba
    // gratis; si hoy ya no son 'trial', el cliente pagó un plan.
    const trialsEver = customers.filter((l) => l.trial_alias);
    const converted = trialsEver.filter((l) => l.license_type !== 'trial').length;
    const trialsActive = customers.filter((l) => l.license_type === 'trial' && isActive(l)).length;

    const approved = payments.filter((p) => p.status === 'approved');
    const thisMonth = monthKey(now, timeZone);
    const lastMonth = previousMonthKey(thisMonth);
    const perMonth = new Map();
    const byItemThisMonth = {};
    let totalCents = 0;
    for (const p of approved) {
        const cents = Number(p.amount_cents) || 0;
        totalCents += cents;
        const key = monthKey(Number(p.created_at), timeZone);
        const slot = perMonth.get(key) || { cents: 0, count: 0 };
        slot.cents += cents;
        slot.count += 1;
        perMonth.set(key, slot);
        if (key === thisMonth) {
            const item = paymentItem(p);
            byItemThisMonth[item] = (byItemThisMonth[item] || 0) + cents;
        }
    }
    const months = [];
    let cursor = thisMonth;
    for (let i = 0; i < MONTHS_SHOWN; i++) {
        const slot = perMonth.get(cursor) || { cents: 0, count: 0 };
        months.unshift({ key: cursor, cents: slot.cents, count: slot.count });
        cursor = previousMonthKey(cursor);
    }

    const names = new Map(licenses.map((l) => [l.id, l.username]));
    const recent = [...approved]
        .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        .slice(0, RECENT_PAYMENTS)
        .map((p) => ({
            username: names.get(p.license_id) || '—',
            item: paymentItem(p),
            amountCents: Number(p.amount_cents) || 0,
            provider: p.provider || (p.stripe_payment_id ? 'stripe' : 'mp'),
            createdAt: Number(p.created_at),
        }));

    return {
        generatedAt: now,
        licenses: {
            total: customers.length, active, expired, revoked, byPlan, spotifyAddon, multiDevice,
            expiringSoon: expiringSoon.slice(0, 10), expiringSoonCount: expiringSoon.length,
            expiringWindowDays: EXPIRING_WINDOW_DAYS,
        },
        trials: {
            total: trialsEver.length, active: trialsActive, converted,
            conversionRate: trialsEver.length > 0 ? converted / trialsEver.length : null,
        },
        revenue: {
            currency: 'MXN',
            thisMonthCents: perMonth.get(thisMonth)?.cents || 0,
            thisMonthCount: perMonth.get(thisMonth)?.count || 0,
            lastMonthCents: perMonth.get(lastMonth)?.cents || 0,
            totalCents, paymentsCount: approved.length,
            months, byItemThisMonth, recent,
        },
    };
}

module.exports = { computeAdminStats, monthKey, previousMonthKey, paymentItem, BUSINESS_TZ };
