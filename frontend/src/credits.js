// Recarga de créditos: lo mismo que backend/lib/credits.js, solo para la vista
// previa. El servidor vuelve a calcular los créditos con lo que Stripe cobró;
// esto nunca decide cuántos se suman.
export const CREDITS_PER_USD = 20; // US$5 = 100 créditos
export const MIN_TOPUP_USD_CENTS = 100; // US$1
export const MAX_TOPUP_USD_CENTS = 50000; // US$500
export const TOPUP_PRESETS_USD = [3, 5, 10, 20];

export function creditsForUsdCents(usdCents) {
  return Math.round((Number(usdCents) * CREDITS_PER_USD) / 100);
}

// Lo que escribe el comprador ("3", "3.5", "3,50", "$10") a centavos de dólar.
// Devuelve null si no es un monto con hasta dos decimales.
export function parseUsdInput(text) {
  const clean = String(text ?? '').trim().replace(/^(us)?\$\s*/i, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// El error que se le muestra al comprador, o '' si el monto se puede cobrar.
export function topupAmountError(usdCents) {
  if (usdCents === null) return 'Escribe un monto en dólares, por ejemplo 3 o 7.50.';
  if (usdCents < MIN_TOPUP_USD_CENTS) return `El mínimo es ${formatUsd(MIN_TOPUP_USD_CENTS)}.`;
  if (usdCents > MAX_TOPUP_USD_CENTS) return `El máximo por recarga es ${formatUsd(MAX_TOPUP_USD_CENTS)}.`;
  return '';
}

export function formatUsd(usdCents) {
  const dollars = usdCents / 100;
  return `US$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export function formatCredits(credits) {
  return Number(credits || 0).toLocaleString('es-MX');
}
