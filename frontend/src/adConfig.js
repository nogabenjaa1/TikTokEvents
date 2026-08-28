// Config centralizada de anuncios (Adsterra) — un solo lugar para tocar
// zone IDs, cadencias y topes sin tener que buscarlos en cada componente.

// Smartlink: usado para el "gate" de recompensa (mirar un anuncio para
// desbloquear algo). Adsterra no ofrece un formato de rewarded-video nativo
// para sitios web comunes (eso es propio de SDKs de apps), así que se
// simula: se abre este link en una pestaña nueva y se exige un tiempo
// mínimo de espera antes de habilitar la recompensa — ver RewardedAdGate.jsx.
// Dominio con protección anti-adblock (el mismo zone ID, distinto host).
export const SMARTLINK_URL = 'https://beastscarnival.com/msynw10i?key=a4e47c8a93a86dfed922d3519bef717e';

// NativeBanner: usado para el interstitial propio (ads pasivos/periódicos)
// que se muestra a invitados sin banco activo en Color Says y a licencias
// trial mientras usan el panel — ver InterstitialAd.jsx.
// Mismo dominio anti-adblock que el Smartlink (antes era el subdominio
// pl31061265.profitableratecpmnetwork.com).
export const NATIVE_BANNER_SCRIPT_SRC = 'https://beastscarnival.com/8a597f34f920548368a4283c01d1d87d/invoke.js';
export const NATIVE_BANNER_CONTAINER_ID = 'container-8a597f34f920548368a4283c01d1d87d';

// Cada cuánto se recarga el banner fijo de Color Says (AdBanner.jsx) para
// traer una creatividad nueva mientras está en pantalla.
export const AD_BANNER_REFRESH_MS = 30_000;

// Tiempo mínimo (ms) que hay que dejar pasar tras abrir el Smartlink antes
// de poder reclamar la recompensa — evita el "abrir y cerrar" instantáneo.
// No es infalible, es una barrera proporcional al beneficio que desbloquea.
export const REWARD_MIN_WAIT_MS = 15_000;

// Tiempo mínimo (ms) que el interstitial queda en pantalla antes de poder cerrarlo.
export const INTERSTITIAL_MIN_WAIT_MS = 12_000;

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
