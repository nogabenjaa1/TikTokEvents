// Elección sobre los anuncios (ver CookieBanner.jsx y la página Cookies).
// BenjaApis no crea cookies propias; las únicas cookies de terceros con
// alternativa son las de anuncios: 'all' = anuncios personalizados,
// 'non_personalized' = Google muestra anuncios sin usar tu historial.
// Se guarda en este navegador (sin elección = el banner se muestra).
const KEY = 'tkc_cookie_consent';
const OPEN_EVENT = 'tkc-open-cookie-settings';

export function loadConsent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    return parsed && (parsed.ads === 'all' || parsed.ads === 'non_personalized') ? parsed : null;
  } catch {
    return null;
  }
}

// AdSense lee esta marca antes de pedir cada anuncio: con 1, los anuncios no
// usan cookies de personalización. Se aplica al arrancar y en cada cambio.
export function applyAdsConsent(consent = loadConsent()) {
  if (typeof window === 'undefined') return;
  window.adsbygoogle = window.adsbygoogle || [];
  window.adsbygoogle.requestNonPersonalizedAds = consent?.ads === 'all' ? 0 : 1;
}

export function saveConsent(ads) {
  const consent = { ads, at: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(consent)); } catch { /* sin almacenamiento: vale solo esta visita */ }
  applyAdsConsent(consent);
  return consent;
}

// "Preferencias de anuncios" (páginas legales): vuelve a abrir el banner.
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
export function onOpenCookieSettings(handler) {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
