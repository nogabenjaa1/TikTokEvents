const MP_SDK_SRC = 'https://sdk.mercadopago.com/js/v2';
const MP_SECURITY_SRC = 'https://www.mercadopago.com/v2/security.js';

// Compartido entre CardVerifyForm.jsx (verificar tarjeta para prueba gratis)
// y CardPaymentForm.jsx (cobro real vía Card Payment Brick) — mismo patrón
// de "inyectar un <script> externo una vez" que ya usa NativeAdBanner.jsx
// para Adsterra, cargado recién cuando alguien realmente lo necesita.
export function loadMercadoPagoSdk() {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MP_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = MP_SDK_SRC;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// "Device ID" de MercadoPago (documentado en su checklist de calidad de
// integracion, "Identificador del dispositivo") -- este script arma un
// fingerprint del navegador y lo deja en window.MP_DEVICE_SESSION_ID; el
// backend lo manda como header X-meli-session-id al crear la orden. Sin
// esto, el motor antifraude de MP tiene mucha menos señal para distinguir
// una compra real de una sospechosa y por eso es mucho mas agresivo
// rechazando por "high_risk" -- confirmado via la doc oficial de MP
// (Checkout API/Orders, "Mejorar la aprobacion de pagos"). Solo hace falta
// una vez por pagina, igual que el SDK de arriba.
export function loadMercadoPagoSecurityScript() {
  if (window.MP_DEVICE_SESSION_ID) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MP_SECURITY_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = MP_SECURITY_SRC;
    script.setAttribute('view', 'checkout');
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
