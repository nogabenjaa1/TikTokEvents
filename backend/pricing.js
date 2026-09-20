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

// Complemento de Spotify: pago unico para las licencias Mensual (Anual y
// Lifetime ya lo incluyen, ver spotify.js). Vive APARTE de PLAN_PRICES_CENTS
// a proposito: no es un plan (no cambia license_type ni vence), asi que
// nunca debe pasar por isValidPlan -- de lo contrario un `planType:
// 'spotify_addon'` mandado al checkout dejaria una licencia con un tipo que
// no existe. PRECIO INICIAL, todavia sin definir por el dueño: se edita
// desde el panel de Licencias como los demas (queda en pricing_overrides
// bajo esta clave) sin tocar codigo ni redeployar.
const SPOTIFY_ADDON_KEY = 'spotify_addon';
const SPOTIFY_ADDON_DEFAULT_PRICE_CENTS = 18000; // $180 MXN -- US$10 aprox.

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

// Precio vigente del complemento de Spotify (override del admin si existe,
// default de arriba si no) -- mismo criterio que getPlanPriceCents.
function getSpotifyAddonPriceCents() {
    if (Object.prototype.hasOwnProperty.call(planPriceOverridesCents, SPOTIFY_ADDON_KEY)) {
        return planPriceOverridesCents[SPOTIFY_ADDON_KEY];
    }
    return SPOTIFY_ADDON_DEFAULT_PRICE_CENTS;
}

// Guarda un override (plan o complemento) -- una sola validacion de monto y
// un solo lugar que actualiza la copia en memoria, para los dos casos.
async function saveOverride(key, amountCents, updatedBy) {
    if (!Number.isInteger(amountCents) || amountCents < MIN_PLAN_PRICE_CENTS) {
        throw new Error(`El precio mínimo es de $${(MIN_PLAN_PRICE_CENTS / 100).toFixed(2)} MXN`);
    }
    const { oldAmountCents } = await db.setPricingOverride(key, amountCents, updatedBy);
    planPriceOverridesCents[key] = amountCents;
    return { oldAmountCents, newAmountCents: amountCents };
}

async function setPlanPriceCents(planType, amountCents, updatedBy) {
    if (!isValidPlan(planType)) throw new Error('Plan inválido');
    return saveOverride(planType, amountCents, updatedBy);
}

async function setSpotifyAddonPriceCents(amountCents, updatedBy) {
    return saveOverride(SPOTIFY_ADDON_KEY, amountCents, updatedBy);
}

function isValidPlan(planType) {
    return Object.prototype.hasOwnProperty.call(PLAN_PRICES_CENTS, planType);
}

function isValidAddon(diceTier) {
    return Object.prototype.hasOwnProperty.call(DICE_TIER_PRICES_CENTS, diceTier);
}

// planType, diceTier y/o spotifyAddon -- al menos uno de los tres, validado
// por el caller.
function computeAmountCents({ planType, diceTier, spotifyAddon }) {
    let total = 0;
    if (planType) total += getPlanPriceCents(planType);
    if (diceTier) total += DICE_TIER_PRICES_CENTS[diceTier] || 0;
    if (spotifyAddon) total += getSpotifyAddonPriceCents();
    return total;
}

module.exports = {
    PLAN_PRICES_CENTS, DICE_TIER_PRICES_CENTS, DICE_TIER_RANK, MIN_PLAN_PRICE_CENTS, SPOTIFY_ADDON_KEY,
    isValidPlan, isValidAddon, computeAmountCents,
    loadPriceOverrides, getPlanPriceCents, getAllPlanPricesCents, setPlanPriceCents,
    getSpotifyAddonPriceCents, setSpotifyAddonPriceCents,
};
