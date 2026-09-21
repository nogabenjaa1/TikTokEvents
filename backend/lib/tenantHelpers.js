// Constantes de tiempo/tamaño y funciones puras que usa Tenant (tenant.js).
// Se movieron acá tal cual estaban (pedido: dividir tenant.js en módulos
// para bajar el riesgo de errores al editarlo) -- sin cambios de lógica.

// Eliminación/Ruleta comparten el mismo ciclo de revelado, en DOS fases de
// duración fija (pedido explícito): "selección" (la animación de sorteo/
// giro, puramente cosmética) y "resultado" (se muestra quién quedó afuera
// hasta que termina, y recién ahí se oculta sola — antes se quedaba
// pegada en pantalla hasta la siguiente eliminación, bug real a
// propósito corregido acá). "Fast Mode" (ver elimState.fastMode/
// rouletteState.fastMode) reduce ambas fases a la mitad.
const REVEAL_SELECT_MS = 2000;
const REVEAL_RESULT_MS = 2000;
const REVEAL_SELECT_MS_FAST = 1000;
const REVEAL_RESULT_MS_FAST = 1000;

// Galería de avatares de relleno para entradas manuales (ver
// elim_add_manual_entry/roulette_add_manual_entry): 10 círculos de colores
// variados con un emoji simple, para usuarios nuevos que el admin suma a
// mano y que no tienen foto de perfil real de TikTok (pedido explícito:
// reemplaza el cuadrado negro liso que se usaba antes, poco prolijo en el
// overlay). Se elige uno al azar por usuario nuevo; como quien llama ya
// reusa el avatar existente si el usuario repite, la elección queda fija
// para ese usuario mientras dure la ronda (ver pickDefaultManualAvatar).
const DEFAULT_MANUAL_AVATARS = [
    ['#F87171', '🦊'], ['#FBBF24', '🐯'], ['#34D399', '🐸'], ['#60A5FA', '🐨'],
    ['#A78BFA', '🐵'], ['#F472B6', '🐱'], ['#4ADE80', '🐶'], ['#FB923C', '🦁'],
    ['#22D3EE', '🐼'], ['#C084FC', '🦉'],
].map(([bg, emoji]) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="${bg}"/><text x="50" y="66" font-size="52" text-anchor="middle">${emoji}</text></svg>`
));

function pickDefaultManualAvatar() {
    return DEFAULT_MANUAL_AVATARS[Math.floor(Math.random() * DEFAULT_MANUAL_AVATARS.length)];
}

// tiktok-live-connector arma la conexión en dos pasos: primero pide datos
// por HTTP (con timeout propio, ~10s, ver TIKTOK_CLIENT_TIMEOUT), y recién
// después abre el WebSocket real a TikTok — ese segundo paso, con la
// versión instalada, no tiene ningún timeout interno. Si TikTok (o el sign
// server de Euler Stream) nunca responde el handshake, `connect()` se
// queda colgado para siempre: nunca resuelve ni rechaza, así que el panel
// se queda en "Conectando..." sin fin y el reintento automático de
// scheduleReconnect nunca llega a dispararse (solo corre tras un catch).
// Este timeout propio convierte ese cuelgue en un error real y visible.
const TIKTOK_CONNECT_TIMEOUT_MS = 20000;

// Reporte real: la conexión se queda "zombie" -- el objeto de
// WebcastPushConnection nunca dispara 'disconnected' (así que
// liveConnected sigue en true y el panel se ve "conectado"), pero TikTok
// dejó de empujar mensajes de verdad (chat/regalos/likes se cortan en
// silencio). Pasa con cualquier scraper de WebSocket sobre servicios que
// no siempre mandan un close frame limpio -- un corte de red, un timeout
// del lado de TikTok, etc. 'rawData' (ver ensureTikTokConnection) se
// dispara para CUALQUIER mensaje que llegue, incluyendo los muy
// frecuentes de conteo de espectadores -- si pasan WATCHDOG_TIMEOUT_MS
// sin ni uno solo, se asume que la conexión está muerta de verdad y se
// fuerza una reconexión, aunque el objeto de conexión diga que sigue
// viva.
// Reporte real: "el bot deja de leer comentarios un rato y luego vuelve" --
// con 30s de chequeo y 120s de silencio el hueco podía pasar de 2 minutos
// antes de forzar la reconexión. Ahora se revisa cada 10s y se corta a los
// 45s sin ningún mensaje (los conteos de espectadores llegan mucho más
// seguido que eso en un LIVE vivo). Una reconexión por esta vía NUNCA borra
// rankings ni partidas (ver wasEverConnected), así que un falso positivo
// solo cuesta un par de segundos.
// Espera entre reintentos de conexión cuando un intento FALLA (cuenta que
// todavía no está en vivo, servidor de firmas caído...): crece hasta 60 s en
// vez de golpear cada 3 s para siempre. Tras una conexión exitosa se reinicia.
const RECONNECT_BACKOFF_MS = [3000, 5000, 10000, 20000, 30000, 60000];
// Cada cuántos intentos fallidos se repite el aviso en los logs.
const RECONNECT_LOG_EVERY = 10;

const WATCHDOG_CHECK_INTERVAL_MS = 10000;
const WATCHDOG_TIMEOUT_MS = 45000;

// Bug real reportado ("el stream terminó y se quedó en bucle"): cuando el
// LIVE de verdad termina, a veces TikTok igual deja pasar el handshake de
// conexión (llega a loguear "✅ CONECTADO") pero corta el WebSocket casi al
// instante después -- a diferencia del caso ya manejado más abajo
// (isUserOfflineError, donde el propio connect() rechaza con "isn't
// online"), acá connect() SÍ resuelve, así que el catch de esa promesa
// nunca se entera de nada raro. El handler de 'disconnected' (más abajo)
// reintentaba sin condición ninguna, así que terminaba conectándose y
// desconectándose en bucle cada pocos segundos para siempre, generando un
// log infinito y nunca liberando el panel. Este umbral es lo que distingue
// "corte real de red a mitad de un LIVE sano" (conexión que duró minutos)
// de "el LIVE ya terminó" (conexiones que no llegan a durar ni
// SHORT_CONNECTION_THRESHOLD_MS) -- se exige que se repita
// MAX_CONSECUTIVE_SHORT_DISCONNECTS veces seguidas antes de darlo por
// terminado, para no cortar el reintento automático por una única
// reconexión mala pero pasajera.
const SHORT_CONNECTION_THRESHOLD_MS = 15000;
const MAX_CONSECUTIVE_SHORT_DISCONNECTS = 3;

class TikTokConnectTimeoutError extends Error {
    constructor() {
        super(`La conexión no respondió en ${TIKTOK_CONNECT_TIMEOUT_MS / 1000}s`);
        this.name = 'TikTokConnectTimeoutError';
    }
}

// TOP TAP-TAP: el evento `like` de tiktok-live-connector NO trae un flag de
// combo terminado (a diferencia de los regalos con `repeatEnd`) — llega como
// conteos periódicos mientras alguien mantiene el dedo en la pantalla. Por
// eso el "no sumar hasta que termine la ráfaga" se arma acá con un
// temporizador propio: cada nuevo tick de likes de un usuario reinicia su
// cuenta regresiva de "asentamiento"; recién cuando pasan TAPTAP_SETTLE_MS
// sin un tick nuevo de esa persona, lo acumulado se suma de una sola vez al
// ranking (ver processLikeTapTap/settleTapTap).
const TAPTAP_SETTLE_MS = 1500;

// Tags de texto para las alertas (pedido explícito): {username}/{nickname}/
// {gift}/{coins}/{count} -- se sustituyen recién al DISPARAR de verdad la
// alerta (ver processAlertTrigger/testFireAlert), nunca en el texto que se
// guarda en la DB (ese se queda con el template literal tal cual lo
// escribió el streamer, ver AlertsAdmin.jsx). Case-insensitive (\{Username\}
// funciona igual que \{username\}) para no exigir que lo escriban exacto.
function applyAlertTextTemplate(text, { username = '', nickname = '', gift = '', coins = 0, count = 1 } = {}) {
    if (!text) return text;
    return text
        .replace(/\{username\}/gi, () => username)
        .replace(/\{nickname\}/gi, () => nickname || username)
        .replace(/\{gift\}/gi, () => gift)
        .replace(/\{coins\}/gi, () => String(coins))
        .replace(/\{count\}/gi, () => String(count));
}

// ENTRADAS/INSTA-WIN POR VALOR (Rey del Trono/Eliminación/Ruleta): pedido
// explícito — los regalos de un mismo espectador solo se combinan entre sí
// si llegan separados por GIFT_ACCUMULATE_WINDOW_MS o menos; si pasa más
// tiempo que eso desde su último regalo, lo acumulado hasta ahora se
// pierde y el siguiente regalo arranca una cuenta nueva de cero. A
// diferencia de TAPTAP_SETTLE_MS (esperan el
// silencio para recién ahí actuar), acá se evalúa el umbral EN CADA
// regalo nuevo con el total acumulado hasta ese momento — ver
// accumulateGiftCoins/processGiftKing/processGiftElim/processGiftRoulette.
const GIFT_ACCUMULATE_WINDOW_MS = 10000;

// Un regalo con racha (x7 rosas) llega como varios mensajes y TikTok manda el
// último con repeatEnd para cerrarla; se cuenta y se dispara UNA vez, al
// cierre. Si ese cierre no llega nunca (pasa), la racha quedaría muerta y
// cobraría vida con el siguiente evento: pasado este tiempo sin mensajes
// nuevos de la misma racha se da por cerrada con lo último recibido.
const GIFT_COMBO_TIMEOUT_MS = 12000;
// Cuánto se recuerda una racha ya cerrada por tiempo, por si el cierre real
// llega tarde (no se cuenta dos veces).
const GIFT_COMBO_MEMORY_MS = 60000;
// Tope de regalos distintos vistos en el directo (para el catálogo).
const MAX_SEEN_GIFTS = 600;

// Cuántos puestos exponen los rankings continuos (Top Gifter / Top Tap-Tap)
// — no son partidas con inicio/fin, así que no hace falta acotarlos a un
// top 3 como Zubastinis.
const CONTINUOUS_LEADERBOARD_SIZE = 8;

// Cuántas canciones pedidas por !play se muestran en el overlay de la cola
// por default — configurable por el streamer (ver spotifySettings.maxQueueSize
// / update_spotify_settings), esto es solo el valor inicial.
const SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT = 8;
// Tope del historial interno de "pedidas todavía no confirmadas como
// tocadas" — separado del límite de VISUALIZACIÓN de arriba: acá se
// necesita guardar más de lo que se muestra para que el polling (ver
// pollSpotifyQueue) pueda seguirles la pista aunque el streamer las haya
// bajado del límite visible.
const SPOTIFY_QUEUE_INTERNAL_CAP = 50;
// Spotify no tiene forma de avisar "esta canción terminó/la saltearon" — no
// hay push ni webhook para reproducción de terceros. Este es el único modo
// real de mantener el overlay al día: preguntarle a la API cada tanto qué
// está sonando y qué sigue (GET /me/player/queue) y comparar contra lo que
// nosotros mismos agregamos. 4s es un balance entre "se siente en vivo" y
// no perseguir a la API de Spotify sin necesidad.
const SPOTIFY_POLL_INTERVAL_MS = 4000;

// MODO EXTENSIBLE: cuenta regresiva que arranca en `baseTime` y SUMA
// segundos con cada follow/regalo — al revés de los demás modos, acá el
// tiempo restante puede crecer en vivo. El tick es independiente de la
// conexión a TikTok (sigue corriendo aunque se caiga el LIVE); solo los
// follows/regalos que la alargan dependen de esa conexión.
const EXTENSIBLE_TICK_MS = 1000;

// Fisher-Yates — azar genuino en cada giro, no una animación sobre un
// resultado fijo: la ganadora sale de barajar la lista entera, no de
// elegirla antes y simular el resto (ver beginRouletteSpin).
function shuffleArray(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Elige hasta `maxCount` slots al azar de `pool` para eliminar en una sola
// ronda (ver elimState.eliminationsPerRound) — nunca deja el pool en CERO
// usuarios distintos: si un usuario tiene varios slots, perder algunos no
// lo saca del todo, así que solo se frena de agregar un slot más cuando
// hacerlo dejaría a ese usuario (Y a todos los demás) sin ningún slot. El
// resultado no importa quién sea puntualmente (es al azar de verdad sobre
// TODO el pool, no solo sobre los primeros N) — mismo criterio que
// shuffleArray/beginRouletteSpin.
function pickEliminationBatch(pool, maxCount) {
    const shuffled = shuffleArray(pool);
    const remaining = {};
    pool.forEach(p => { remaining[p.username] = (remaining[p.username] || 0) + 1; });
    let distinctAlive = Object.keys(remaining).length;
    const batch = [];
    for (const slot of shuffled) {
        if (batch.length >= maxCount) break;
        const wouldEmptyPool = remaining[slot.username] === 1 && distinctAlive === 1;
        if (wouldEmptyPool) continue;
        remaining[slot.username] -= 1;
        if (remaining[slot.username] === 0) distinctAlive -= 1;
        batch.push(slot);
    }
    return batch;
}

// Qué pedidos de !play siguen pendientes según la cola real de Spotify (ver lib/spotifyQueueSync.js).
const { createSpotifyRequest, publicSpotifyRequest, reconcileSpotifyRequests } = require('./spotifyQueueSync');

module.exports = {
    REVEAL_SELECT_MS,
    REVEAL_RESULT_MS,
    REVEAL_SELECT_MS_FAST,
    REVEAL_RESULT_MS_FAST,
    DEFAULT_MANUAL_AVATARS,
    pickDefaultManualAvatar,
    TIKTOK_CONNECT_TIMEOUT_MS,
    RECONNECT_BACKOFF_MS,
    RECONNECT_LOG_EVERY,
    WATCHDOG_CHECK_INTERVAL_MS,
    WATCHDOG_TIMEOUT_MS,
    SHORT_CONNECTION_THRESHOLD_MS,
    MAX_CONSECUTIVE_SHORT_DISCONNECTS,
    TikTokConnectTimeoutError,
    TAPTAP_SETTLE_MS,
    applyAlertTextTemplate,
    GIFT_ACCUMULATE_WINDOW_MS,
    GIFT_COMBO_TIMEOUT_MS,
    GIFT_COMBO_MEMORY_MS,
    MAX_SEEN_GIFTS,
    CONTINUOUS_LEADERBOARD_SIZE,
    SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT,
    SPOTIFY_QUEUE_INTERNAL_CAP,
    SPOTIFY_POLL_INTERVAL_MS,
    createSpotifyRequest,
    publicSpotifyRequest,
    reconcileSpotifyRequests,
    EXTENSIBLE_TICK_MS,
    shuffleArray,
    pickEliminationBatch,
};
