const MP_SDK_SRC = 'https://sdk.mercadopago.com/js/v2';

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
