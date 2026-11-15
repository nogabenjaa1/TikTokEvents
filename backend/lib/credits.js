// Recarga de créditos: pago único (no membresía) por un monto libre en dólares.
//
// - Se cobra en USD. Stripe convierte solo a la moneda en que la cuenta recibe
//   los pagos (MXN), así que el comprador ve y paga dólares y a la cuenta le
//   llegan pesos; la comisión de conversión la cobra Stripe.
// - 5 dólares = 100 créditos (20 por dólar). Cualquier monto vale (3 dólares,
//   7.50...) y los créditos se redondean al entero más cercano.
// - Los créditos SIEMPRE se calculan aquí, en el servidor, con el monto que
//   Stripe cobró; nunca se cree un número de créditos que mande el navegador.
// - Por ahora solo se recargan y se ven en Membresía; gastarlos vendrá después.

const CREDITS_PER_USD = 20;
// US$1: por encima del mínimo de Stripe (US$0.50, y su equivalente a MX$10
// para una cuenta que recibe en pesos) y de lo que se come la comisión fija.
const MIN_TOPUP_USD_CENTS = 100;
const MAX_TOPUP_USD_CENTS = 50000; // US$500 por recarga
const TOPUP_CURRENCY = 'usd';

function creditsForUsdCents(usdCents) {
    return Math.round((Number(usdCents) * CREDITS_PER_USD) / 100);
}

// El monto que manda el navegador, en centavos de dólar. Devuelve el entero
// válido o null. Acepta solo enteros (el front ya convierte "3.50" a 350).
function parseTopupUsdCents(value) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < MIN_TOPUP_USD_CENTS || value > MAX_TOPUP_USD_CENTS) return null;
    return value;
}

function formatUsd(usdCents) {
    const dollars = usdCents / 100;
    return `US$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

module.exports = {
    CREDITS_PER_USD, MIN_TOPUP_USD_CENTS, MAX_TOPUP_USD_CENTS, TOPUP_CURRENCY,
    creditsForUsdCents, parseTopupUsdCents, formatUsd,
};
