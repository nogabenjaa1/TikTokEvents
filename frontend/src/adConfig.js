// Config centralizada de anuncios (Adsterra) — un solo lugar para tocar
// zone IDs, cadencias y topes sin tener que buscarlos en cada componente.

// Smartlink: usado para el "gate" de recompensa (mirar un anuncio para
// desbloquear algo). Adsterra no ofrece un formato de rewarded-video nativo
// para sitios web comunes (eso es propio de SDKs de apps), así que se
// simula: se abre este link en una pestaña nueva y se exige un tiempo
// mínimo de espera antes de habilitar la recompensa — ver RewardedAdGate.jsx.
// Dominio con protección anti-adblock (el mismo zone ID, distinto host).
export const SMARTLINK_URL = 'https://beastscarnival.com/msynw10i?key=a4e47c8a93a86dfed922d3519bef717e';

// Banner (formato "atOptions" + invoke.js, distinto del NativeBanner de más
// abajo): cada zona corre aislada dentro de su propio iframe que nosotros
// mismos creamos — ver AdIframeBanner.jsx. Eso evita el problema que tenía
// el NativeBanner cuando dos lugares usaban la misma zona (contenedor/id
// compartido entre el banner fijo y el interstitial).
export const AD_SCRIPT_HOST = 'https://beastscarnival.com';

// 300x250: se usa en el interstitial propio (InterstitialAd.jsx) — llena
// mejor el modal que un formato angosto.
export const INTERSTITIAL_AD_ZONE = { key: '7b8487fedbea8eaf0994eff85fc669d9', width: 300, height: 250 };

// 320x50: se usa en el banner fijo debajo del historial de Color Says
// (AdBanner.jsx) — calza exacto con el ancho de esa columna.
export const PERSISTENT_BANNER_ZONE = { key: '5df1727ae4b077fe00c975fe19ce0983', width: 320, height: 50 };

// NativeBanner: zona aparte (propia, no compartida con nada) que se apila
// junto al banner de 320x50 — ver NativeAdBanner.jsx. Se inyecta una sola
// vez por montaje, sin refresco (el script de Adsterra no vuelve a
// renderizar en una segunda invocación dentro de la misma carga de página,
// ver el comentario largo que tenía antes AdBanner.jsx en el historial de git).
export const NATIVE_BANNER_SCRIPT_SRC = 'https://beastscarnival.com/8a597f34f920548368a4283c01d1d87d/invoke.js';
export const NATIVE_BANNER_CONTAINER_ID = 'container-8a597f34f920548368a4283c01d1d87d';

// Tiempo mínimo (ms) que hay que dejar pasar tras abrir el Smartlink antes
// de poder reclamar la recompensa — evita el "abrir y cerrar" instantáneo.
// No es infalible, es una barrera proporcional al beneficio que desbloquea.
export const REWARD_MIN_WAIT_MS = 10_000;

// Tiempo mínimo (ms) que el interstitial queda en pantalla antes de poder cerrarlo.
export const INTERSTITIAL_MIN_WAIT_MS = 12_000;

// Si nadie lo cierra a mano, el interstitial se cierra solo a los 15s de
// abierto — así nunca queda bloqueando el juego indefinidamente (por
// ejemplo si el anuncio no cargó nada, ver comentario en AdBanner.jsx).
export const INTERSTITIAL_AUTO_CLOSE_MS = 15_000;

// Color Says como invitado (sin sesión): cada anuncio recompensado suma
// esto al banco de horas sin ads.
export const GUEST_BANK_HOUR_MS = 60 * 60 * 1000;
// Tope acumulable: 48 anuncios ≈ 48 horas de uso ininterrumpido.
export const GUEST_BANK_CAP_MS = 48 * GUEST_BANK_HOUR_MS;
// Sin banco activo, cada cuánto se interrumpe el juego con el interstitial.
export const GUEST_INTERSTITIAL_INTERVAL_MS = 15 * 60 * 1000; // 15 min

// Licencia trial: "3 anuncios cada 2 horas" repartidos parejo en el tiempo,
// mientras haya sesión trial activa en el panel (no solo en Color Says).
export const TRIAL_AD_INTERVAL_MS = (2 * 60 * 60 * 1000) / 3; // ~40 min

// Cuántas veces hay que reclamar el RewardedAdGate en Login.jsx para
// desbloquear el formulario de la prueba gratis (la alternativa es
// verificar una tarjeta en vez de ver anuncios, ver CardVerifyForm.jsx).
export const TRIAL_UNLOCK_AD_COUNT = 5;
