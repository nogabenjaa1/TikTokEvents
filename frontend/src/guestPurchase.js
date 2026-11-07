// Compra de un plan sin cuenta (Membresía con solo un alias). La licencia no
// existe hasta que Stripe confirma el cobro (ver backend/server.js,
// /api/payments/stripe/guest-checkout-session): para recoger la clave, este
// navegador guarda el id de la sesión de pago y el `claimToken` que devolvió el
// backend. Si la pestaña se cierra justo después de pagar (o el banco saca al
// comprador del sitio), al volver a Membresía se reclama desde aquí.

const STORAGE_KEY = 'tkc_guest_purchase';
// Una sesión de Stripe vence a las 24 h; dos días deja margen para un pago que
// se confirme tarde, sin guardar el dato para siempre.
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

function storage(override) {
  if (override) return override;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function savePendingGuestPurchase({ checkoutSessionId, claimToken, alias, planType }, store, now = Date.now()) {
  try {
    storage(store)?.setItem(STORAGE_KEY, JSON.stringify({ checkoutSessionId, claimToken, alias, planType, savedAt: now }));
  } catch {
    // Sin almacenamiento (modo privado): solo se pierde la recuperación si se cierra la pestaña.
  }
}

export function loadPendingGuestPurchase(store, now = Date.now()) {
  try {
    const raw = storage(store)?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const valid = data && typeof data.checkoutSessionId === 'string' && typeof data.claimToken === 'string'
      && Number.isFinite(data.savedAt) && now - data.savedAt <= MAX_AGE_MS;
    if (!valid) {
      storage(store)?.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearPendingGuestPurchase(store) {
  try {
    storage(store)?.removeItem(STORAGE_KEY);
  } catch {
    // nada que limpiar
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pide al backend la licencia de una compra sin cuenta. Si el cobro todavía no
// se confirma (o el aviso de Stripe la está creando en ese momento) reintenta
// unas veces. Devuelve { status: 'approved', key, token, license } |
// { status: 'pending' } | { status: 'gone', error }: 'gone' es que ya no hay
// nada que reclamar con estos datos (la clave ya se entregó o el pago no es de
// este navegador), así que se puede olvidar.
export async function confirmGuestPurchase({ backendUrl, checkoutSessionId, claimToken, attempts = 8, delayMs = 1500, fetchImpl = fetch, sleep = wait }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    let data;
    try {
      res = await fetchImpl(`${backendUrl}/api/payments/stripe/guest-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutSessionId, claimToken }),
      });
      data = await res.json();
    } catch {
      data = null;
    }
    if (data?.success && data.status === 'approved') {
      return { status: 'approved', key: data.key, token: data.token, license: data.license };
    }
    if (res && (res.status === 404 || res.status === 409)) {
      return { status: 'gone', error: data?.error || 'No se encontró la compra.' };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return { status: 'pending' };
}
