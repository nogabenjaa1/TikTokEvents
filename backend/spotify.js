// Integración con la Web API de Spotify para el comando !play del chat.
// Cada licencia conecta SU PROPIA cuenta de Spotify por OAuth (Authorization
// Code Flow) — nunca hay una cuenta compartida entre streamers, ni el
// backend guarda una key propia de Spotify más allá del client_id/secret
// de LA APP (que se registra una sola vez en developer.spotify.com).
//
// Restricción real e ineludible de Spotify: agregar canciones a la cola
// (POST /me/player/queue) exige (a) el streamer tenga Spotify Premium y
// (b) tenga Spotify ABIERTO Y ACTIVO en algún dispositivo en ese momento —
// sin esto la API devuelve error sin importar qué hagamos acá. Ver
// requestSpotifySong en tenant.js para cómo se le avisa al streamer.
//
// Segunda restricción igual de real: mientras la app siga en modo
// Development (el default de developer.spotify.com/dashboard), SOLO pueden
// usarla las cuentas cargadas a mano en Settings > User Management (nombre +
// correo de la cuenta de Spotify, máximo 5 usuarios según la doc de quota
// modes de Spotify). Cualquier otra cuenta completa el OAuth sin problema
// pero recibe 403 "The user is not registered for this application" en el
// primer request a la API — ver SpotifyUserNotRegisteredError. Salir de ese
// límite exige que Spotify apruebe "Extended Quota Mode", que hoy solo se
// concede a organizaciones registradas con 250k usuarios activos al mes.
const db = require('./db');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
const REDIRECT_URI = `${BACKEND_URL}/api/spotify/callback`;

// user-modify-playback-state: agregar a la cola. user-read-playback-state:
// detectar "sin dispositivo activo" con un mensaje claro en vez de un 404
// genérico. user-read-email: nada más para mostrar con qué cuenta quedó
// conectado el streamer (display_name/email de /me).
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state', 'user-read-email'].join(' ');

// Quién puede usar Spotify: solo licencias Lifetime (más la de admin, que es
// la del dueño de la plataforma y no puede quedar afuera). Es el filtro con
// el que se reparte el cupo de 5 usuarios de la app (ver el encabezado)
// mientras no haya otra salida — no lo impone Spotify, es una decisión de
// producto, y por eso vive en un solo lugar: el servidor (conectar, estado),
// los comandos del chat (tenant) y el panel salen todos de acá.
const ALLOWED_LICENSE_TYPES = ['lifetime'];

// `license` es una fila de la tabla licenses (license_type / is_admin), no un
// objeto de sesión del front.
function isLicenseAllowed(license) {
    if (!license) return false;
    return Boolean(license.is_admin) || ALLOWED_LICENSE_TYPES.includes(license.license_type);
}

function assertConfigured() {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        throw new Error('Falta configurar SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET en las variables de entorno');
    }
}

function getAuthUrl(state) {
    assertConfigured();
    const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function basicAuthHeader() {
    return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
}

async function exchangeCodeForTokens(code) {
    assertConfigured();
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    if (!res.ok) throw new Error(`Spotify token exchange falló (${res.status}): ${await res.text()}`);
    return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
    assertConfigured();
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error(`Spotify token refresh falló (${res.status}): ${await res.text()}`);
    return res.json(); // { access_token, expires_in, ... } — Spotify no siempre manda refresh_token nuevo
}

// El 403 de "esta cuenta no está en la lista de usuarios de la app" (ver el
// encabezado) no se arregla reintentando ni reconectando — hace falta que
// alguien agregue la cuenta en el dashboard de Spotify —, así que se separa
// de cualquier otro fallo para que el caller no le diga al streamer que
// "intente de nuevo". Spotify lo manda como texto plano ("The user is not
// registered for this application...") y no con el JSON habitual
// { error: { status, message } }, de ahí que se reconozca por el body crudo.
class SpotifyUserNotRegisteredError extends Error {
    constructor(message) {
        super(message);
        this.code = 'USER_NOT_REGISTERED';
    }
}

function isUserNotRegistered(status, body) {
    return status === 403 && /not registered/i.test(body);
}

// Error para una respuesta no exitosa de un endpoint que no es de
// reproducción: mismo mensaje genérico de siempre, salvo el caso de arriba.
async function apiError(res, label) {
    const body = await res.text();
    if (isUserNotRegistered(res.status, body)) return new SpotifyUserNotRegisteredError(`${label} falló (403): ${body}`);
    return new Error(`${label} falló (${res.status}): ${body}`);
}

async function getMe(accessToken) {
    const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await apiError(res, 'Spotify /me');
    return res.json();
}

// Refresca el access_token solo si está por vencer (30s de margen) y
// persiste el nuevo valor — el caller (tenant.js) siempre recibe un token
// utilizable de una, sin tener que preocuparse por la expiración.
async function getValidAccessToken(account) {
    if (account.expires_at > Date.now() + 30000) return account.access_token;
    const refreshed = await refreshAccessToken(account.refresh_token);
    const expiresAt = Date.now() + refreshed.expires_in * 1000;
    await db.updateSpotifyTokens(account.license_id, { accessToken: refreshed.access_token, expiresAt });
    return refreshed.access_token;
}

// Devuelve el primer resultado (o null) — !play no tiene forma de que el
// usuario elija entre varias opciones, así que se apuesta al más relevante
// según el propio ranking de relevancia de Spotify.
async function searchTrack(accessToken, query) {
    const params = new URLSearchParams({ q: query, type: 'track', limit: '1' });
    const res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw await apiError(res, 'Spotify search');
    const data = await res.json();
    return data.tracks?.items?.[0] || null;
}

// GET /me/player/queue — el ÚNICO lugar donde Spotify expone qué está
// sonando de verdad y qué sigue (no hay push/webhook para esto; el overlay
// se sincroniza vía polling de tenant.js, ver pollSpotifyQueue). Devuelve
// { currently_playing: track|null, queue: track[] } — si no hay nada
// sonando, currently_playing viene null y queue puede venir vacío.
async function getQueue(accessToken) {
    const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw await apiError(res, 'Spotify queue-read');
    return res.json();
}

class SpotifyPlaybackError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code; // 'NO_ACTIVE_DEVICE' | 'PREMIUM_REQUIRED' | 'UNKNOWN'
    }
}

// Error para una respuesta no exitosa de un endpoint de reproducción. Spotify
// no distingue "sin dispositivo" de "sin Premium" con claridad en el body de
// error, así que se infiere por status: 404 = sin dispositivo activo (el
// caso más común), 403 = cuenta sin Premium — salvo el 403 de "cuenta no
// registrada en la app" (ver SpotifyUserNotRegisteredError), que se separa
// primero por su texto para no culpar a un Premium que sí puede estar bien.
async function playbackError(res, label) {
    if (res.status === 404) return new SpotifyPlaybackError('NO_ACTIVE_DEVICE', 'No hay un dispositivo de Spotify activo');
    const body = await res.text();
    if (isUserNotRegistered(res.status, body)) return new SpotifyUserNotRegisteredError(`${label} falló (403): ${body}`);
    if (res.status === 403) return new SpotifyPlaybackError('PREMIUM_REQUIRED', 'Se necesita Spotify Premium');
    return new SpotifyPlaybackError('UNKNOWN', `${label} falló (${res.status}): ${body}`);
}

// POST /me/player/queue — exige Premium Y un dispositivo activo (ver
// comentario del encabezado).
async function addToQueue(accessToken, trackUri) {
    const params = new URLSearchParams({ uri: trackUri });
    const res = await fetch(`https://api.spotify.com/v1/me/player/queue?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204 || res.ok) return;
    throw await playbackError(res, 'Spotify queue');
}

// POST /me/player/next — salta a la siguiente canción de la reproducción
// REAL (a diferencia de "revocar" un pedido puntual, que la API no permite
// hacer — ver el comentario de revokeSpotifyRequest en tenant.js). Mismos
// requisitos que addToQueue (Premium + dispositivo activo).
async function skipToNext(accessToken) {
    const res = await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204 || res.ok) return;
    throw await playbackError(res, 'Spotify skip');
}

// PUT /me/player/volume — mismos requisitos que el resto de los endpoints
// de reproducción. `volumePercent` ya viene acotado a 0-100 por el caller.
async function setVolume(accessToken, volumePercent) {
    const params = new URLSearchParams({ volume_percent: String(volumePercent) });
    const res = await fetch(`https://api.spotify.com/v1/me/player/volume?${params.toString()}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204 || res.ok) return;
    throw await playbackError(res, 'Spotify volume');
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getMe, getValidAccessToken, searchTrack, addToQueue, getQueue, skipToNext, setVolume, isLicenseAllowed, SpotifyPlaybackError, SpotifyUserNotRegisteredError };
