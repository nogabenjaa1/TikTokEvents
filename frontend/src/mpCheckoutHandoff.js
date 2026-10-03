// Lo que Membership.jsx le pasa a la pantalla de pago de MercadoPago
// (MercadoPagoCheckout.jsx, en /membership/mercadopago): qué se compra, el
// monto que se le muestra al comprador y los datos de contacto que ya llenó
// en Membresía. Va en sessionStorage (no en el estado del router) para que
// recargar la pantalla de pago no la deje vacía; nunca lleva datos de la
// tarjeta. El monto es solo para mostrar: el backend lo vuelve a calcular
// desde pricing.js antes de cobrar.

const STORAGE_KEY = 'mpCheckoutPending';
// Una compra a medias más vieja que esto ya no se retoma (precio o política
// aceptada de otro momento): se vuelve a Membresía a elegir de nuevo.
const MAX_AGE_MS = 30 * 60 * 1000;

function storage(store) {
  try {
    return store ?? window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveMpCheckout(data, store) {
  try {
    storage(store)?.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadMpCheckout(store, now = Date.now()) {
  try {
    const raw = storage(store)?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!data.savedAt || now - data.savedAt > MAX_AGE_MS) return null;
    if (!data.planType && !data.spotifyAddon) return null;
    if (!(Number(data.amount) > 0) || !data.email || !data.policyAcceptedAt) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearMpCheckout(store) {
  try {
    storage(store)?.removeItem(STORAGE_KEY);
  } catch {
    // sin almacenamiento no queda nada que borrar
  }
}
