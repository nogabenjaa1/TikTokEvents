// Helpers de sesión/licencia, sin JSX: se usan desde App.jsx y LicenseManager.jsx.
import { io } from 'socket.io-client';

const SESSION_KEY = 'tkc_session'; // { token, username, licenseType, isAdmin, expiresAt }

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

// En dev, Vite (5173) y el backend (3001) corren en puertos separados. En
// producción el backend sirve el build del frontend + la API + los sockets
// desde el mismo origen (ver server.js), así que usamos ese mismo origen:
// evita hardcodear el puerto 3001 y respeta HTTPS automáticamente (si se
// devolviera "http://..." fijo, el navegador bloquearía el fetch por
// contenido mixto en un sitio servido por HTTPS).
export function backendUrl() {
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
