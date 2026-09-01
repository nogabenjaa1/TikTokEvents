// ==========================================
// PRECIOS: única fuente de verdad para lo que se cobra por MercadoPago.
// El cliente manda SOLO qué plan/addon quiere (planType/diceTier); el monto
// se resuelve siempre acá — nunca se confía en un precio que mande el front.
// Montos en centavos de MXN (moneda de la cuenta de MercadoPago del dueño
// del producto). El USD que se muestra en la UI es solo referencia visual,
// no se cobra en esa moneda.
// ==========================================
const PLAN_PRICES_CENTS = {
    month: 12600,    // $126 MXN — US$6.99/mes
    annual: 108000,  // $1,080 MXN — US$59.99/año
    lifetime: 180000, // $1,800 MXN — US$99.99 único
};

// Ranking para no degradar un nivel ya comprado (ver applyPurchase en
// server.js): 'admin' no se vende, solo lo asigna el panel de licencias.
const DICE_TIER_PRICES_CENTS = {
    pro: 1800, // +$18 MXN — US$1
    vip: 5400, // +$54 MXN — US$3
};
const DICE_TIER_RANK = { regular: 0, pro: 1, vip: 2, admin: 3 };

function isValidPlan(planType) {
    return Object.prototype.hasOwnProperty.call(PLAN_PRICES_CENTS, planType);
}

function isValidAddon(diceTier) {
    return Object.prototype.hasOwnProperty.call(DICE_TIER_PRICES_CENTS, diceTier);
}

// planType y/o diceTier — al menos uno de los dos, validado por el caller.
function computeAmountCents({ planType, diceTier }) {
    let total = 0;
    if (planType) total += PLAN_PRICES_CENTS[planType] || 0;
    if (diceTier) total += DICE_TIER_PRICES_CENTS[diceTier] || 0;
    return total;
}

module.exports = {
    PLAN_PRICES_CENTS, DICE_TIER_PRICES_CENTS, DICE_TIER_RANK,
    isValidPlan, isValidAddon, computeAmountCents,
};
