// Helpers de sesión/licencia, sin JSX: se usan desde App.jsx y LicenseManager.jsx.
import { io } from 'socket.io-client';

const SESSION_KEY = 'tkc_session'; // { token, licenseKey, username, licenseType, isAdmin, expiresAt }

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// El overlay se carga en OBS sin login interactivo posible: la key viaja en
// la URL (?overlay=true&key=...) y se manda tal cual en el handshake del socket.
export function isOverlayMode() {
  return window.location.hash.includes('overlay') || window.location.search.includes('overlay=true');
}

export function getOverlayKeyFromUrl() {
  return new URLSearchParams(window.location.search).get('key');
}

// Qué pantalla mostrar dentro del overlay: 'games' (Rey del Trono/
// Zubastinis/Eliminación, el overlay de siempre) o 'colors' (el overlay
// horizontal de Color Says, ver DiceOverlay.jsx). Se agrega como
// ?screen=colors a la URL normal de overlay, nunca reemplaza a `key`.
export function getOverlayScreen() {
  return new URLSearchParams(window.location.search).get('screen') || 'games';
}

// URL lista para pegar como fuente de navegador en OBS/TikTok LIVE Studio:
// mismo origen en el que corre el panel (el overlay es un modo de este
// mismo frontend, nunca del backend) + la license key cruda guardada en la
// sesión al loguearse. Devuelve null si la sesión no la tiene guardada
// (p. ej. quedó de un login anterior a que existiera este campo).
// `screen`: 'games' (por defecto, Rey del Trono/Zubastinis/Eliminación) o
// 'colors' (overlay horizontal de dados, ver DiceOverlay.jsx).
export function buildOverlayUrl(screen = 'games') {
  const session = loadSession();
  if (!session?.licenseKey) return null;
  const base = `${window.location.origin}/?overlay=true&key=${encodeURIComponent(session.licenseKey)}`;
  return screen === 'colors' ? `${base}&screen=colors` : base;
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
    return io(backendUrl(), { auth: { licenseKey: key } });
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
export async function requestFreeTrial(alias) {
  const res = await fetch(`${backendUrl()}/api/free-trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'No se pudo crear la prueba gratis');
  return data; // { key, token, license }
}

export function authHeaders() {
  const session = loadSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
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
