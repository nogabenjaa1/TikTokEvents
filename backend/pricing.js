// ==========================================
// PRECIOS: unica fuente de verdad para lo que se cobra por MercadoPago.
// El cliente manda SOLO que plan/addon quiere (planType/diceTier); el monto
// se resuelve siempre aca -- nunca se confia en un precio que mande el front.
// Montos en centavos de MXN (moneda de la cuenta de MercadoPago del dueño
// del producto). El USD que se muestra en la UI es solo referencia visual,
// no se cobra en esa moneda.
// ==========================================
const db = require('./db');

const PLAN_PRICES_CENTS = {
    month: 12600,    // $126 MXN -- US$6.99/mes
    annual: 108000,  // $1,080 MXN -- US$59.99/año
    lifetime: 180000, // $1,800 MXN -- US$99.99 unico
};

// Ranking para no degradar un nivel ya comprado (ver applyPurchase en
// server.js): 'admin' no se vende, solo lo asigna el panel de licencias.
const DICE_TIER_PRICES_CENTS = {
    pro: 1800, // +$18 MXN -- US$1
    vip: 5400, // +$54 MXN -- US$3
};
const DICE_TIER_RANK = { regular: 0, pro: 1, vip: 2, admin: 3 };

const MIN_PLAN_PRICE_CENTS = 100; // 1 peso MXN, pedido explicito como piso

// Overrides cargados de pricing_overrides (Supabase) -- pedido explicito
// ("Modificacion manual de precios de licencias desde el panel de
// administracion"): un admin puede pisar cualquiera de los tres precios de
// PLAN_PRICES_CENTS de arriba sin tocar codigo ni redeployar. Vive en
// memoria (se recarga una vez al arrancar el proceso, ver loadPriceOverrides
// llamado desde server.js) y se actualiza en el momento en el mismo tick que
// se guarda en la DB (ver setPlanPriceCents) -- asi computeAmountCents/
// getPlanPriceCents reflejan el cambio de inmediato para la SIGUIENTE
// preferencia de pago que se cree, sin esperar ningun refresh ni reinicio.
// Los addons de Color Says (DICE_TIER_PRICES_CENTS) quedan afuera a
// proposito: el pedido fue puntual sobre Mensual/Anual/Lifetime.
let planPriceOverridesCents = {};

async function loadPriceOverrides() {
    planPriceOverridesCents = await db.getPricingOverrides();
}

function getPlanPriceCents(planType) {
    if (Object.prototype.hasOwnProperty.call(planPriceOverridesCents, planType)) {
        return planPriceOverridesCents[planType];
    }
    return PLAN_PRICES_CENTS[planType] || 0;
}

// Precio vigente de los tres planes (override si existe, default si no) --
// lo consumen tanto GET /api/pricing (vitrina publica) como el panel de
// Licencias para precargar los inputs de edicion.
function getAllPlanPricesCents() {
    const result = {};
    Object.keys(PLAN_PRICES_CENTS).forEach((planType) => {
        result[planType] = getPlanPriceCents(planType);
    });
    return result;
}

async function setPlanPriceCents(planType, amountCents, updatedBy) {
    if (!isValidPlan(planType)) throw new Error('Plan inválido');
    if (!Number.isInteger(amountCents) || amountCents < MIN_PLAN_PRICE_CENTS) {
        throw new Error(`El precio mínimo es de $${(MIN_PLAN_PRICE_CENTS / 100).toFixed(2)} MXN`);
    }
    const { oldAmountCents } = await db.setPricingOverride(planType, amountCents, updatedBy);
    planPriceOverridesCents[planType] = amountCents;
    return { oldAmountCents, newAmountCents: amountCents };
}

function isValidPlan(planType) {
    return Object.prototype.hasOwnProperty.call(PLAN_PRICES_CENTS, planType);
}

function isValidAddon(diceTier) {
    return Object.prototype.hasOwnProperty.call(DICE_TIER_PRICES_CENTS, diceTier);
}

// planType y/o diceTier -- al menos uno de los dos, validado por el caller.
function computeAmountCents({ planType, diceTier }) {
    let total = 0;
    if (planType) total += getPlanPriceCents(planType);
    if (diceTier) total += DICE_TIER_PRICES_CENTS[diceTier] || 0;
    return total;
}

module.exports = {
    PLAN_PRICES_CENTS, DICE_TIER_PRICES_CENTS, DICE_TIER_RANK, MIN_PLAN_PRICE_CENTS,
    isValidPlan, isValidAddon, computeAmountCents,
    loadPriceOverrides, getPlanPriceCents, getAllPlanPricesCents, setPlanPriceCents,
};
