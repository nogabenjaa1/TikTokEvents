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

async function getMe(accessToken) {
    const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Spotify /me falló (${res.status})`);
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
    if (!res.ok) throw new Error(`Spotify search falló (${res.status})`);
    const data = await res.json();
    return data.tracks?.items?.[0] || null;
}

class SpotifyPlaybackError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code; // 'NO_ACTIVE_DEVICE' | 'PREMIUM_REQUIRED' | 'UNKNOWN'
    }
}

// POST /me/player/queue — exige Premium Y un dispositivo activo (ver
// comentario del encabezado). Spotify no distingue estos dos casos con
// claridad en el body de error, así que se infiere por status: 404 =
// sin dispositivo activo (el caso más común), 403 = cuenta sin Premium.
async function addToQueue(accessToken, trackUri) {
    const params = new URLSearchParams({ uri: trackUri });
    const res = await fetch(`https://api.spotify.com/v1/me/player/queue?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204 || res.ok) return;
    if (res.status === 404) throw new SpotifyPlaybackError('NO_ACTIVE_DEVICE', 'No hay un dispositivo de Spotify activo');
    if (res.status === 403) throw new SpotifyPlaybackError('PREMIUM_REQUIRED', 'Se necesita Spotify Premium');
    throw new SpotifyPlaybackError('UNKNOWN', `Spotify queue falló (${res.status}): ${await res.text()}`);
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getMe, getValidAccessToken, searchTrack, addToQueue, SpotifyPlaybackError };
