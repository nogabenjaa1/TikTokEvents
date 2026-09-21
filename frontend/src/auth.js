// Helpers de sesión/licencia, sin JSX: se usan desde App.jsx y LicenseManager.jsx.
import { io } from 'socket.io-client';
import { writeStorage, removeStorage } from './safeStorage';

const SESSION_KEY = 'tkc_session'; // { token, licenseKey, overlayKey, username, licenseType, isAdmin, expiresAt }

// Si el navegador no deja guardar (almacenamiento bloqueado o lleno), la sesión
// igual dura mientras la pestaña siga abierta, en vez de romper el inicio de sesión.
let memorySession = null;

export function saveSession(session) {
  memorySession = writeStorage(SESSION_KEY, JSON.stringify(session)) ? null : session;
}

export function loadSession() {
  if (memorySession) return memorySession;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  memorySession = null;
  removeStorage(SESSION_KEY);
}

// El overlay se carga en OBS sin login interactivo posible: su token viaja en
// la URL (?overlay=true&key=...) y se manda tal cual en el handshake del socket.
export function isOverlayMode() {
  return window.location.hash.includes('overlay') || window.location.search.includes('overlay=true');
}

function getOverlayKeyFromUrl() {
  return new URLSearchParams(window.location.search).get('key');
}

// Qué pantalla mostrar dentro del overlay: 'games' (Rey del Trono/
// Zubastinis/Eliminación/Ruleta, el overlay de siempre), 'colors' (el
// overlay horizontal de Color Says, ver DiceOverlay.jsx), 'taptap' (ranking
// de likes), 'gifter' (ranking de regalos), 'musicqueue' (cola de canciones
// pedidas con !play, ver SpotifyQueueOverlay) o 'extensible' (contador
// horizontal que crece con follows/regalos, ver ExtensibleOverlay en
// Overlay.jsx) — se agrega como ?screen=... a la URL normal de overlay,
// nunca reemplaza a `key`.
export function getOverlayScreen() {
  return new URLSearchParams(window.location.search).get('screen') || 'games';
}

// URL lista para pegar como fuente de navegador en OBS/TikTok LIVE Studio:
// mismo origen en el que corre el panel (el overlay es un modo de este
// mismo frontend, nunca del backend) + el token de solo lectura del overlay
// (`overlayKey`, ver auth.overlayTokenFor en el backend): ese enlace se ve en
// OBS y en las capturas, y con el token no se puede iniciar sesión. Una sesión
// guardada antes de que existiera el token usa, mientras se lo pide al
// backend (ver ensureOverlayKey), la license key cruda. Devuelve null si la
// sesión no tiene ninguna de las dos.
// `screen`: 'games' (por defecto), 'colors', 'taptap' o 'gifter' — ver
// getOverlayScreen más arriba.
export function buildOverlayUrl(screen = 'games') {
  const session = loadSession();
  const key = session?.overlayKey || session?.licenseKey;
  if (!key) return null;
  const base = `${window.location.origin}/?overlay=true&key=${encodeURIComponent(key)}`;
  return screen === 'games' ? base : `${base}&screen=${screen}`;
}

// Si el frontend y el backend viven en orígenes distintos (p. ej. frontend
// en Vercel y backend en Railway/Render/Fly), VITE_BACKEND_URL apunta al
// backend explícitamente. Sin esa variable, se asume el modo "todo junto"
// de siempre: en dev, Vite (5173) y el backend (3001) corren en puertos
// separados; en producción el backend sirve el build del frontend + la API
// + los sockets desde el mismo origen (ver server.js), así que usamos ese
// mismo origen — evita hardcodear el puerto 3001 y respeta HTTPS
// automáticamente (si se devolviera "http://..." fijo, el navegador
// bloquearía el fetch por contenido mixto en un sitio servido por HTTPS).
export function backendUrl() {
  const configured = import.meta.env.VITE_BACKEND_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:3001`;
  }
  return window.location.origin;
}

// Arma el socket ya autenticado: con la license key cruda si es overlay,
// o con el JWT de la sesión logueada si es la ventana de control.
// Devuelve null si no hay con qué autenticar (App.jsx debe mostrar Login).
export function buildAuthenticatedSocket() {
  if (isOverlayMode()) {
    const key = getOverlayKeyFromUrl();
    if (!key) return null;
    // `overlayScreen` le dice al servidor QUÉ overlay es (el de alertas cuenta
    // para saber si el panel debe sonar o no, ver alerts.js del backend).
    return io(backendUrl(), { auth: { licenseKey: key, overlayScreen: getOverlayScreen() } });
  }
  const session = loadSession();
  if (!session?.token) return null;
  return io(backendUrl(), { auth: { token: session.token } });
}

export async function loginWithKey(key) {
  const res = await fetch(`${backendUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Login fallido');
  return data; // { token, license }
}

// Prueba gratis de 7 días: solo pide un alias (texto libre, no se valida
// contra TikTok) y devuelve sesión ya lista, igual que loginWithKey.
// `setupIntentId` es opcional — la vía alternativa a ver anuncios (ver
// CardVerifyForm.jsx): el backend lo verifica contra Stripe (SetupIntent
// ya confirmado, sin cobrar nada) antes de crear la licencia, ver
// server.js.
export async function requestFreeTrial(alias, setupIntentId) {
  const res = await fetch(`${backendUrl()}/api/free-trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, setupIntentId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'No se pudo crear la prueba gratis');
  return data; // { key, token, license }
}

export function authHeaders() {
  const session = loadSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

// Re-lee el estado de la licencia del backend y lo pisa sobre la sesión
// guardada (mismo patrón que Login.jsx: token/licenseKey se conservan, el
// resto viene de `license`). Se usa después de una compra — el webhook de
// MercadoPago actualiza la licencia en la DB, pero el token/sesión local
// sigue teniendo los valores viejos hasta que se vuelve a pedir esto.
// Si `data.newKey` viene presente (el webhook de MercadoPago rotó la key al
// aplicar una compra, ver backend/server.js), se guarda como el nuevo
// `licenseKey` de la sesión (así la URL del overlay se arma con la key
// correcta de ahí en más) y se devuelve aparte en `revealedKey` para que el
// caller pueda mostrárselo al streamer una única vez — el backend ya la
// borró de la DB al responder esto, no hay una segunda oportunidad de verla.
export async function refreshSession() {
  const session = loadSession();
  if (!session?.token) return null;
  const res = await fetch(`${backendUrl()}/api/auth/verify`, { headers: authHeaders() });
  const data = await res.json();
  if (!data.success) return null;
  const updated = { ...session, ...data.license };
  if (data.newKey) updated.licenseKey = data.newKey;
  saveSession(updated);
  return { ...updated, revealedKey: data.newKey || null };
}

// Pide el token del overlay para una sesión abierta antes de que existiera y lo
// guarda. No toca nada más de la sesión (a diferencia de refreshSession, que
// también consume la clave nueva de una compra). Devuelve true si guardó uno.
export async function ensureOverlayKey() {
  const session = loadSession();
  if (!session?.token || session.overlayKey) return false;
  const res = await fetch(`${backendUrl()}/api/auth/overlay-key`, { headers: authHeaders() });
  const data = await res.json();
  if (!data.success || !data.overlayKey) return false;
  saveSession({ ...loadSession(), overlayKey: data.overlayKey });
  return true;
}

// Renueva SOLO los enlaces de overlay: los actuales dejan de funcionar y se genera
// un token nuevo. La clave de licencia y la sesión no cambian. Guarda el token nuevo
// en la sesión para que los enlaces que arma buildOverlayUrl ya salgan renovados.
// Devuelve cuántos overlays abiertos con el enlace anterior se apagaron.
export async function rotateOverlayKey() {
  const session = loadSession();
  if (!session?.token) throw new Error('Inicia sesión para renovar tus enlaces.');
  const res = await fetch(`${backendUrl()}/api/auth/rotate-overlay-key`, { method: 'POST', headers: authHeaders() });
  if (res.status === 429) throw new Error('Ya renovaste tus enlaces varias veces en la última hora. Espera un rato e inténtalo de nuevo.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.overlayKey) throw new Error(data.error || 'No se pudieron renovar los enlaces. Intenta de nuevo.');
  saveSession({ ...loadSession(), overlayKey: data.overlayKey });
  return { disconnected: Number(data.disconnected) || 0 };
}

// Avisa al backend que mate la sesión ya mismo (no hace falta esperar a que
// otro dispositivo se loguee para que este token deje de servir). Es un
// best-effort: si falla (sin conexión, etc.) el logout local sigue andando
// igual, total el próximo login de cualquier lado invalida esto de todas formas.
export async function logoutSession() {
  try {
    await fetch(`${backendUrl()}/api/auth/logout`, { method: 'POST', headers: authHeaders() });
  } catch {
    // sin conexión o lo que sea: no bloquea el logout local
  }
}
