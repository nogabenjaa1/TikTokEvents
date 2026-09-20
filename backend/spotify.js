// Integración con la Web API de Spotify para el comando !play del chat.
// Cada licencia conecta SU PROPIA cuenta de Spotify por OAuth (Authorization
// Code Flow) — nunca hay una cuenta compartida entre streamers. La APP de
// Spotify que hace ese OAuth puede ser de dos orígenes (ver
// resolveCredentials): la de la plataforma (SPOTIFY_CLIENT_ID/SECRET en las
// variables de entorno, registrada una sola vez en developer.spotify.com) o
// una que el propio streamer crea en su cuenta de desarrollador y pega en el
// panel (tabla spotify_apps, con el secreto cifrado).
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
//
// Por esa segunda restricción, quién puede usar Spotify (decisión de
// producto, no de Spotify — ver evaluateAccess) es:
//   - Lifetime: incluido. Los primeros SHARED_SLOTS_TOTAL (5) en conseguirlo
//     usan la app de la plataforma; el resto crea SU PROPIA app, con una
//     guía en el panel.
//   - Anual: incluido, siempre con su propia app.
//   - Mensual: solo con el complemento de pago único (spotify_addon), también
//     con su propia app.
//   - Prueba/día/semana: sin acceso. La licencia admin siempre usa la app de
//     la plataforma.
// Cada app propia está en modo Development con su dueño como único usuario,
// así que no le pega el tope de 5 de la app de la plataforma.
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

// Cupos de la app de la plataforma para clientes: los 5 usuarios que admite
// Spotify en modo Development (ver el encabezado). Se reparten a los primeros
// Lifetime por fecha en que lo consiguieron (ver
// db.getSharedSpotifySlotHolders); la licencia admin no consume ninguno.
//
// El tope de Spotify cuenta CUENTAS DE SPOTIFY distintas, no licencias: dos
// licencias que vinculan la misma cuenta (p. ej. la admin y la Lifetime de
// alguien de confianza) cuentan como un solo usuario, y nada en este backend
// lo impide (spotify_accounts.spotify_user_id no es único). Se supone que la
// cuenta dueña de la app no ocupa uno de los 5 lugares de User Management (la
// doc de Spotify no lo aclara): si Spotify se negara a agregar al quinto
// usuario, bajar este número a 4.
const SHARED_SLOTS_TOTAL = 5;

// Planes que incluyen Spotify sin pagar nada más. Mensual entra solo con el
// complemento de pago único (`license.spotify_addon`).
const INCLUDED_LICENSE_TYPES = ['lifetime', 'annual'];

// Quién puede usar Spotify EN ABSOLUTO (con cuál app se conecta es otra
// pregunta, ver evaluateAccess). Vive en un solo lugar: el servidor
// (conectar, estado), los comandos del chat (tenant) y el panel salen todos
// de aquí. `license` es una fila de la tabla licenses (license_type /
// is_admin / spotify_addon), no un objeto de sesión del front.
function isLicenseAllowed(license) {
    if (!license) return false;
    return Boolean(license.is_admin)
        || INCLUDED_LICENSE_TYPES.includes(license.license_type)
        || Boolean(license.spotify_addon);
}

// Resuelve todo lo que el panel necesita saber de una licencia, sin tocar la
// DB (los tres datos de afuera los pone el caller):
//   entitled     — puede usar Spotify (plan incluido, complemento o admin).
//   source       — con qué app conecta: 'own' (tiene la suya guardada),
//                  'shared' (la de la plataforma: admin o cupo de los
//                  primeros 5 Lifetime) o null (todavía no tiene con qué).
//   needsOwnApp  — tiene derecho pero le toca crear su propia app.
//   addonRequired— es Mensual sin el complemento: puede comprarlo.
// Si tiene app propia se usa esa aunque también tenga cupo (le sirve de
// salida cuando la app de la plataforma falla).
function evaluateAccess({ license, hasOwnApp = false, sharedSlotHolderIds = [] }) {
    if (!isLicenseAllowed(license)) {
        const addonRequired = license?.license_type === 'month';
        return {
            entitled: false, reason: addonRequired ? 'addon_required' : 'plan_not_eligible',
            source: null, needsOwnApp: false, addonRequired, holdsSharedSlot: false,
        };
    }
    const holdsSharedSlot = Boolean(license.is_admin) || sharedSlotHolderIds.includes(license.id);
    const source = hasOwnApp ? 'own' : (holdsSharedSlot ? 'shared' : null);
    const reason = license.is_admin ? 'admin'
        : license.license_type === 'lifetime' ? 'lifetime'
            : license.license_type === 'annual' ? 'annual' : 'addon';
    return { entitled: true, reason, source, needsOwnApp: source === null, addonRequired: false, holdsSharedSlot };
}

// Validación de una compra del complemento (la usan los tres caminos de
// pago). Devuelve el mensaje de rechazo o null si se puede comprar.
// `planType` es el plan que se compra en el mismo pago, si lo hay: importa el
// plan con el que QUEDA la licencia, no el de antes (un trial que compra
// Mensual + complemento juntos es válido).
function addonPurchaseError(license, planType) {
    if (!license) return 'Licencia inválida';
    if (license.is_admin) return 'Tu licencia ya incluye Spotify.';
    if (license.spotify_addon) return 'Ya tienes el complemento de Spotify.';
    const resultingPlan = planType || license.license_type;
    if (INCLUDED_LICENSE_TYPES.includes(resultingPlan)) return 'Tu plan ya incluye Spotify.';
    if (resultingPlan !== 'month') return 'El complemento de Spotify es para el plan Mensual.';
    return null;
}

function assertConfigured() {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        throw new Error('Falta configurar SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET en las variables de entorno');
    }
}

// Credenciales de la app que hace el OAuth de UNA licencia: la propia del
// streamer (`app` = { clientId, clientSecret }, ya descifrada por db.js) o,
// si no tiene, la de la plataforma. Cada función de OAuth de más abajo la
// recibe tal cual: una licencia con app propia nunca toca las credenciales de
// la plataforma, y al revés (un refresh_token solo sirve con la app que lo
// emitió).
function resolveCredentials(app) {
    if (app) return { clientId: app.clientId, clientSecret: app.clientSecret };
    assertConfigured();
    return { clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET };
}

function getAuthUrl(state, app) {
    const { clientId } = resolveCredentials(app);
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function basicAuthHeader({ clientId, clientSecret }) {
    return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function exchangeCodeForTokens(code, app) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader(resolveCredentials(app)) },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    if (!res.ok) throw new Error(`Spotify token exchange falló (${res.status}): ${await res.text()}`);
    return res.json(); // { access_token, refresh_token, expires_in, ... }
}

// Spotify caduca los refresh tokens a los 6 meses de la autorización original
// (desde el 2026-07-20 para las apps que ya existían): el plazo se mide desde
// ahí, refrescar el access_token NO lo extiende, y una autorización nueva
// empieza otros 6 meses. Cuando vence, el endpoint de token responde 400
// {"error":"invalid_grant"} — lo mismo que si el usuario revocó el acceso a la
// app desde su cuenta de Spotify. Reintentar no sirve: hay que volver a pasar
// al streamer por el OAuth, y por eso se separa de cualquier otro fallo.
class SpotifyRefreshTokenExpiredError extends Error {
    constructor(message) {
        super(message);
        this.code = 'REFRESH_TOKEN_EXPIRED';
    }
}

async function refreshAccessToken(refreshToken, app) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader(resolveCredentials(app)) },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) {
        const body = await res.text();
        if (res.status === 400 && /invalid_grant/.test(body)) throw new SpotifyRefreshTokenExpiredError(`Spotify token refresh falló (400): ${body}`);
        throw new Error(`Spotify token refresh falló (${res.status}): ${body}`);
    }
    return res.json(); // { access_token, expires_in, ... } — Spotify no siempre manda refresh_token nuevo
}

// ── App propia del streamer ──────────────────────────────
// Client ID y secret de Spotify son cadenas alfanuméricas de 32 caracteres;
// el rango es más ancho a propósito para no rechazar credenciales válidas si
// Spotify cambia el formato — la validación real es verifyAppCredentials.
const APP_CREDENTIAL_RE = /^[A-Za-z0-9]{16,64}$/;

// Saca clientId/clientSecret de un body ya parseado, sin espacios de más
// (pegar desde el dashboard suele traer alguno). null si alguno no tiene
// pinta de credencial de Spotify.
function parseAppCredentials(body) {
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
    const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if (!APP_CREDENTIAL_RE.test(clientId) || !APP_CREDENTIAL_RE.test(clientSecret)) return null;
    return { clientId, clientSecret };
}

class SpotifyInvalidCredentialsError extends Error {
    constructor(message) {
        super(message);
        this.code = 'INVALID_CREDENTIALS';
    }
}

// Comprueba que el par de credenciales sea de verdad de una app de Spotify
// con el flujo client_credentials: no necesita ningún usuario ni permisos, y
// Spotify responde 400 invalid_client si el ID o el secreto no coinciden. Así
// el streamer se entera al guardar, no después de un OAuth que falla.
async function verifyAppCredentials({ clientId, clientSecret }) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader({ clientId, clientSecret }) },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (res.ok) return true;
    // Nunca se incluye el body ni las credenciales en el mensaje: acaba en logs.
    if (res.status === 400 || res.status === 401) throw new SpotifyInvalidCredentialsError('Spotify rechazó el Client ID o el Client secret');
    throw new Error(`Spotify no pudo verificar las credenciales (${res.status})`);
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
    // `account.app` (la app propia de esa licencia, si tiene) la trae
    // db.getSpotifyAccount: el refresh_token solo sirve con la app que lo emitió.
    const refreshed = await refreshAccessToken(account.refresh_token, account.app);
    const expiresAt = Date.now() + refreshed.expires_in * 1000;
    // Spotify solo a veces manda un refresh_token nuevo: cuando lo manda hay
    // que guardar ese (según su doc, es el que vale de ahí en adelante); cuando no,
    // se sigue con el de siempre (db.updateSpotifyTokens no toca el guardado
    // si llega undefined).
    await db.updateSpotifyTokens(account.license_id, { accessToken: refreshed.access_token, expiresAt, refreshToken: refreshed.refresh_token });
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

module.exports = {
    REDIRECT_URI, SHARED_SLOTS_TOTAL,
    getAuthUrl, exchangeCodeForTokens, getMe, getValidAccessToken, searchTrack, addToQueue, getQueue, skipToNext, setVolume,
    isLicenseAllowed, evaluateAccess, addonPurchaseError, parseAppCredentials, verifyAppCredentials,
    SpotifyPlaybackError, SpotifyUserNotRegisteredError, SpotifyInvalidCredentialsError, SpotifyRefreshTokenExpiredError,
};
