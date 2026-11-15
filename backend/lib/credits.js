// Recarga de créditos: pago único (no membresía) por un monto libre.
//
// - Se cobra SIEMPRE en pesos (MXN), la moneda de la cuenta de Stripe: sin la
//   comisión de conversión de Stripe y con el mismo cliente que las
//   suscripciones (que también son en pesos), así sus tarjetas guardadas salen.
// - El comprador elige ver y escribir el monto en pesos (lo predeterminado) o
//   en dólares; el dólar se convierte a pesos con el tipo de cambio del panel
//   de Licencias (pricing.getMxnCentsPerUsd). Lo que viaja a Stripe son pesos.
// - 5 dólares = 100 créditos (20 por dólar). En pesos, los créditos salen del
//   monto cobrado entre el tipo de cambio de ese momento, redondeados al
//   entero más cercano.
// - Los créditos SIEMPRE se calculan aquí, en el servidor, con el monto que
//   Stripe cobró; nunca se cree un número de créditos que mande el navegador.
// - Por ahora solo se recargan y se ven en Membresía; gastarlos vendrá después.

const CREDITS_PER_USD = 20;
const DEFAULT_MXN_CENTS_PER_USD = 1800; // MX$18 por dólar, igual que los planes
// Límites del tipo de cambio que se acepta del panel (MX$5 a MX$50 por dólar):
// un error de dedo no puede regalar ni encarecer los créditos 100 veces.
const MIN_MXN_CENTS_PER_USD = 500;
const MAX_MXN_CENTS_PER_USD = 5000;
// US$1 a US$500 por recarga, medidos en pesos con el tipo de cambio vigente.
const MIN_TOPUP_USD_CENTS = 100;
const MAX_TOPUP_USD_CENTS = 50000;
// Mínimo de Stripe para un cobro en pesos.
const STRIPE_MIN_MXN_CENTS = 1000;
const TOPUP_CURRENCY = 'mxn';
const INPUT_CURRENCIES = ['mxn', 'usd'];

function isValidRate(mxnCentsPerUsd) {
    return Number.isInteger(mxnCentsPerUsd) && mxnCentsPerUsd >= MIN_MXN_CENTS_PER_USD && mxnCentsPerUsd <= MAX_MXN_CENTS_PER_USD;
}

function creditsForMxnCents(mxnCents, mxnCentsPerUsd) {
    return Math.round((Number(mxnCents) * CREDITS_PER_USD) / mxnCentsPerUsd);
}

function usdCentsForMxnCents(mxnCents, mxnCentsPerUsd) {
    return Math.round((Number(mxnCents) * 100) / mxnCentsPerUsd);
}

function mxnCentsForUsdCents(usdCents, mxnCentsPerUsd) {
    return Math.round((Number(usdCents) * mxnCentsPerUsd) / 100);
}

function topupLimitsMxnCents(mxnCentsPerUsd) {
    return {
        min: Math.max(STRIPE_MIN_MXN_CENTS, mxnCentsForUsdCents(MIN_TOPUP_USD_CENTS, mxnCentsPerUsd)),
        max: mxnCentsForUsdCents(MAX_TOPUP_USD_CENTS, mxnCentsPerUsd),
    };
}

// Lo que manda el navegador ({ amountCents, currency }) a los pesos que se
// cobran. Devuelve el entero en centavos de MXN, o null si no es válido.
function parseTopup({ amountCents, currency } = {}, mxnCentsPerUsd) {
    if (!INPUT_CURRENCIES.includes(currency)) return null;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) return null;
    const mxnCents = currency === 'usd' ? mxnCentsForUsdCents(amountCents, mxnCentsPerUsd) : amountCents;
    const { min, max } = topupLimitsMxnCents(mxnCentsPerUsd);
    if (mxnCents < min || mxnCents > max) return null;
    return mxnCents;
}

function formatMxn(mxnCents) {
    const pesos = mxnCents / 100;
    return `MX$${Number.isInteger(pesos) ? pesos.toLocaleString('es-MX') : pesos.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsd(usdCents) {
    const dollars = usdCents / 100;
    return `US$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

module.exports = {
    CREDITS_PER_USD, DEFAULT_MXN_CENTS_PER_USD, MIN_MXN_CENTS_PER_USD, MAX_MXN_CENTS_PER_USD,
    MIN_TOPUP_USD_CENTS, MAX_TOPUP_USD_CENTS, STRIPE_MIN_MXN_CENTS, TOPUP_CURRENCY, INPUT_CURRENCIES,
    isValidRate, creditsForMxnCents, usdCentsForMxnCents, mxnCentsForUsdCents, topupLimitsMxnCents, parseTopup,
    formatMxn, formatUsd,
};
