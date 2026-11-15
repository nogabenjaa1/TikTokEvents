// Recarga de créditos: lo mismo que backend/lib/credits.js, solo para la vista
// previa. Se cobra siempre en pesos; el comprador elige si escribe el monto en
// pesos (lo predeterminado) o en dólares, y ve la otra moneda como referencia.
// El servidor vuelve a calcular los créditos con lo que Stripe cobró; esto
// nunca decide cuántos se suman.
export const CREDITS_PER_USD = 20; // US$5 = 100 créditos
export const DEFAULT_MXN_CENTS_PER_USD = 1800; // respaldo si /api/pricing no llega
const MIN_TOPUP_USD_CENTS = 100; // US$1
const MAX_TOPUP_USD_CENTS = 50000; // US$500
const STRIPE_MIN_MXN_CENTS = 1000; // MX$10
// Montos rápidos: los mismos en las dos monedas (en pesos, convertidos con el
// tipo de cambio vigente y redondeados al peso) para que den créditos redondos.
const TOPUP_PRESETS_USD = [3, 5, 10, 20];
export function topupPresets(currency, rate) {
  return TOPUP_PRESETS_USD.map((usd) => (currency === 'usd' ? usd : Math.round((usd * rate) / 100)));
}
export const CURRENCY_STORAGE_KEY = 'tkc-credits-currency';

export function creditsForMxnCents(mxnCents, rate) {
  return Math.round((Number(mxnCents) * CREDITS_PER_USD) / rate);
}

export function toMxnCents(amountCents, currency, rate) {
  return currency === 'usd' ? Math.round((amountCents * rate) / 100) : amountCents;
}

export function fromMxnCents(mxnCents, currency, rate) {
  return currency === 'usd' ? Math.round((mxnCents * 100) / rate) : mxnCents;
}

export function topupLimitsMxnCents(rate) {
  return {
    min: Math.max(STRIPE_MIN_MXN_CENTS, Math.round((MIN_TOPUP_USD_CENTS * rate) / 100)),
    max: Math.round((MAX_TOPUP_USD_CENTS * rate) / 100),
  };
}

// Lo que escribe el comprador ("3", "3.5", "3,50", "$10") a centavos.
// Devuelve null si no es un monto con hasta dos decimales.
export function parseAmountInput(text) {
  const clean = String(text ?? '').trim().replace(/^(us|mx)?\$\s*/i, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatMoney(cents, currency) {
  const value = cents / 100;
  const text = Number.isInteger(value)
    ? value.toLocaleString('es-MX')
    : value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency === 'usd' ? 'US$' : 'MX$'}${text}`;
}

// El error que se le muestra al comprador, o '' si el monto se puede cobrar.
// Los límites se dicen en la moneda que eligió.
export function topupAmountError(amountCents, currency, rate) {
  if (amountCents === null || amountCents <= 0) return `Escribe un monto, por ejemplo ${currency === 'usd' ? '3 o 7.50' : '100 o 250'}.`;
  const mxnCents = toMxnCents(amountCents, currency, rate);
  const { min, max } = topupLimitsMxnCents(rate);
  if (mxnCents < min) return `El mínimo es ${formatMoney(Math.ceil(fromMxnCents(min, currency, rate)), currency)}.`;
  if (mxnCents > max) return `El máximo por recarga es ${formatMoney(Math.floor(fromMxnCents(max, currency, rate)), currency)}.`;
  return '';
}

// Para pasar el monto escrito a la otra moneda al cambiar el selector.
export function convertInput(text, from, to, rate) {
  const cents = parseAmountInput(text);
  if (cents === null || from === to) return text;
  const converted = fromMxnCents(toMxnCents(cents, from, rate), to, rate);
  const value = converted / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatCredits(credits) {
  return Number(credits || 0).toLocaleString('es-MX');
}
