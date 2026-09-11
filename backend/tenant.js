// WebcastPushConnection se movió al subpath '/legacy' en una versión reciente
// de la librería — importarlo del paquete raíz devuelve `undefined` ahí
// (el root export ahora es solo el catálogo enorme de tipos protobuf), así
// que `new WebcastPushConnection(...)` explotaba con un TypeError SÍNCRONO
// en cada intento de conectar. Como eso pasaba dentro de un método async,
// se convertía en una promesa rechazada que todo caller atrapaba con
// `.catch(() => {})` sin loguear nada — por eso el panel se quedaba en
// "Conectando..." para siempre, sin ni éxito ni error visible.
const { WebcastPushConnection } = require('tiktok-live-connector/legacy');
const db = require('./db');
const spotify = require('./spotify');

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

// Tope de cuántos eliminados se muestran en grande/en burbujas por ronda
// en el overlay (ver EliminatedResultVisual en Overlay.jsx) — pedido
// explícito: 1 grande + hasta 4 burbujas, el resto va como texto "y N
// más...". No limita cuántos se pueden eliminar por ronda de verdad
// (eliminationsPerRound), solo cuántos se DIBUJAN.
const ELIM_RESULT_DISPLAY_CAP = 5;

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

// ALERTAS DE REGALOS: un combo de TikTok ya llega consolidado (ver
// handleGiftEvent, que espera `repeatEnd`), pero un espectador puede mandar
// el MISMO regalo varias veces seguidas como envíos separados (sin ser un
// combo nativo de TikTok) — sin este margen, cada envío dispararía su
// propia alerta apilada encima de la anterior. Mismo mecanismo de
// "asentamiento" que TAPTAP_SETTLE_MS (ver processGiftAlert/
// settleAlertCombo): cada envío nuevo del mismo regalo por la misma
// persona reinicia la cuenta regresiva y suma al total, y recién cuando
// pasan ALERT_COMBO_SETTLE_MS sin un envío nuevo se dispara UNA sola
// alerta con el total acumulado.
const ALERT_COMBO_SETTLE_MS = 700;

// ENTRADAS/INSTA-WIN POR VALOR (Rey del Trono/Eliminación/Ruleta): pedido
// explícito — los regalos de un mismo espectador solo se combinan entre sí
// si llegan separados por GIFT_ACCUMULATE_WINDOW_MS o menos; si pasa más
// tiempo que eso desde su último regalo, lo acumulado hasta ahora se
// pierde y el siguiente regalo arranca una cuenta nueva de cero. A
// diferencia de TAPTAP_SETTLE_MS/ALERT_COMBO_SETTLE_MS (esperan el
// silencio para recién ahí actuar), acá se evalúa el umbral EN CADA
// regalo nuevo con el total acumulado hasta ese momento — ver
// accumulateGiftCoins/processGiftKing/processGiftElim/processGiftRoulette.
const GIFT_ACCUMULATE_WINDOW_MS = 10000;

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

// Espejo del catálogo de frontend/src/ThemeContext.jsx: valida lo que manda
// el cliente antes de guardarlo/emitirlo, para que un socket manipulado a
// mano no pueda meter un valor arbitrario en --theme-style/--accent.
const VALID_THEME_STYLES = ['default', 'cute'];
const VALID_THEME_ACCENTS = ['purple', 'blue', 'pink', 'custom'];

// Espejo de frontend/src/overlayCustomization.js: qué overlays se pueden
// personalizar (fondo + color de nombre de usuario) desde la pestaña
// Overlays, y qué valores son válidos para cada campo — mismo criterio que
// VALID_THEME_STYLES/VALID_THEME_ACCENTS, para que un socket manipulado a
// mano no pueda meter un `background` con CSS arbitrario.
const OVERLAY_CUSTOMIZE_IDS = ['games', 'colors', 'taptap', 'gifter', 'extensible', 'musicqueue'];
const VALID_BG_TYPES = ['transparent', 'solid', 'gradient', 'rainbow'];
const VALID_USERNAME_COLOR_TYPES = ['default', 'theme', 'custom', 'gradient', 'rainbow'];
const VALID_FONT_SIZES = ['normal', 'large', 'xlarge'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeHexColor(value, fallback) {
    return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

// Sanea el mapa completo que manda el panel (ver set_overlay_customization
// más abajo) — cualquier id/campo inválido o faltante cae al default en vez
// de rechazar todo el mensaje, para que un solo overlay mal formado no tire
// abajo la personalización de los demás.
function sanitizeOverlayCustomization(raw) {
    const out = {};
    for (const id of OVERLAY_CUSTOMIZE_IDS) {
        const entry = raw?.[id] || {};
        const bg = entry.background || {};
        const uc = entry.usernameColor || {};
        out[id] = {
            background: {
                type: VALID_BG_TYPES.includes(bg.type) ? bg.type : 'solid',
                from: sanitizeHexColor(bg.from, '#7C3AED'),
                to: sanitizeHexColor(bg.to, '#3B82F6'),
            },
            usernameColor: {
                type: VALID_USERNAME_COLOR_TYPES.includes(uc.type) ? uc.type : 'default',
                color: sanitizeHexColor(uc.color, '#FFFFFF'),
                from: sanitizeHexColor(uc.from, '#7C3AED'),
                to: sanitizeHexColor(uc.to, '#3B82F6'),
                fontSize: VALID_FONT_SIZES.includes(uc.fontSize) ? uc.fontSize : 'normal',
            },
        };
    }
    return out;
}

// ==========================================
// Tenant: encapsula TODO lo que antes era estado global de server.js,
// una instancia por licencia activa. Cada tenant tiene su propio Rey del
// Trono / Zubastinis / Eliminación / conexión a TikTok, y sus broadcasts
// van únicamente al room de Socket.io de esa licencia (this.broadcast).
// La lógica de juego es la misma de siempre; lo único que cambia es que
// vive en `this` en vez de en variables de módulo.
// ==========================================
class Tenant {
    constructor(licenseId, io, licenseType) {
        this.licenseId = licenseId;
        this.io = io;
        this.licenseType = licenseType;

        // ── REY DEL TRONO (KING) ──
        this.contestState = {
            isActive: false, mode: 'idle', paused: false,
            targetGiftName: 'Rose', targetGiftIcon: '', targetGiftCoins: 0,
            instaWinGiftName: '', instaWinGiftIcon: '', instaWinGiftCoins: 0,
            mainTime: 15, snipeTime: 5, timeLeft: 0, lastParticipant: null, winner: null
        };
        this.kingTimerInterval = null;
        // Acumuladores por espectador para entradas/insta-win por valor (ver
        // GIFT_ACCUMULATE_WINDOW_MS/accumulateGiftCoins/processGiftKing) —
        // { [username]: { total, lastAt, grantedUnits } }. Separados entre sí
        // (target vs insta-win) porque cada uno compara contra un umbral
        // distinto y se reinicia en momentos distintos.
        this.kingTargetAccum = {};
        this.kingInstaWinAccum = {};

        // ── ZUBASTINIS (TOP 3 GIFTERS) ──
        this.zubState = {
            isActive: false, mode: 'idle', paused: false, // idle | main | snipe | tiebreak | finished
            mainTime: 60, snipeTime: 15, tiebreakTime: 15, minCoins: 0, // minCoins 0 = NO MINIMUM
            timeLeft: 0,
            leaderboard: {}, // { [username]: { username, avatar, coins } }
            winner: null, noWinnerReason: null, // null | 'minimum' | 'no_gifts'
            tiebreakUsernames: [], // quiénes están empatados en el primer puesto durante 'tiebreak'
        };
        this.zubTimerInterval = null;

        // ── ELIMINACIÓN ──
        this.elimState = {
            isActive: false, mode: 'idle', paused: false, // idle | joining | revealing | result | rejoin | finished
            targetGiftName: '', targetGiftIcon: '', targetGiftCoins: 0,
            instaWinGiftName: '', instaWinGiftIcon: '', instaWinGiftCoins: 0,
            baseTime: 60, rejoinTime: 20, timeLeft: 0,
            // fastMode: fases de 1s en vez de 2s (ver REVEAL_SELECT_MS/
            // REVEAL_RESULT_MS). eliminationsPerRound: cuántos slots caen
            // por ronda de sorteo (antes siempre 1). lockedMode: si está
            // activo, solo entra gente durante 'joining' — nadie se suma
            // ya empezada la dinámica (ver processGiftElim).
            fastMode: false, eliminationsPerRound: 1, lockedMode: false,
            participants: [], // [{ id, username, avatar }]
            revealTargetIds: [], // slots sorteados en la ronda de 'revealing' actual
            lastEliminatedList: [], // [{ username, avatar, final }] de la última ronda ya resuelta
            winner: null,
        };
        this.elimTimerInterval = null;
        this.elimSlotCounter = 0;
        this.elimRevealTimeout = null;
        this.elimResultTimeout = null;
        // Ver comentario de kingTargetAccum/kingInstaWinAccum más arriba.
        this.elimEntryAccum = {};
        this.elimInstaWinAccum = {};

        // ── RULETA (sorteo por comentario o por regalo) ──
        // entryMode 'chat': comenta la keyword (opcionalmente solo
        // seguidores) = una vida, una por username. entryMode 'gift': manda
        // el regalo configurado = una vida por cada unidad (slots, igual que
        // Eliminación). El giro es azar genuino sobre TODA la lista barajada
        // — ver shuffleArray/beginRouletteSpin — la "posición ganadora" solo
        // dice EN QUÉ LUGAR del sorteo aparece la ganadora, no la elige de
        // antemano.
        this.rouletteState = {
            isActive: false, mode: 'idle', paused: false, // idle | joining | spinning | result | finished
            entryMode: 'chat', keyword: '', entryWindowSec: 300,
            targetGiftName: '', targetGiftIcon: '', targetGiftCoins: 0,
            winnerRule: 'first', winnerPosition: 1, // 'first' | 'last' | 'position'
            timeLeft: 0,
            // Mismo criterio que elimState (ver comentario ahí): fastMode
            // reduce las fases de selección/resultado a la mitad,
            // eliminationsPerRound agrupa varias eliminaciones por paso.
            // Sin lockedMode a propósito (pedido explícito, se sacó del panel):
            // en Ruleta las entradas YA solo se aceptan durante 'joining' tanto
            // en modo Chat como en modo Gift (nunca hubo forma de
            // sumarse tarde), así que este modo siempre está "trabado".
            fastMode: false, eliminationsPerRound: 1,
            entries: [], // [{ id, username, avatar }]
            revealOrder: [], winnerIndex: -1, revealCursor: 0, revealTargetIndexes: [], // solo durante 'spinning'/'result'
            // currentSpinIndex: a quién apunta el giro EN ESTE MOMENTO dentro
            // del batch (índice absoluto en revealOrder, null si no está
            // girando); spinQueue: los que todavía faltan girar del batch
            // actual — ver beginRouletteSubSpin/resolveRouletteBatch.
            currentSpinIndex: null, spinQueue: [],
            lastEliminatedList: [], winner: null,
        };
        this.rouletteTimerInterval = null;
        this.rouletteSlotCounter = 0;
        // Ver comentario de kingTargetAccum/kingInstaWinAccum más arriba. Sin
        // insta-win propio, así que solo hace falta el de entradas.
        this.rouletteEntryAccum = {};
        this.rouletteRevealTimeout = null;

        // ── TOP GIFTER (ranking continuo de regalos) ──
        // A diferencia de Zubastinis (partida con inicio/fin y ganador), este
        // es un contador corrido: suma mientras dure la conexión al LIVE y
        // solo se reinicia a mano (reset_gifter_leaderboard) — vive en su
        // propio overlay (?screen=gifter), no en el selector de activeApp.
        this.gifterState = { leaderboard: {} }; // { [username]: { username, avatar, coins } }

        // ── TOP TAP-TAP (ranking continuo de likes, con detección de ráfaga) ──
        // `leaderboard` es lo ya "asentado" (lo que se muestra en el
        // overlay); `pendingByUser` es la ráfaga en curso de cada usuario,
        // estado puramente interno que nunca se manda por socket (ver
        // processLikeTapTap/settleTapTap).
        this.tapTapState = { leaderboard: {} }; // { [username]: { username, avatar, likes } }
        this.tapTapPending = {}; // { [username]: { avatar, likes, timer } }
        // Diagnóstico (pedido explícito, reporte de bug: "solo registra 1-2
        // usuarios de forma intermitente") — cuenta CADA evento 'like' crudo
        // que llega de TikTok, sin importar si pasa los filtros de
        // handleLikeEvent, para poder distinguir en vivo si el problema es
        // de RECEPCIÓN (TikTok/la librería no manda los eventos de más
        // usuarios) o de PROCESAMIENTO (los recibimos pero algo los
        // descarta acá). Se resetea junto con el ranking (ver
        // reset_taptap_leaderboard) y con cada nueva conexión a TikTok.
        this.tapTapDiagnostics = { totalReceived: 0, totalSettled: 0, distinctUsers: new Set(), lastEventAt: null, lastEventUsername: null, lastSettledAt: null };
        this.tapTapDiagnosticsBroadcastTimer = null;

        // ── MODO EXTENSIBLE (cuenta regresiva que crece con follows y regalos) ──
        // Arranca en `baseTime` y cada follow/regalo detectado le suma
        // segundos — pensado para dinámicas tipo "subathon". `secondsPerGift`
        // se aplica POR UNIDAD del combo (repeatCount), igual que Ruleta en
        // modo regalo. Tiene su propio overlay horizontal (?screen=extensible),
        // no participa del selector de activeApp.
        this.extensibleState = {
            isActive: false, finished: false, paused: false,
            baseTime: 60, secondsPerFollow: 5, secondsPerGift: 3,
            // reverseMode: pedido explícito ("Extensible Inverso") — invierte
            // el efecto de follows/regalos, que RESTAN en vez de sumar tiempo.
            // El paso natural del segundero (ver startExtensibleTimer) sigue
            // restando siempre igual, no depende de esto.
            reverseMode: false,
            timeLeft: 0,
        };
        this.extensibleTimerInterval = null;

        // ── SPOTIFY (cola de canciones vía !play en el chat) ──
        // `queue` guarda TODO lo pedido por chat que todavía no confirmamos
        // como tocado (hasta SPOTIFY_QUEUE_INTERNAL_CAP) — cada entrada
        // lleva `uri` (para cruzarla contra la cola real de Spotify, ver
        // pollSpotifyQueue) y `playing` (si es la que suena ahora mismo).
        // `nowPlaying` (pedido explícito: "el overlay nunca debe estar
        // vacío") es la canción que suena AHORA en Spotify de verdad, la
        // haya pedido alguien por chat o no (ej. el streamer la puso a
        // mano) — se arma en cada poll a partir de `currently_playing`, ver
        // pollSpotifyQueue. `queueCounter` arma ids únicos para el key de
        // React del overlay, igual que rouletteSlotCounter. `pollInterval`
        // es el timer del polling: antes arrancaba solo con el primer
        // !play y se apagaba con la cola vacía; ahora también arranca solo
        // con tener una cuenta de Spotify conectada (ver
        // maybeStartSpotifyPolling), para poder mostrar "now playing"
        // aunque nadie haya pedido nada todavía.
        this.spotifyQueueState = { queue: [], nowPlaying: null };
        this.spotifyQueueCounter = 0;
        this.spotifyPollInterval = null;
        // Quién puede usar !play/!skip — mismo criterio visual que TTS
        // (allUsers anula todo lo demás; moderators y fanMembers+minFanLevel
        // se combinan con OR). `enabled` es el apagado general del comando:
        // en false, !play no hace nada ni para el streamer mismo.
        // `maxQueueSize`: cuántas canciones se muestran en el overlay como
        // mucho — pedido explícito de que sea configurable, para no dejar
        // que la lista visible crezca sin límite en pantalla.
        this.spotifySettings = { enabled: true, allUsers: false, moderators: true, fanMembers: false, minFanLevel: 1, maxQueueSize: SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT };

        // ── ALERTAS DE REGALOS ──
        // Config guardada en DB (ver db.js/server.js — se edita subiendo un
        // archivo por HTTP, no por socket), cacheada acá en memoria para no
        // pegarle a la base en cada regalo que llega. `alertConfigs` mapea
        // nombre de regalo (en minúscula) -> { id, mediaUrl, mediaType,
        // durationMs, position }. server.js llama a setAlertConfig/
        // removeAlertConfig justo después de guardar/borrar en la DB, así
        // el cache nunca queda desactualizado sin tener que releer todo.
        this.alertConfigs = {};
        this.alertConfigsLoaded = false;
        this.alertTriggerCounter = 0;
        // Combos en curso sin asentar todavía (ver ALERT_COMBO_SETTLE_MS /
        // processGiftAlert/settleAlertCombo) — { [username:giftName]: { alert, count, timer } }.
        this.pendingAlertCombos = {};

        // Estado para el overlay multi-app (Rey del Trono / Zubastinis /
        // Eliminación / Ruleta, elegidos con set_active_app). Color Says no
        // participa de este selector: tiene su propio overlay aparte
        // (?screen=colors, ver DiceOverlay.jsx) que se sincroniza con
        // diceState más abajo.
        this.activeApp = 'king';

        // ── TEMA (material + acento) ──
        // El panel de control elige un "skin"; el overlay de OBS lo replica
        // en tiempo real por este mismo canal, porque el overlay corre en un
        // navegador aparte (la ventana de OBS) que nunca comparte localStorage
        // con el panel — sin este broadcast, el streamer sería la única
        // persona que ve el tema elegido. No persiste en disco a propósito
        // (mismo criterio que `prizes`): vive mientras el tenant está en
        // memoria, se resetea a `default`/`purple` si el server reinicia.
        this.theme = { style: 'default', accent: 'purple', customColor: '#7C3AED' };

        // Fondo (transparente/sólido del tema/degradado) + color del nombre
        // de usuario (predeterminado/arcoíris/personalizado) por overlay —
        // mismo criterio de "vive en memoria, cliente-autoritativo" que
        // `theme` de arriba: el panel manda el mapa completo cada vez que
        // cambia algo (ver set_overlay_customization), acá solo se guarda y
        // reenvía tal cual al overlay de OBS.
        this.overlayCustomization = sanitizeOverlayCustomization({});

        // ── COLOR SAYS (dados) ──
        // Client-autoritativo, igual que `theme`/`prizes`: el panel de
        // control tira los dados y decide el resultado (con su propia
        // lógica de Safe Mode), acá solo se reenvía tal cual al overlay
        // especial de Colores para que la audiencia vea lo mismo en vivo.
        this.diceState = { diceCount: 4, diceResult: [], rolling: false };

        // ── PREMIO (compartido entre Rey del Trono / Zubastinis /
        // Eliminación / Ruleta) ──
        // { title, image } (image: data URL chico, ≤ ~100px de lado,
        // redimensionado en el cliente) o null. UN solo premio para los
        // cuatro modos a propósito — pedido explícito: cargarlo una vez
        // desde cualquiera de ellos (ver PrizeEditor.jsx) lo aplica a los
        // demás sin tener que repetir la misma imagen/texto en cada uno.
        // Vive fuera de los estados de juego a propósito: sobrevive a
        // start/stop.
        this.prize = null;

        // ── CONEXIÓN TIKTOK (una por tenant) ──
        this.tiktokConnection = null;
        this.currentTikTokUsername = null;
        this.liveConnected = false;
        this.connectingPromise = null;
        this.retryTimeout = null;
        this.desiredUsername = null;
        // Si esta conexión llegó a estar en vivo ALGUNA VEZ (ver
        // ensureTikTokConnection/getTikTokConnectionErrorMessage) — distingue
        // "todavía no arrancó el LIVE" (reintentar para siempre tiene
        // sentido, el streamer puede estar por salir) de "el LIVE YA
        // terminó" (reintentar con el mismo username para siempre solo
        // repite el mismo error sin parar — ver el aviso de "offline" más
        // abajo). Se resetea a false en disconnectTikTok (conexión nueva de
        // cero) y en cuanto se confirma el próximo `live_connected`.
        this.wasEverConnected = false;
    }

    // Broadcast scopeado: reemplaza los antiguos io.emit(...) globales.
    get broadcast() {
        return this.io.to(this.licenseId);
    }

    // ==========================================
    // CONEXIÓN TIKTOK
    // ==========================================
    anyContestNeedsConnection() {
        return this.contestState.isActive || this.zubState.isActive || this.elimState.isActive || this.rouletteState.isActive || this.extensibleState.isActive || !!this.desiredUsername;
    }

    disconnectTikTok() {
        if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }
        if (this.tiktokConnection) {
            this.tiktokConnection.removeAllListeners();
            this.tiktokConnection.disconnect();
        }
        this.tiktokConnection = null;
        this.currentTikTokUsername = null;
        this.liveConnected = false;
        this.connectingPromise = null;
        this.wasEverConnected = false;

        // Ráfagas de tap-tap en curso quedan huérfanas si la conexión se cae
        // a mitad de una: sin esto, sus timers seguirían vivos apuntando a
        // un tenant que ya no está escuchando likes.
        Object.values(this.tapTapPending).forEach((p) => clearTimeout(p.timer));
        this.tapTapPending = {};

        // Mismo criterio: un combo de alerta a medio asentar no debe quedar
        // con un timer vivo apuntando a una conexión que ya se cerró.
        Object.values(this.pendingAlertCombos).forEach((p) => clearTimeout(p.timer));
        this.pendingAlertCombos = {};

        // Acumuladores de entradas/insta-win por valor (ver
        // GIFT_ACCUMULATE_WINDOW_MS) — sin timers propios que limpiar, pero
        // se descartan igual: si la conexión se cortó, cualquier
        // acumulación a medio camino no debería sobrevivir a una
        // reconexión con un LIVE distinto.
        this.kingTargetAccum = {};
        this.kingInstaWinAccum = {};
        this.elimEntryAccum = {};
        this.elimInstaWinAccum = {};
        this.rouletteEntryAccum = {};
    }

    maybeDisconnectTikTok() {
        if (!this.anyContestNeedsConnection()) this.disconnectTikTok();
    }

    // Bug crítico corregido a propósito (pedido explícito): cuando el LIVE
    // se corta de verdad (ver el `live_stream_ended` que dispara esto,
    // justo después de confirmar con isUserOfflineError/wasEverConnected
    // en ensureTikTokConnection), CUALQUIER modo que haya quedado activo
    // se detiene solo, como si el streamer hubiera tocado "Detener" — antes
    // se quedaban "activos" para siempre sin ganador, y como el panel
    // bloquea la edición mientras algo está activo, no había forma de
    // arrancar una partida nueva hasta reiniciar el proceso entero. Cada
    // stopX ya revisa/limpia su propio estado — acá solo hace falta
    // llamarlos, sin duplicar lógica.
    stopAllActiveGames() {
        if (this.contestState.isActive) this.stopKingContest();
        if (this.zubState.isActive) this.stopZubastinis();
        if (this.elimState.isActive) this.stopElimination();
        if (this.rouletteState.isActive) this.stopRoulette();
        if (this.extensibleState.isActive) this.stopExtensible();
    }

    // Pedido explícito ("Reinicio automático de overlays al establecer una
    // nueva conexión con TikTok"): los rankings continuos (Top Gifter, Top
    // Tap-Tap — antes solo se reiniciaban a mano, ver
    // reset_gifter_leaderboard/reset_taptap_leaderboard) y la cola de
    // pedidos de Spotify por chat no deben arrastrar datos de un directo
    // anterior. Se llama SOLO en una conexión genuinamente nueva (ver el
    // chequeo de wasEverConnected en ensureTikTokConnection) — nunca en una
    // reconexión automática tras un corte transitorio sobre el MISMO
    // directo, ni al desconectarse (a propósito: el streamer puede querer
    // ver el ranking final antes de arrancar de nuevo), ni en un simple
    // refresh de página (el estado vive acá, no en el navegador).
    //
    // A propósito NO toca los modos de juego (Rey del Trono, Zubastinis,
    // Eliminación, Ruleta, Extensible): esos ya se frenan solos en cuanto
    // se confirma que el LIVE anterior terminó de verdad (ver
    // stopAllActiveGames más arriba) y cada uno arranca con su propio
    // estado limpio al presionar "Iniciar" — llamar a stopAllActiveGames()
    // acá de nuevo pisaría una partida que el streamer arranca justo
    // AHORA, ya que en varios flujos arrancar una partida es lo que
    // dispara esta misma conexión. Tampoco toca `nowPlaying` de
    // Spotify (la canción sonando de verdad no depende de la sesión de
    // TikTok) ni ninguna configuración/preferencia (temas, presets de voz,
    // etc.).
    resetContinuousStateForNewSession() {
        this.gifterState.leaderboard = {};
        this.broadcast.emit('gifter_state_update', this.getGifterPublicState());

        Object.values(this.tapTapPending).forEach((p) => clearTimeout(p.timer));
        this.tapTapPending = {};
        this.tapTapState.leaderboard = {};
        if (this.tapTapDiagnosticsBroadcastTimer) { clearTimeout(this.tapTapDiagnosticsBroadcastTimer); this.tapTapDiagnosticsBroadcastTimer = null; }
        this.tapTapDiagnostics = { totalReceived: 0, totalSettled: 0, distinctUsers: new Set(), lastEventAt: null, lastEventUsername: null, lastSettledAt: null };
        this.broadcast.emit('taptap_state_update', this.getTapTapPublicState());
        this.broadcast.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());

        this.spotifyQueueState.queue = [];
        this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
    }

    scheduleReconnect(username) {
        if (!this.anyContestNeedsConnection()) return;
        if (this.retryTimeout) clearTimeout(this.retryTimeout);
        this.retryTimeout = setTimeout(() => this.ensureTikTokConnection(username).catch(() => {}), 3000);
    }

    async ensureTikTokConnection(username) {
        if (!username) return Promise.reject(new Error('username requerido'));

        if (this.liveConnected && this.currentTikTokUsername === username) return Promise.resolve();
        if (this.connectingPromise && this.currentTikTokUsername === username) return this.connectingPromise;

        // Anti-abuso de pruebas gratis: se resuelve ANTES de tocar cualquier
        // conexión existente, así un intento rechazado no desconecta nada
        // que ya estuviera andando bien. Una prueba queda atada para
        // siempre al primer usuario de TikTok al que se conecta con éxito
        // (ver db.claimTrialConnection) — 'locked-own' rechaza sin revocar
        // (está usando SU propia prueba con otro usuario, no es abuso
        // cruzado); 'used-by-other' sí revoca: alguien más ya reclamó ese
        // mismo usuario de TikTok con otra prueba antes.
        if (this.licenseType === 'trial') {
            const claim = await db.claimTrialConnection(this.licenseId, username.toLowerCase());
            if (claim === 'locked-own') {
                this.broadcast.emit('live_connection_error', {
                    code: 'TrialLocked',
                    message: 'Esta prueba gratis ya está en uso con otro usuario de TikTok.',
                });
                throw new Error('trial locked to another username');
            }
            if (claim === 'used-by-other') {
                await db.revoke(this.licenseId);
                this.broadcast.emit('live_connection_error', {
                    code: 'TrialAbuse',
                    message: 'Este usuario de TikTok ya se usó en otra prueba gratis. Esta licencia fue revocada.',
                });
                throw new Error('trial tiktok username already used elsewhere');
            }
        }

        if (this.tiktokConnection && this.currentTikTokUsername !== username) {
            this.disconnectTikTok();
        } else if (this.tiktokConnection) {
            // Reconexión al MISMO usuario (ej. tras el 'disconnected' de
            // scheduleReconnect) — a propósito NO se llama a
            // disconnectTikTok() acá: eso borraría tapTapPending/los
            // acumuladores de regalos de una sesión que en los hechos sigue
            // siendo la misma. Pero el objeto de conexión VIEJO sí hay que
            // soltarlo (bug real encontrado revisando el reporte de
            // Tap-Tap): antes quedaba sin dueño, sin listeners removidos ni
            // desconectado explícitamente, al reemplazar la referencia acá
            // abajo por una conexión nueva.
            this.tiktokConnection.removeAllListeners();
            this.tiktokConnection.disconnect();
        }

        this.currentTikTokUsername = username;
        console.log(`[${this.licenseId}] [TIKTOK] 📡 Intentando conectar a @${username}...`);
        // Diagnóstico sin exponer el valor: si esto imprime "false" con la
        // variable YA puesta en Render, el problema es que no está llegando
        // al proceso (nombre mal escrito, falta redeploy, etc.) — no un
        // límite del plan de Euler Stream.
        console.log(`[${this.licenseId}] [TIKTOK] SIGN_API_KEY presente: ${Boolean(process.env.SIGN_API_KEY)}`);

        let timedConnect;
        try {
            // Toda conexión (incluso sin key) pasa por el sign server de
            // Euler Stream para firmar el WebSocket — SIGN_API_KEY es
            // opcional (hay un tier gratis sin key), pero sin ella se
            // comparte el pool de límites "comunidad", que puede estar
            // saturado/lento para IPs de datacenter como las de Render.
            // Pasarla acá (en vez de solo por env var) es la forma que la
            // propia librería documenta como más confiable, porque
            // SignConfig es un singleton que se cachea la primera vez que
            // se usa.
            this.tiktokConnection = new WebcastPushConnection(username, {
                // El free tier de Euler Stream no cubre la ruta de firma
                // cuando se pide info extendida de regalos (probado: con
                // esto en `true` el connect() rechaza siempre con
                // "This endpoint requires a Business plan"). Nuestro
                // handleGiftEvent nunca lee `extendedGiftInfo` — solo usa
                // los campos base del regalo (giftName, diamondCount,
                // repeatCount), que llegan igual sin esto.
                enableExtendedGiftInfo: false,
                // Bug de esta versión de la librería: con el valor por
                // defecto (true), procesar el lote inicial de datos del
                // connect() revienta con un TypeError propio de la capa de
                // compatibilidad (getTopViewerAttributes lee `.map` de un
                // campo undefined). No perdemos nada relevante: ese lote es
                // solo historial reciente de chat al momento de conectar,
                // no eventos en vivo hacia adelante.
                processInitialData: false,
                signApiKey: process.env.SIGN_API_KEY || undefined,
            });
            this.tiktokConnection.on('gift', (data) => this.handleGiftEvent(data));
            this.tiktokConnection.on('chat', (data) => this.handleChatEvent(data));
            this.tiktokConnection.on('like', (data) => this.handleLikeEvent(data));
            this.tiktokConnection.on('social', (data) => this.handleSocialEvent(data));
            this.tiktokConnection.on('error', ({ info, exception } = {}) => {
                const message = exception?.message || info || 'Error interno del conector';
                console.error(`[${this.licenseId}] [TIKTOK] ⚠️ ${message}`);
            });
            this.tiktokConnection.on('disconnected', () => {
                console.log(`[${this.licenseId}] [TIKTOK] 🔌 Desconectado de @${username}`);
                this.liveConnected = false;
                this.broadcast.emit('live_disconnected');
                this.scheduleReconnect(username);
            });

            // Sin este timeout propio, un connect() colgado (ver comentario
            // de TIKTOK_CONNECT_TIMEOUT_MS) deja al panel esperando para
            // siempre. El try/catch de acá afuera es porque, si algo de lo
            // de arriba (constructor o el arranque de connect()) revienta
            // de forma SÍNCRONA, antes se perdía en silencio: una excepción
            // síncrona dentro de un método async se convierte en promesa
            // rechazada, y todos los que llaman a ensureTikTokConnection lo
            // atrapan con `.catch(() => {})` sin loguear nada — por eso no
            // se veía ni ✅ ni ❌ después de "Intentando conectar...".
            timedConnect = Promise.race([
                this.tiktokConnection.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new TikTokConnectTimeoutError()), TIKTOK_CONNECT_TIMEOUT_MS)),
            ]);
        } catch (err) {
            console.error(`[${this.licenseId}] [TIKTOK] ❌ Error sincrónico al armar la conexión:`, err);
            this.connectingPromise = null;
            this.liveConnected = false;
            this.broadcast.emit('live_connection_error', {
                code: err?.name || 'ConnectionSetupError',
                message: this.getTikTokConnectionErrorMessage(err),
            });
            this.scheduleReconnect(username);
            return Promise.reject(err);
        }

        this.connectingPromise = timedConnect.then(() => {
            console.log(`[${this.licenseId}] [TIKTOK] ✅ ¡CONECTADO!`);
            // Ver el comentario de resetContinuousStateForNewSession: si
            // wasEverConnected sigue en false acá, esta conexión es
            // genuinamente nueva (no una reconexión automática sobre el
            // mismo directo — ver 'Reconexión al MISMO usuario' más
            // arriba, que a propósito nunca toca esta bandera).
            if (!this.wasEverConnected) {
                this.resetContinuousStateForNewSession();
            }
            this.liveConnected = true;
            this.wasEverConnected = true;
            this.connectingPromise = null;
            this.broadcast.emit('live_connected', username);
        }).catch(err => {
            console.error(`[${this.licenseId}] [TIKTOK] ❌ Error: ${err.message}`);
            this.connectingPromise = null;
            this.liveConnected = false;
            // El WebSocket que se quedó colgado sigue ahí atrás: lo tiramos
            // para que el próximo intento arranque de cero, no arriba de la
            // conexión zombie anterior.
            if (err instanceof TikTokConnectTimeoutError && this.tiktokConnection) {
                this.tiktokConnection.removeAllListeners();
                this.tiktokConnection.disconnect();
                this.tiktokConnection = null;
            }
            this.broadcast.emit('live_connection_error', {
                code: err?.name || 'ConnectionError',
                message: this.getTikTokConnectionErrorMessage(err),
            });
            // El LIVE llegó a estar conectado de verdad y AHORA TikTok
            // confirma que esta cuenta ya no está transmitiendo -> el
            // streamer terminó su transmisión. Reintentar con el mismo
            // username para siempre solo repetiría este mismo error sin
            // parar (pedido explícito a arreglar) — se corta el reintento
            // automático, se libera `desiredUsername` (deja el campo
            // editable en el panel, ver `live_stream_ended` en App.jsx) y
            // arranca de cero para la PRÓXIMA vez que se ponga un username.
            // Si nunca llegó a conectar (`wasEverConnected` false), puede
            // ser que el streamer todavía no salió al aire — ahí sí vale la
            // pena seguir reintentando solo, como siempre.
            if (this.wasEverConnected && this.isUserOfflineError(err)) {
                console.log(`[${this.licenseId}] [TIKTOK] 🛑 @${username} ya no está en vivo — se corta el reintento automático.`);
                this.wasEverConnected = false;
                this.desiredUsername = null;
                // Bug crítico corregido a propósito: cualquier modo que
                // haya quedado activo se detiene solo (ver
                // stopAllActiveGames) — sin esto, el panel se quedaba
                // bloqueado para siempre esperando un ganador que ya nunca
                // iba a llegar.
                this.stopAllActiveGames();
                this.broadcast.emit('live_stream_ended', { username });
                this.maybeDisconnectTikTok();
                throw err;
            }
            this.scheduleReconnect(username);
            throw err;
        });

        return this.connectingPromise;
    }

    isUserOfflineError(error) {
        const raw = String(error?.message || '').toLowerCase();
        return error?.name === 'UserOfflineError' || raw.includes("isn't online") || raw.includes('offline');
    }

    getTikTokConnectionErrorMessage(error) {
        const raw = String(error?.message || '').toLowerCase();
        if (error instanceof TikTokConnectTimeoutError) {
            return `La conexión no respondió a tiempo (¿estás en vivo ahora mismo?). Si esto se repite seguido aunque sí estés en vivo, puede deberse a que TikTok está bloqueando las conexiones directas desde este servidor — configurar una API key de Euler Stream (variable de entorno SIGN_API_KEY, gratis en eulerstream.com) suele evitarlo.`;
        }
        if (this.isUserOfflineError(error)) {
            return 'TikTok indica que esta cuenta no está transmitiendo en vivo.';
        }
        if (raw.includes('rate limit') || raw.includes('too many') || raw.includes('429')) {
            return 'Euler Stream alcanzó su límite de conexiones. Se volverá a intentar automáticamente.';
        }
        if (raw.includes('permission') || raw.includes('api key') || raw.includes('sign') || raw.includes('euler')) {
            return 'No se pudo firmar la conexión con Euler Stream. Revisa su servicio o configura una API key.';
        }
        if (raw.includes('room id') || raw.includes('uniqueid') || raw.includes('unique id')) {
            return 'No se pudo encontrar la sala LIVE. Revisa el username exacto de TikTok.';
        }
        if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('network')) {
            return 'TikTok o Euler Stream no respondieron a tiempo. Se volverá a intentar automáticamente.';
        }
        return error?.message ? String(error.message).slice(0, 180) : 'No se pudo conectar al LIVE. Se volverá a intentar.';
    }

    // ==========================================
    // DESPACHO ÚNICO DE REGALOS -> CADA MÓDULO DECIDE SI LE INTERESA
    // ==========================================
    handleGiftEvent(data) {
        // Nombres de campo verificados decodificando el protobuf real de
        // esta versión de la librería (WebcastGiftMessage/Gift): el tipo
        // combo-able es `type` (no `giftType`) y el nombre del regalo es
        // `name` (no `giftName`) — quedaron mal desde antes, no es una
        // regresión de este cambio. El avatar sale de `profilePictureUrl`
        // (singular, ya resuelto a una sola URL por la librería), no de
        // `userDetails.profilePictureUrls` (que en esta versión es un
        // string, no un array — indexarlo con [0] agarraba un carácter
        // suelto en vez de la URL).
        if (data.type === 1 && !data.repeatEnd) return; // esperar a que termine el combo

        const event = {
            username: data.uniqueId,
            avatar: data.profilePictureUrl || '',
            giftName: data.name || '',
            diamondCount: data.diamondCount || 0,
            repeatCount: data.repeatCount || 1,
            followRole: data.followRole,
        };
        event.totalCoins = event.diamondCount * event.repeatCount;

        this.processGiftKing(event);
        this.processGiftZub(event);
        this.processGiftElim(event);
        this.processGiftRoulette(event);
        this.processGiftGifterBoard(event);
        this.processGiftExtensible(event);
        this.processGiftAlert(event);
    }

    // ==========================================
    // LÓGICA: ALERTAS DE REGALOS
    // ==========================================
    // Se llama una sola vez (ver attachSocket) — sin await ahí a propósito,
    // no tiene sentido bloquear la sincronización del resto del panel por
    // esto. Ventana mínima real: un regalo que llegue en los primeros
    // milisegundos de la primera conexión podría no disparar su alerta
    // todavía si la consulta a la DB no terminó — aceptable, mismo criterio
    // que otras esperas cortas ya existentes en este archivo.
    async loadAlertConfigs() {
        if (this.alertConfigsLoaded) return;
        this.alertConfigsLoaded = true;
        try {
            const rows = await db.listAlertConfigs(this.licenseId);
            rows.forEach((row) => {
                this.alertConfigs[row.gift_name.toLowerCase()] = {
                    id: row.id, giftName: row.gift_name, mediaUrl: row.media_url,
                    mediaType: row.media_type, durationMs: row.duration_ms, position: row.position,
                    entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
                };
            });
        } catch (err) {
            console.error(`[${this.licenseId}] [ALERTAS] No se pudieron cargar las alertas guardadas:`, err.message);
        }
    }

    // Llamados desde server.js justo después de guardar/borrar en la DB —
    // mantienen este cache en memoria al día sin tener que releer todo.
    setAlertConfig(giftName, alertData) {
        this.alertConfigs[giftName.toLowerCase()] = alertData;
    }

    removeAlertConfig(giftName) {
        delete this.alertConfigs[giftName.toLowerCase()];
    }

    // Un regalo puede combo-ear (repeatCount > 1) sin que eso deba disparar
    // la alerta varias veces seguidas — handleGiftEvent ya esperó a que
    // termine el combo NATIVO de TikTok, pero un espectador puede además
    // mandar el mismo regalo varias veces seguidas como envíos SEPARADOS
    // (sin ser un combo de TikTok) — acá se agrupan esos también, por
    // persona+regalo, con el mismo mecanismo de asentamiento que Top
    // Tap-Tap (ver ALERT_COMBO_SETTLE_MS/settleAlertCombo): nunca se
    // apilan dos alertas del mismo regalo+persona, se combinan en una
    // sola con el total.
    processGiftAlert({ username, giftName, repeatCount }) {
        if (!giftName) return;
        const alert = this.alertConfigs[giftName.toLowerCase()];
        if (!alert) return;
        const key = `${username || ''}:${giftName.toLowerCase()}`;
        const units = Math.max(1, repeatCount || 1);
        const pending = this.pendingAlertCombos[key];
        if (pending) {
            pending.count += units;
            clearTimeout(pending.timer);
        } else {
            this.pendingAlertCombos[key] = { alert, count: units, timer: null };
        }
        this.pendingAlertCombos[key].timer = setTimeout(() => this.settleAlertCombo(key), ALERT_COMBO_SETTLE_MS);
    }

    // El combo terminó (silencio de ALERT_COMBO_SETTLE_MS): recién acá se
    // dispara la alerta, ya con el total acumulado en `count` — el overlay
    // (ver AlertOverlay en Overlay.jsx) muestra "×N" cuando count > 1.
    settleAlertCombo(key) {
        const pending = this.pendingAlertCombos[key];
        if (!pending) return;
        delete this.pendingAlertCombos[key];
        this.broadcast.emit('alert_triggered', {
            triggerId: ++this.alertTriggerCounter,
            mediaUrl: pending.alert.mediaUrl,
            mediaType: pending.alert.mediaType,
            durationMs: pending.alert.durationMs,
            position: pending.alert.position,
            entranceAnim: pending.alert.entranceAnim,
            exitAnim: pending.alert.exitAnim,
            count: pending.count,
        });
    }

    // Bug real de nombre de campo (mismo patrón que gift/badge, confirmado
    // decodificando el protobuf real de WebcastLikeMessage): el conteo de
    // ESTE tick es `count`, no `likeCount` — ese campo no existe en el
    // mensaje, así que Number(undefined) siempre daba 0 y CADA like se
    // descartaba antes de llegar al acumulador (por eso Top Tap-Tap nunca
    // sumaba ni un solo like). `total` también existe pero es el acumulado
    // de todo el directo que ya mantiene TikTok — no sirve para nuestro
    // propio acumulador por ráfaga (ver processLikeTapTap/settleTapTap).
    handleLikeEvent(data) {
        const username = data.uniqueId;
        const likeCount = Number(data.count) || 0;

        // Diagnóstico (ver tapTapDiagnostics): se cuenta el evento CRUDO,
        // llegue o no a sumar algo, para distinguir si el problema es que
        // TikTok/la librería no manda eventos de más usuarios (recepción) o
        // si algo de acá abajo los descarta (procesamiento).
        this.recordTapTapEvent(username, likeCount);

        if (!username || likeCount <= 0) return;

        const avatar = data.profilePictureUrl || '';
        this.processLikeTapTap(username, avatar, likeCount);
    }

    // Bug real de la librería (mismo patrón que gift/like/badges, confirmado
    // en vivo contra @samujuega_): el evento derivado `follow` NUNCA se
    // emite porque legacy.js filtra por `simplifiedObj.displayType?.includes
    // ("follow")`, y `displayType` no existe en absoluto en el protobuf real
    // de WebcastSocialMessage (verificado decodificándolo — sus campos reales
    // son shareType/action/shareTarget/followCount/followType/etc, ninguno
    // llamado displayType). Con dos follows reales capturados en vivo, el
    // campo que sí distingue un follow es `action === "1"` (ambos casos
    // reales tenían action:"1"; TikTok también usa este mensaje para
    // "share", que debería traer un action distinto). Por eso escuchamos
    // 'social' directo en vez de confiar en el 'follow' derivado.
    handleSocialEvent(data) {
        if (!data?.uniqueId) return;
        if (String(data.action) !== '1') return; // no es un follow (ej. share)
        this.processFollowExtensible();
    }

    // Reenviamos únicamente los datos necesarios para que el panel decida
    // qué voces pueden entrar al TTS. La síntesis ocurre en el navegador del
    // streamer; el backend nunca reproduce ni almacena los comentarios.
    handleChatEvent(data) {
        // El texto del comentario viene en `data.content`, no `data.comment`
        // (verificado contra un LIVE real) — con el nombre viejo esto
        // siempre daba string vacío y el chat completo (TTS y Ruleta modo
        // chat) quedaba mudo, sin ningún error visible.
        const comment = typeof data.content === 'string' ? data.content.trim() : '';
        if (!comment) return;

        const badges = Array.isArray(data.userBadges) ? data.userBadges : [];
        const badgeText = badges.map((badge) => [badge.type, badge.name, badge.url].filter(Boolean).join(' ')).join(' ').toLowerCase();
        const identity = data.userIdentity || {};

        // Comandos (!play, etc.) nunca van al TTS — pedido explícito. Se
        // filtran ACÁ (no en el panel) para que ni siquiera crucen el
        // socket como candidato a leerse en voz alta.
        if (!comment.startsWith('!')) {
            this.broadcast.emit('tts_chat_message', {
                id: data.msgId || `${Date.now()}-${data.userId || data.uniqueId || 'chat'}`,
                username: data.nickname || data.uniqueId || 'Usuario',
                comment: comment.slice(0, 300),
                isModerator: Boolean(data.isModerator || identity.isModeratorOfAnchor),
                isSuperFan: badgeText.includes('superfan') || badgeText.includes('super_fan') || badgeText.includes('super fan'),
                isSubscriber: Boolean(data.isSubscriber || identity.isSubscriberOfAnchor),
                fanLevel: Math.max(0, Number(data.teamMemberLevel) || Number(data.user?.fansClubInfo?.fansLevel) || 0),
            });
        }

        this.processPlayCommand(comment, data, identity);
        this.processRouletteComment(data);
    }

    // ==========================================
    // LÓGICA: SPOTIFY (!play/!skip/!revoke)
    // ==========================================
    // `nowPlaying` cubre lo que suena AHORA (lo haya pedido alguien por
    // chat o no) — `queue` son las próximas pedidas por chat, SIN repetir
    // la que ya se muestra en `nowPlaying` (se filtra por `playing` acá).
    getSpotifyQueuePublicState() {
        const upcoming = this.spotifyQueueState.queue.filter((song) => !song.playing);
        return {
            nowPlaying: this.spotifyQueueState.nowPlaying,
            queue: upcoming.slice(0, this.spotifySettings.maxQueueSize || SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT),
        };
    }

    getSpotifySettingsPublicState() {
        return { ...this.spotifySettings };
    }

    // Mismo criterio que TTS (allUsers anula todo lo demás; moderators y
    // fanMembers+minFanLevel se combinan con OR) — ahora configurable desde
    // el panel (ver update_spotify_settings) en vez de una regla fija.
    isAuthorizedForSpotifyCommands(data, identity) {
        const s = this.spotifySettings;
        if (s.allUsers) return true;
        if (s.moderators && Boolean(data.isModerator || identity.isModeratorOfAnchor)) return true;
        if (s.fanMembers) {
            const fanLevel = Math.max(0, Number(data.teamMemberLevel) || Number(data.user?.fansClubInfo?.fansLevel) || 0);
            if (fanLevel >= s.minFanLevel) return true;
        }
        return false;
    }

    // Único punto de entrada para los comandos de Spotify del chat — el
    // interruptor general (`enabled`) los apaga a todos de una, incluido
    // !revoke (si el comando está apagado, ni siquiera vale la pena dejar
    // que alguien "limpie" su propio pedido de una cola que ya no crece).
    // Logueado paso a paso a propósito — el motivo más común de "!play no
    // hace nada" es un permiso que lo rechaza en silencio (por diseño, para
    // no ensuciar el chat), y sin esto ese rechazo no dejaba rastro en
    // ningún lado.
    processPlayCommand(comment, data, identity) {
        const username = data.uniqueId;
        if (!/^!(play|skip|revoke)\b/i.test(comment)) return; // ni siquiera es un comando de Spotify, no logueamos nada

        if (!this.spotifySettings.enabled) {
            console.log(`[${this.licenseId}] [SPOTIFY] "${comment}" de @${username} ignorado — el comando está DESACTIVADO en el panel.`);
            return;
        }
        if (!username) return;

        if (/^!skip\s*$/i.test(comment)) {
            if (!this.isAuthorizedForSpotifyCommands(data, identity)) {
                console.log(`[${this.licenseId}] [SPOTIFY] !skip de @${username} RECHAZADO — no cumple los permisos configurados (settings: ${JSON.stringify(this.spotifySettings)}).`);
                return;
            }
            console.log(`[${this.licenseId}] [SPOTIFY] !skip de @${username} autorizado — saltando canción...`);
            this.skipSpotifyTrack().catch((err) => {
                console.error(`[${this.licenseId}] [SPOTIFY] Error inesperado en !skip de @${username}:`, err.message);
            });
            return;
        }

        if (/^!revoke\s*$/i.test(comment)) {
            console.log(`[${this.licenseId}] [SPOTIFY] !revoke de @${username} — sacando sus pedidos de la lista.`);
            this.revokeSpotifyRequest(username);
            return;
        }

        const match = /^!play\s+(.+)/i.exec(comment);
        if (!match) {
            console.log(`[${this.licenseId}] [SPOTIFY] "${comment}" de @${username} — !play sin texto después, ignorado.`);
            return;
        }
        const query = match[1].trim();
        if (!query) return;
        if (!this.isAuthorizedForSpotifyCommands(data, identity)) {
            console.log(`[${this.licenseId}] [SPOTIFY] !play "${query}" de @${username} RECHAZADO — no cumple los permisos configurados (settings: ${JSON.stringify(this.spotifySettings)}, isModerator: ${data.isModerator}, isSubscriber: ${data.isSubscriber}, teamMemberLevel: ${data.teamMemberLevel}).`);
            return;
        }

        console.log(`[${this.licenseId}] [SPOTIFY] !play "${query}" de @${username} autorizado — buscando en Spotify...`);
        this.requestSpotifySong(username, query).catch((err) => {
            console.error(`[${this.licenseId}] [SPOTIFY] Error inesperado en !play de @${username}:`, err.message);
        });
    }

    // Salta a la siguiente canción en la reproducción REAL de Spotify
    // (POST /me/player/next) — a diferencia de !revoke, esto sí actúa sobre
    // la cola de verdad, no solo sobre nuestra lista de "lo pedido".
    async skipSpotifyTrack() {
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) {
            console.log(`[${this.licenseId}] [SPOTIFY] !skip ignorado — no hay ninguna cuenta de Spotify conectada.`);
            return;
        }
        let accessToken;
        try {
            accessToken = await spotify.getValidAccessToken(account);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] No se pudo renovar el token para !skip:`, err.message);
            this.broadcast.emit('spotify_error', { message: 'Tu conexión con Spotify venció — reconéctala desde el panel.' });
            return;
        }
        try {
            await spotify.skipToNext(accessToken);
            console.log(`[${this.licenseId}] [SPOTIFY] !skip OK.`);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] !skip falló — code: ${err.code || 'N/A'}, mensaje: ${err.message}`);
            this.broadcast.emit('spotify_error', { message: this.describeSpotifyError(err) });
        }
    }

    // OJO — limitación real de la API de Spotify, no una decisión nuestra:
    // no existe ningún endpoint público para sacar una canción puntual de
    // la cola de reproducción. Esto SOLO borra la entrada de nuestra propia
    // lista (la que alimenta el panel/overlay de "pedidas por chat") — la
    // canción puede seguir sonando en su turno igual. Filtra por
    // `requestedBy` a propósito: un usuario nunca puede tocar pedidos de
    // otro (pedido explícito), y de paso queda sin necesidad de permisos
    // extra — si nunca pudo pedir nada, esto no encuentra nada suyo que borrar.
    revokeSpotifyRequest(username) {
        const before = this.spotifyQueueState.queue.length;
        this.spotifyQueueState.queue = this.spotifyQueueState.queue.filter((song) => song.requestedBy !== username);
        if (this.spotifyQueueState.queue.length !== before) {
            this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        }
    }

    // Traduce los errores esperables de la API de Spotify (ver spotify.js)
    // a un mensaje que el streamer entienda — reusado por skip/volumen.
    describeSpotifyError(err) {
        if (err instanceof spotify.SpotifyPlaybackError && err.code === 'NO_ACTIVE_DEVICE') {
            return 'Abre Spotify y dale play en algún dispositivo para poder controlarlo.';
        }
        if (err instanceof spotify.SpotifyPlaybackError && err.code === 'PREMIUM_REQUIRED') {
            return 'Se necesita Spotify Premium para esta acción.';
        }
        return 'No se pudo completar la acción en Spotify.';
    }

    // Busca la canción en Spotify y la agrega a la cola DEL STREAMER (su
    // cuenta conectada, ver /api/spotify/connect). Los errores esperables
    // (sin cuenta conectada, sin dispositivo activo, sin Premium) se
    // reportan al panel vía `spotify_error` — nunca al chat, el streamer es
    // quien decide si lo comenta en vivo o no.
    async requestSpotifySong(username, query) {
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) {
            console.log(`[${this.licenseId}] [SPOTIFY] !play ignorado — no hay ninguna cuenta de Spotify conectada.`);
            return; // streamer no conectó Spotify — !play no hace nada, en silencio
        }

        let accessToken;
        try {
            accessToken = await spotify.getValidAccessToken(account);
            console.log(`[${this.licenseId}] [SPOTIFY] Token OK (renovado si hacía falta).`);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] No se pudo renovar el token para !play:`, err.message);
            this.broadcast.emit('spotify_error', { message: 'Tu conexión con Spotify venció — reconéctala desde el panel.' });
            return;
        }

        const track = await spotify.searchTrack(accessToken, query);
        if (!track) {
            console.log(`[${this.licenseId}] [SPOTIFY] Búsqueda de "${query}" no encontró ninguna canción.`);
            this.broadcast.emit('spotify_error', { message: `@${username} pidió "${query}" — no se encontró ninguna canción.` });
            return;
        }
        console.log(`[${this.licenseId}] [SPOTIFY] Encontrado: "${track.name}" (${(track.artists || []).map((a) => a.name).join(', ')}) — agregando a la cola...`);

        try {
            await spotify.addToQueue(accessToken, track.uri);
            console.log(`[${this.licenseId}] [SPOTIFY] !play OK — agregada a la cola real de Spotify.`);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] addToQueue falló — code: ${err.code || 'N/A'}, mensaje: ${err.message}`);
            this.broadcast.emit('spotify_error', { message: this.describeSpotifyError(err) });
            return;
        }

        this.spotifyQueueState.queue.push({
            id: ++this.spotifyQueueCounter,
            uri: track.uri,
            title: track.name,
            artist: (track.artists || []).map((a) => a.name).join(', '),
            albumArt: track.album?.images?.[track.album.images.length - 1]?.url || '',
            requestedBy: username,
            playing: false,
        });
        if (this.spotifyQueueState.queue.length > SPOTIFY_QUEUE_INTERNAL_CAP) this.spotifyQueueState.queue.shift();
        this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        this.startSpotifyQueuePolling();
    }

    // Arranca el polling contra la cola REAL de Spotify (ver comentario de
    // SPOTIFY_POLL_INTERVAL_MS) — idempotente, no pisa un timer ya
    // corriendo. Antes se apagaba solo en pollSpotifyQueue en cuanto la
    // cola de pedidos quedaba vacía; ahora sigue corriendo mientras haya
    // una cuenta de Spotify conectada, porque el overlay necesita saber
    // qué está sonando AHORA aunque nadie haya pedido nada (ver
    // maybeStartSpotifyPolling/nowPlaying).
    startSpotifyQueuePolling() {
        if (this.spotifyPollInterval) return;
        this.spotifyPollInterval = setInterval(() => this.pollSpotifyQueue(), SPOTIFY_POLL_INTERVAL_MS);
    }

    stopSpotifyQueuePolling() {
        if (this.spotifyPollInterval) {
            clearInterval(this.spotifyPollInterval);
            this.spotifyPollInterval = null;
        }
    }

    // Pedido explícito ("el overlay de Playlist nunca debe estar vacío"):
    // arranca el polling de "now playing" en cuanto hay una cuenta de
    // Spotify conectada, sin depender de que alguien haya pedido una
    // canción por chat primero. Se llama desde attachSocket (cada vez que
    // se conecta un cliente — panel u overlay) y es seguro llamarla más de
    // una vez: startSpotifyQueuePolling es idempotente, y si ya está
    // corriendo esto ni siquiera llega a golpear la DB de nuevo.
    async maybeStartSpotifyPolling() {
        if (this.spotifyPollInterval) return;
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) return;
        this.startSpotifyQueuePolling();
        // Sin esto, el overlay tendría que esperar hasta SPOTIFY_POLL_INTERVAL_MS
        // (4s) para mostrar algo la primera vez que alguien lo abre.
        this.pollSpotifyQueue().catch(() => {});
    }

    // Corre en cada tick: 1) arma `nowPlaying` a partir de lo que Spotify
    // dice que suena AHORA de verdad (lo haya pedido alguien por chat o
    // no — pedido explícito), cruzando el URI contra nuestra propia lista
    // para heredar `requestedBy` si corresponde; y 2) el mecanismo de
    // siempre para saber que un pedido por chat "ya terminó/lo saltearon":
    // compara nuestra lista contra currently_playing/queue de Spotify — lo
    // que ya no está en ninguna de las dos partes se da por reproducido y
    // se saca; lo que coincide con currently_playing se marca `playing`. A
    // propósito NO copia la cola entera de Spotify (que puede traer
    // canciones ajenas al chat que el streamer agregó a mano) — la lista
    // de "próximas" sigue siendo solo lo que llegó por !play.
    async pollSpotifyQueue() {
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) {
            this.stopSpotifyQueuePolling();
            if (this.spotifyQueueState.nowPlaying) {
                this.spotifyQueueState.nowPlaying = null;
                this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
            }
            return;
        }

        let accessToken;
        try {
            accessToken = await spotify.getValidAccessToken(account);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] Polling: no se pudo renovar el token, reintenta en el próximo tick:`, err.message);
            return;
        }

        let live;
        try {
            live = await spotify.getQueue(accessToken);
        } catch (err) {
            console.error(`[${this.licenseId}] [SPOTIFY] Polling: no se pudo leer la cola real, reintenta en el próximo tick:`, err.message);
            return;
        }

        const currentUri = live.currently_playing?.uri || null;
        const upcomingUris = new Set((live.queue || []).map((t) => t.uri));

        const before = JSON.stringify([this.spotifyQueueState.nowPlaying?.uri, this.spotifyQueueState.queue.map((s) => [s.uri, s.playing])]);

        this.spotifyQueueState.queue = this.spotifyQueueState.queue
            .filter((song) => song.uri === currentUri || upcomingUris.has(song.uri))
            .map((song) => ({ ...song, playing: song.uri === currentUri }));

        if (currentUri) {
            const track = live.currently_playing;
            const requested = this.spotifyQueueState.queue.find((s) => s.uri === currentUri);
            this.spotifyQueueState.nowPlaying = {
                uri: currentUri,
                title: track.name,
                artist: (track.artists || []).map((a) => a.name).join(', '),
                albumArt: track.album?.images?.[track.album.images.length - 1]?.url || '',
                requestedBy: requested?.requestedBy || null,
            };
        } else {
            this.spotifyQueueState.nowPlaying = null;
        }

        const after = JSON.stringify([this.spotifyQueueState.nowPlaying?.uri, this.spotifyQueueState.queue.map((s) => [s.uri, s.playing])]);
        if (before !== after) {
            this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        }
        // A propósito YA NO se apaga el polling con la cola de pedidos
        // vacía — sigue corriendo mientras haya cuenta conectada, para
        // seguir mostrando "now playing" (ver comentario de
        // startSpotifyQueuePolling).
    }

    // ==========================================
    // LÓGICA: REY DEL TRONO (KING)
    // ==========================================
    startKingTimer() {
        if (this.kingTimerInterval) clearInterval(this.kingTimerInterval);
        console.log(`[${this.licenseId}] [RELOJ-KING] ⏸️ Esperando primer participante...`);

        this.kingTimerInterval = setInterval(() => {
            if (!this.contestState.isActive || this.contestState.mode === 'waiting' || this.contestState.paused) return;
            this.contestState.timeLeft--;

            if (this.contestState.timeLeft <= 0) {
                if (this.contestState.mode === 'main') {
                    console.log(`[${this.licenseId}] [KING] ⚠️ MODO SNIPE`);
                    this.contestState.mode = 'snipe';
                    this.contestState.timeLeft = this.contestState.snipeTime;
                    this.broadcast.emit('snipe_started', this.contestState);
                } else if (this.contestState.mode === 'snipe') {
                    console.log(`[${this.licenseId}] [KING] 🛑 FINALIZADO`);
                    this.contestState.mode = 'finished';
                    this.contestState.isActive = false;
                    this.contestState.winner = this.contestState.lastParticipant;
                    clearInterval(this.kingTimerInterval);
                    this.broadcast.emit('winner_declared', this.contestState);
                    this.maybeDisconnectTikTok();
                }
            }
            this.broadcast.emit('timer_updated', this.contestState);
        }, 1000);
    }

    // Acumula `coins` de `username` en `accumMap`, respetando la ventana de
    // GIFT_ACCUMULATE_WINDOW_MS: si su último regalo fue hace más de eso,
    // el acumulado se pierde y arranca de cero con este regalo; si no, se
    // suma al que ya tenía. `grantedUnits` (arranca en 0, lo actualiza cada
    // caller) es cuántas "unidades" de ese acumulado ya se cobraron —
    // existe para que un acumulado que sigue creciendo (varios regalos
    // seguidos dentro de la ventana) pueda otorgar entradas de a una a
    // medida que cruza cada múltiplo del umbral, en vez de volver a
    // otorgar las mismas de nuevo cada vez que se reevalúa.
    accumulateGiftCoins(accumMap, username, coins) {
        const now = Date.now();
        const prev = accumMap[username];
        if (prev && now - prev.lastAt <= GIFT_ACCUMULATE_WINDOW_MS) {
            prev.total += coins;
            prev.lastAt = now;
        } else {
            accumMap[username] = { total: coins, lastAt: now, grantedUnits: 0 };
        }
        return accumMap[username];
    }

    // Insta-win y entrada por VALOR en vez de nombre exacto — mismo motivo
    // que Eliminación/Ruleta (ver processGiftElim): el catálogo del
    // selector y el regalo real en vivo pueden no nombrar igual el mismo
    // regalo entre las dos versiones de la librería que usa este proyecto.
    // Pedido explícito y distinto de Eliminación/Ruleta: acá NO se otorgan
    // entradas proporcionales al valor (un regalo de 30x el costo no debe
    // reiniciar el temporizador 30 veces seguidas) — cruzar el umbral
    // cuenta como UNA sola entrada válida, sin importar por cuánto se pase,
    // y el acumulado se reinicia entero apenas se cobra esa entrada.
    processGiftKing({ username, avatar, giftName, totalCoins }) {
        if (!this.contestState.isActive || this.contestState.mode === 'finished' || this.contestState.paused) return;

        if (this.contestState.instaWinGiftCoins > 0) {
            const acc = this.accumulateGiftCoins(this.kingInstaWinAccum, username, totalCoins || 0);
            if (acc.total >= this.contestState.instaWinGiftCoins) {
                delete this.kingInstaWinAccum[username];
                this.contestState.lastParticipant = { username, avatar, giftName };
                this.contestState.winner = this.contestState.lastParticipant;
                this.contestState.mode = 'finished';
                this.contestState.isActive = false;
                if (this.kingTimerInterval) clearInterval(this.kingTimerInterval);
                this.broadcast.emit('gift_received', this.contestState);
                this.broadcast.emit('winner_declared', this.contestState);
                this.maybeDisconnectTikTok();
                return;
            }
        }

        if (!this.contestState.targetGiftCoins) return;
        const acc = this.accumulateGiftCoins(this.kingTargetAccum, username, totalCoins || 0);
        if (acc.total >= this.contestState.targetGiftCoins) {
            delete this.kingTargetAccum[username];
            this.contestState.lastParticipant = { username, avatar, giftName };
            this.contestState.mode = 'main';
            this.contestState.timeLeft = this.contestState.mainTime;
            this.broadcast.emit('gift_received', this.contestState);
        }
    }

    // Extraído a método (antes vivía inline en socket.on('stop_contest'))
    // para poder llamarlo también desde stopAllActiveGames — ver el
    // comentario grande ahí sobre por qué hace falta.
    stopKingContest() {
        this.contestState.isActive = false;
        this.contestState.mode = 'idle';
        this.contestState.paused = false;
        if (this.kingTimerInterval) clearInterval(this.kingTimerInterval);
        this.broadcast.emit('state_update', this.contestState);
        this.maybeDisconnectTikTok();
    }

    // ==========================================
    // LÓGICA: ZUBASTINIS (TOP 3 GIFTERS)
    // ==========================================
    getZubPublicState() {
        const top3 = Object.values(this.zubState.leaderboard).sort((a, b) => b.coins - a.coins).slice(0, 3);
        return {
            isActive: this.zubState.isActive, mode: this.zubState.mode, paused: this.zubState.paused,
            mainTime: this.zubState.mainTime, snipeTime: this.zubState.snipeTime, tiebreakTime: this.zubState.tiebreakTime,
            minCoins: this.zubState.minCoins, timeLeft: this.zubState.timeLeft,
            top3, winner: this.zubState.winner, noWinnerReason: this.zubState.noWinnerReason,
            tiebreakUsernames: this.zubState.tiebreakUsernames,
        };
    }

    // Se llama cuando se agota el tiempo de snipe o de desempate: decide si hay
    // empate (pasa a una ronda de desempate), si nadie llegó al mínimo configurado
    // (sin ganador), o si ya hay un ganador claro.
    resolveZubEnding() {
        const sorted = Object.values(this.zubState.leaderboard).sort((a, b) => b.coins - a.coins);
        const top1 = sorted[0] || null;
        const top1Coins = top1 ? top1.coins : 0;
        const isTie = sorted.length >= 2 && top1Coins > 0 && sorted[1].coins === top1Coins;

        if (isTie) {
            // Solo compiten en el desempate quienes llegaron empatados arriba —
            // cualquier otro regalo (de alguien afuera del empate) se ignora
            // mientras dure este modo, así nadie ajeno puede meterse a "resolver"
            // el empate por los que sí llegaron a la punta.
            this.zubState.tiebreakUsernames = sorted.filter(u => u.coins === top1Coins).map(u => u.username);
            console.log(`[${this.licenseId}] [ZUBASTINIS] 🤝 EMPATE ENTRE ${this.zubState.tiebreakUsernames.map(u => '@' + u).join(', ')} — DESEMPATE`);
            this.zubState.mode = 'tiebreak';
            this.zubState.timeLeft = this.zubState.tiebreakTime;
            this.broadcast.emit('zub_tiebreak_started', this.getZubPublicState());
            this.broadcast.emit('zub_timer_updated', this.getZubPublicState());
            return;
        }

        this.zubState.mode = 'finished';
        this.zubState.isActive = false;
        this.zubState.tiebreakUsernames = [];

        if (this.zubState.minCoins > 0 && top1Coins < this.zubState.minCoins) {
            this.zubState.winner = null;
            this.zubState.noWinnerReason = 'minimum';
            console.log(`[${this.licenseId}] [ZUBASTINIS] 🛑 FINALIZADO — nadie alcanzó el mínimo de ${this.zubState.minCoins} 🪙`);
        } else if (!top1) {
            this.zubState.winner = null;
            this.zubState.noWinnerReason = 'no_gifts';
            console.log(`[${this.licenseId}] [ZUBASTINIS] 🛑 FINALIZADO — nadie participó`);
        } else {
            this.zubState.winner = top1;
            this.zubState.noWinnerReason = null;
            console.log(`[${this.licenseId}] [ZUBASTINIS] 🛑 FINALIZADO — gana @${top1.username}`);
        }

        clearInterval(this.zubTimerInterval);
        this.broadcast.emit('zub_winner_declared', this.getZubPublicState());
        this.maybeDisconnectTikTok();
    }

    startZubTimer() {
        if (this.zubTimerInterval) clearInterval(this.zubTimerInterval);

        this.zubTimerInterval = setInterval(() => {
            if (!this.zubState.isActive || this.zubState.paused) return;
            this.zubState.timeLeft--;

            if (this.zubState.timeLeft <= 0) {
                if (this.zubState.mode === 'main') {
                    console.log(`[${this.licenseId}] [ZUBASTINIS] ⚠️ MODO SNIPE`);
                    this.zubState.mode = 'snipe';
                    this.zubState.timeLeft = this.zubState.snipeTime;
                    this.broadcast.emit('zub_snipe_started', this.getZubPublicState());
                } else if (this.zubState.mode === 'snipe' || this.zubState.mode === 'tiebreak') {
                    this.resolveZubEnding();
                }
            }
            this.broadcast.emit('zub_timer_updated', this.getZubPublicState());
        }, 1000);
    }

    processGiftZub({ username, avatar, totalCoins }) {
        if (!this.zubState.isActive || this.zubState.paused || this.zubState.mode === 'finished' || !totalCoins) return;
        if (this.zubState.mode === 'tiebreak' && !this.zubState.tiebreakUsernames.includes(username)) return;

        if (!this.zubState.leaderboard[username]) this.zubState.leaderboard[username] = { username, avatar, coins: 0 };
        this.zubState.leaderboard[username].avatar = avatar;
        this.zubState.leaderboard[username].coins += totalCoins;

        this.broadcast.emit('zub_state_update', this.getZubPublicState());
    }

    // Ver comentario de stopKingContest.
    stopZubastinis() {
        this.zubState.isActive = false;
        this.zubState.mode = 'idle';
        this.zubState.paused = false;
        this.zubState.tiebreakUsernames = [];
        if (this.zubTimerInterval) clearInterval(this.zubTimerInterval);
        this.broadcast.emit('zub_state_update', this.getZubPublicState());
        this.maybeDisconnectTikTok();
    }

    // ==========================================
    // LÓGICA: ELIMINACIÓN
    // ==========================================
    getElimPublicState() {
        return {
            isActive: this.elimState.isActive, mode: this.elimState.mode, paused: this.elimState.paused,
            targetGiftName: this.elimState.targetGiftName, targetGiftIcon: this.elimState.targetGiftIcon, targetGiftCoins: this.elimState.targetGiftCoins,
            instaWinGiftName: this.elimState.instaWinGiftName, instaWinGiftIcon: this.elimState.instaWinGiftIcon, instaWinGiftCoins: this.elimState.instaWinGiftCoins,
            baseTime: this.elimState.baseTime, rejoinTime: this.elimState.rejoinTime, timeLeft: this.elimState.timeLeft,
            fastMode: this.elimState.fastMode, eliminationsPerRound: this.elimState.eliminationsPerRound, lockedMode: this.elimState.lockedMode,
            participants: this.elimState.participants,
            revealTargetIds: this.elimState.revealTargetIds,
            revealSelectMs: this.elimState.fastMode ? REVEAL_SELECT_MS_FAST : REVEAL_SELECT_MS,
            revealResultMs: this.elimState.fastMode ? REVEAL_RESULT_MS_FAST : REVEAL_RESULT_MS,
            lastEliminatedList: this.elimState.lastEliminatedList, winner: this.elimState.winner,
        };
    }

    finishElimination() {
        const pool = this.elimState.participants;
        this.elimState.mode = 'finished';
        this.elimState.isActive = false;
        const winnerSlot = pool[0] || null;
        this.elimState.winner = winnerSlot ? { username: winnerSlot.username, avatar: winnerSlot.avatar } : null;
        clearInterval(this.elimTimerInterval);
        console.log(`[${this.licenseId}] [ELIMINACION] 🛑 FINALIZADO — ${winnerSlot ? `gana @${winnerSlot.username}` : 'nadie participó'}`);
        this.broadcast.emit('elim_winner_declared', this.getElimPublicState());
        this.maybeDisconnectTikTok();
    }

    // Se llama cuando termina el tiempo de unirse o el de rejoin. El sorteo es
    // por SLOT (no por usuario): alguien con 3 slots tiene 3x más chances de
    // que le toque perder uno, pero solo queda afuera del todo cuando pierde
    // su último slot. Si queda 1 o menos usuarios distintos, termina el juego
    // directamente; si no, se eligen hasta `eliminationsPerRound` slots al
    // azar (ver pickEliminationBatch) y arranca la fase de "selección" —
    // puramente cosmética en el overlay, dura REVEAL_SELECT_MS (o la mitad
    // en fastMode) — recién cuando esa fase termina se elimina la batch de
    // verdad y arranca la fase de "resultado" (ver resolveEliminationReveal).
    beginEliminationReveal() {
        const pool = this.elimState.participants;
        const distinctUsers = new Set(pool.map(p => p.username));

        if (distinctUsers.size <= 1) {
            this.finishElimination();
            return;
        }

        const maxCount = Math.max(1, this.elimState.eliminationsPerRound || 1);
        const batch = pickEliminationBatch(pool, maxCount);
        this.elimState.mode = 'revealing';
        this.elimState.revealTargetIds = batch.map(p => p.id);
        console.log(`[${this.licenseId}] [ELIMINACION] 🎯 SORTEANDO... (${batch.length})`);
        this.broadcast.emit('elim_reveal_started', this.getElimPublicState());

        if (this.elimRevealTimeout) clearTimeout(this.elimRevealTimeout);
        const selectMs = this.elimState.fastMode ? REVEAL_SELECT_MS_FAST : REVEAL_SELECT_MS;
        this.elimRevealTimeout = setTimeout(() => this.resolveEliminationReveal(), selectMs);
    }

    // Saca de verdad los slots sorteados y muestra el resultado por
    // REVEAL_RESULT_MS (o la mitad en fastMode) — pasado ese tiempo, se
    // oculta solo y recién ahí arranca el tiempo de rejoin (bug real
    // corregido a propósito: antes el cartel de "eliminado" se quedaba
    // pegado en pantalla hasta la ronda siguiente, en vez de tener un fin
    // de ciclo propio).
    resolveEliminationReveal() {
        this.elimRevealTimeout = null;
        const pool = this.elimState.participants;
        const ids = this.elimState.revealTargetIds || [];
        const eliminatedSlots = [];
        ids.forEach(id => {
            const idx = pool.findIndex(p => p.id === id);
            if (idx !== -1) eliminatedSlots.push(pool.splice(idx, 1)[0]);
        });
        this.elimState.revealTargetIds = [];

        this.elimState.lastEliminatedList = eliminatedSlots.map(slot => ({
            username: slot.username, avatar: slot.avatar,
            final: !pool.some(p => p.username === slot.username),
        }));
        console.log(`[${this.licenseId}] [ELIMINACION] 💀 ELIMINADOS: ${this.elimState.lastEliminatedList.map(e => '@' + e.username).join(', ') || '(nadie)'}`);

        this.elimState.mode = 'result';
        this.broadcast.emit('elim_eliminated', this.getElimPublicState());

        if (this.elimResultTimeout) clearTimeout(this.elimResultTimeout);
        const resultMs = this.elimState.fastMode ? REVEAL_RESULT_MS_FAST : REVEAL_RESULT_MS;
        this.elimResultTimeout = setTimeout(() => {
            this.elimResultTimeout = null;
            this.elimState.mode = 'rejoin';
            this.elimState.timeLeft = this.elimState.rejoinTime;
            this.elimState.lastEliminatedList = [];
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
        }, resultMs);
    }

    startElimTimer() {
        if (this.elimTimerInterval) clearInterval(this.elimTimerInterval);

        this.elimTimerInterval = setInterval(() => {
            if (!this.elimState.isActive || this.elimState.mode === 'revealing' || this.elimState.mode === 'result' || this.elimState.paused) return;
            this.elimState.timeLeft--;

            if (this.elimState.timeLeft <= 0) {
                if (this.elimState.mode === 'joining') {
                    console.log(`[${this.licenseId}] [ELIMINACION] ⚔️ INICIA LA ELIMINACIÓN`);
                    this.beginEliminationReveal();
                } else if (this.elimState.mode === 'rejoin') {
                    this.beginEliminationReveal();
                }
            }
            this.broadcast.emit('elim_timer_updated', this.getElimPublicState());
        }, 1000);
    }

    // Da entradas E insta-win por VALOR, no por nombre exacto: cualquier
    // regalo cuenta, acumulado por espectador dentro de
    // GIFT_ACCUMULATE_WINDOW_MS (ver accumulateGiftCoins) y convertido a
    // "cuántas veces vale al regalo base configurado" según sus monedas.
    // Esto reemplaza la comparación anterior por nombre exacto
    // (`giftName === targetGiftName`), que en la práctica nunca coincidía:
    // el catálogo del selector sale de la librería v1 (ver
    // /api/setup/:username en server.js) pero el regalo real en vivo llega
    // decodificado por la v2, y esta versión concreta de ambas no siempre
    // nombra el mismo regalo igual — con monedas en vez de nombre, la
    // comparación es sobre un número que la propia TikTok ya resolvió
    // igual en los dos casos, así que nunca desincroniza.
    // A diferencia de Rey del Trono (una sola entrada por umbral cruzado,
    // sin importar el sobrante), acá SÍ se otorgan entradas proporcionales
    // — pedido explícito, tiene sentido en un modo de "slots" como este.
    processGiftElim({ username, avatar, totalCoins }) {
        if (!this.elimState.isActive || this.elimState.paused) return;
        // Locked Mode (pedido explícito): solo se suma gente durante la
        // ventana inicial de 'joining' — nadie nuevo entra ya arrancada la
        // dinámica, ni siquiera en 'rejoin' (que sin este modo sí acepta
        // gente nueva en cualquier momento, ver el bloque de abajo).
        if (this.elimState.lockedMode && this.elimState.mode !== 'joining') return;
        // 'revealing'/'result' (la animación de sorteo y el cartel de
        // resultado) también aceptan regalos: antes se ignoraban del todo y
        // esos usuarios se quedaban afuera de la siguiente ronda de rejoin
        // sin darse cuenta. Ahora entran igual, solo que no participan del
        // sorteo que ya está en curso (arrancó con la lista de antes) —
        // quedan listos para la ronda que sigue apenas termine.
        if (this.elimState.mode !== 'joining' && this.elimState.mode !== 'rejoin' && this.elimState.mode !== 'revealing' && this.elimState.mode !== 'result') return;

        if (this.elimState.instaWinGiftCoins > 0) {
            const accWin = this.accumulateGiftCoins(this.elimInstaWinAccum, username, totalCoins || 0);
            if (accWin.total >= this.elimState.instaWinGiftCoins) {
                delete this.elimInstaWinAccum[username];
                // Si llega durante la animación, cancelamos el sorteo pendiente
                // para que no se resuelva después y pise este resultado.
                if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
                this.elimState.mode = 'finished';
                this.elimState.isActive = false;
                this.elimState.revealTargetId = null;
                this.elimState.winner = { username, avatar };
                clearInterval(this.elimTimerInterval);
                console.log(`[${this.licenseId}] [ELIMINACION] 👑 INSTA-WIN: @${username}`);
                this.broadcast.emit('elim_winner_declared', this.getElimPublicState());
                this.maybeDisconnectTikTok();
                return;
            }
        }

        if (!this.elimState.targetGiftCoins) return;
        const acc = this.accumulateGiftCoins(this.elimEntryAccum, username, totalCoins || 0);
        const totalUnits = Math.floor(acc.total / this.elimState.targetGiftCoins);
        const newUnits = totalUnits - acc.grantedUnits;
        if (newUnits < 1) return;
        acc.grantedUnits = totalUnits;

        // Admite duplicados: cada slot equivalente agrega una entrada nueva,
        // aunque el usuario ya esté participando.
        for (let i = 0; i < newUnits; i++) {
            this.elimSlotCounter += 1;
            this.elimState.participants.push({ id: this.elimSlotCounter, username, avatar });
        }
        this.broadcast.emit('elim_state_update', this.getElimPublicState());
    }

    // Ver comentario de stopKingContest.
    stopElimination() {
        this.elimState.isActive = false;
        this.elimState.mode = 'idle';
        if (this.elimTimerInterval) clearInterval(this.elimTimerInterval);
        if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
        if (this.elimResultTimeout) { clearTimeout(this.elimResultTimeout); this.elimResultTimeout = null; }
        this.broadcast.emit('elim_state_update', this.getElimPublicState());
        this.maybeDisconnectTikTok();
    }

    // ==========================================
    // LÓGICA: RULETA (sorteo por comentario o por regalo)
    // ==========================================
    getRoulettePublicState() {
        return {
            isActive: this.rouletteState.isActive, mode: this.rouletteState.mode,
            entryMode: this.rouletteState.entryMode,
            keyword: this.rouletteState.keyword,
            entryWindowSec: this.rouletteState.entryWindowSec,
            targetGiftName: this.rouletteState.targetGiftName, targetGiftIcon: this.rouletteState.targetGiftIcon, targetGiftCoins: this.rouletteState.targetGiftCoins,
            winnerRule: this.rouletteState.winnerRule, winnerPosition: this.rouletteState.winnerPosition,
            timeLeft: this.rouletteState.timeLeft,
            fastMode: this.rouletteState.fastMode, eliminationsPerRound: this.rouletteState.eliminationsPerRound,
            revealSelectMs: this.rouletteState.fastMode ? REVEAL_SELECT_MS_FAST : REVEAL_SELECT_MS,
            revealResultMs: this.rouletteState.fastMode ? REVEAL_RESULT_MS_FAST : REVEAL_RESULT_MS,
            entries: this.rouletteState.entries,
            // aliveOrder/currentSpinIndex (pedido explícito: que la ruleta
            // GIRE antes de cada eliminado, no solo el flicker de antes) —
            // el overlay usa esto para dibujar la rueda real y rotarla hasta
            // dejar a `currentSpinIndex` bajo el puntero, uno a la vez, antes
            // de agrupar el resultado del batch. `aliveOrder` es un RECORTE
            // de revealOrder (todo lo que sigue vivo desde revealCursor en
            // adelante, ganadora incluida) y `currentSpinIndex` ya viene
            // como índice LOCAL dentro de ese recorte — a propósito nunca se
            // exponen revealOrder/winnerIndex/revealCursor completos, para
            // no filtrarle a quien inspeccione el tráfico quién va a ganar
            // antes de tiempo.
            aliveOrder: this.rouletteState.mode === 'spinning' || this.rouletteState.mode === 'result'
                ? this.rouletteState.revealOrder.slice(this.rouletteState.revealCursor).map(e => ({ id: e.id, username: e.username, avatar: e.avatar }))
                : [],
            currentSpinIndex: this.rouletteState.currentSpinIndex === null || this.rouletteState.currentSpinIndex === undefined
                ? null
                : this.rouletteState.currentSpinIndex - this.rouletteState.revealCursor,
            lastEliminatedList: this.rouletteState.lastEliminatedList, winner: this.rouletteState.winner,
        };
    }

    startRouletteTimer() {
        if (this.rouletteTimerInterval) clearInterval(this.rouletteTimerInterval);

        this.rouletteTimerInterval = setInterval(() => {
            if (!this.rouletteState.isActive || this.rouletteState.mode !== 'joining' || this.rouletteState.paused) return;
            this.rouletteState.timeLeft--;

            if (this.rouletteState.timeLeft <= 0) {
                clearInterval(this.rouletteTimerInterval);
                console.log(`[${this.licenseId}] [RULETA] ⏰ SE CERRARON LAS ENTRADAS — arranca el giro solo`);
                this.beginRouletteSpin();
                return;
            }
            this.broadcast.emit('roulette_timer_updated', this.getRoulettePublicState());
        }, 1000);
    }

    // Azar genuino: se baraja la lista COMPLETA de entradas (shuffleArray,
    // Fisher-Yates) y se calcula en qué posición de ESE shuffle debe salir
    // la ganadora — nada se elige de antemano, la posición configurada solo
    // dice EN QUÉ LUGAR del sorteo (que ya es al azar) tiene que aparecer.
    beginRouletteSpin() {
        const entries = this.rouletteState.entries;
        if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }

        if (entries.length === 0) {
            this.rouletteState.mode = 'finished';
            this.rouletteState.isActive = false;
            this.rouletteState.winner = null;
            console.log(`[${this.licenseId}] [RULETA] 🛑 FINALIZADA — nadie participó`);
            this.broadcast.emit('roulette_winner_declared', this.getRoulettePublicState());
            this.maybeDisconnectTikTok();
            return;
        }

        const total = entries.length;
        const rule = this.rouletteState.winnerRule;
        const winnerPos = rule === 'first' ? 1
            : rule === 'last' ? total
            : Math.min(Math.max(1, this.rouletteState.winnerPosition || 1), total);

        this.rouletteState.mode = 'spinning';
        this.rouletteState.revealOrder = shuffleArray(entries);
        this.rouletteState.winnerIndex = winnerPos - 1;
        this.rouletteState.revealCursor = 0;
        this.rouletteState.lastEliminatedList = [];
        this.rouletteState.currentSpinIndex = null;
        this.rouletteState.spinQueue = [];
        console.log(`[${this.licenseId}] [RULETA] 🎡 GIRANDO — ${total} entradas, ganadora en la posición ${winnerPos}`);
        this.broadcast.emit('roulette_spin_started', this.getRoulettePublicState());
        this.beginRouletteStep();
    }

    // Arranca un paso: agrupa hasta `eliminationsPerRound` eliminaciones por
    // batch (la ganadora, revealOrder[winnerIndex], nunca entra en uno — si
    // ya no queda nadie más antes de ella, el sorteo termina y la declara),
    // pero pedido explícito revisado: la ruleta tiene que GIRAR una vez por
    // cada eliminado del batch (no una sola vez para todo el grupo) antes de
    // mostrar el resultado agrupado — ver beginRouletteSubSpin.
    beginRouletteStep() {
        const { revealOrder, winnerIndex, revealCursor } = this.rouletteState;
        if (revealCursor >= winnerIndex) {
            this.finishRouletteWithWinner();
            return;
        }
        const remainingBeforeWinner = winnerIndex - revealCursor;
        const batchSize = Math.min(Math.max(1, this.rouletteState.eliminationsPerRound || 1), remainingBeforeWinner);
        const batchIndexes = Array.from({ length: batchSize }, (_, i) => revealCursor + i);
        this.rouletteState.revealTargetIndexes = batchIndexes;
        this.rouletteState.spinQueue = [...batchIndexes];
        this.beginRouletteSubSpin();
    }

    // Gira hacia UNA persona a la vez dentro del batch actual (pedido
    // explícito: "gira antes de cada eliminado", incluso con
    // eliminationsPerRound > 1) — dura REVEAL_SELECT_MS (o la mitad en
    // fastMode) por persona, encadenado sin pausa entre uno y el siguiente.
    // Recién cuando se giró hacia TODOS los del batch se muestra el
    // resultado agrupado (ver resolveRouletteBatch) — la rueda en sí
    // (aliveOrder) no cambia de tamaño hasta ese momento, solo el índice al
    // que apunta el puntero en cada giro.
    beginRouletteSubSpin() {
        const state = this.rouletteState;
        if (state.spinQueue.length === 0) {
            this.resolveRouletteBatch();
            return;
        }
        state.currentSpinIndex = state.spinQueue.shift();
        state.mode = 'spinning';
        this.broadcast.emit('roulette_step_started', this.getRoulettePublicState());

        if (this.rouletteRevealTimeout) clearTimeout(this.rouletteRevealTimeout);
        const selectMs = state.fastMode ? REVEAL_SELECT_MS_FAST : REVEAL_SELECT_MS;
        this.rouletteRevealTimeout = setTimeout(() => this.beginRouletteSubSpin(), selectMs);
    }

    // Saca de verdad a todos los del batch (ya se giró hacia cada uno, ver
    // beginRouletteSubSpin) y muestra el resultado agrupado por
    // REVEAL_RESULT_MS (o la mitad en fastMode) antes de arrancar el
    // siguiente paso — mismo ciclo de "aparece y se oculta solo" que
    // Eliminación (ver resolveEliminationReveal).
    resolveRouletteBatch() {
        this.rouletteRevealTimeout = null;
        const { revealOrder, revealTargetIndexes } = this.rouletteState;
        const eliminated = revealTargetIndexes.map(i => revealOrder[i]);
        this.rouletteState.lastEliminatedList = eliminated.map(e => ({ username: e.username, avatar: e.avatar }));
        this.rouletteState.revealCursor += revealTargetIndexes.length;
        this.rouletteState.revealTargetIndexes = [];
        this.rouletteState.currentSpinIndex = null;
        // Pedido explícito (bug real): `entries` es lo que ve el panel de
        // administración (la lista de participantes activos), y antes
        // nunca se tocaba durante el sorteo — `revealOrder` es una COPIA
        // barajada aparte, así que las eliminaciones nunca se reflejaban
        // ahí. Eliminación ya sacaba de verdad de `participants`, esto
        // iguala el comportamiento acá.
        const eliminatedIds = new Set(eliminated.map(e => e.id));
        this.rouletteState.entries = this.rouletteState.entries.filter(e => !eliminatedIds.has(e.id));
        this.rouletteState.mode = 'result';
        console.log(`[${this.licenseId}] [RULETA] 💀 ELIMINADAS: ${this.rouletteState.lastEliminatedList.map(e => '@' + e.username).join(', ')}`);
        this.broadcast.emit('roulette_step', this.getRoulettePublicState());

        const resultMs = this.rouletteState.fastMode ? REVEAL_RESULT_MS_FAST : REVEAL_RESULT_MS;
        this.rouletteRevealTimeout = setTimeout(() => {
            this.rouletteRevealTimeout = null;
            this.rouletteState.lastEliminatedList = [];
            this.beginRouletteStep();
        }, resultMs);
    }

    finishRouletteWithWinner() {
        const entry = this.rouletteState.revealOrder[this.rouletteState.winnerIndex];
        this.rouletteState.mode = 'finished';
        this.rouletteState.isActive = false;
        this.rouletteState.winner = { username: entry.username, avatar: entry.avatar };
        this.rouletteState.lastEliminatedList = [];
        console.log(`[${this.licenseId}] [RULETA] 👑 GANADORA: @${entry.username}`);
        this.broadcast.emit('roulette_winner_declared', this.getRoulettePublicState());
        this.maybeDisconnectTikTok();
    }

    // Modo Chat: comentar la keyword configurada da UNA vida, sin importar
    // cuántas veces vuelva a comentar la misma persona.
    processRouletteComment(data) {
        const state = this.rouletteState;
        if (!state.isActive || state.mode !== 'joining' || state.paused || state.entryMode !== 'chat') return;

        const comment = typeof data.content === 'string' ? data.content.trim().toLowerCase() : '';
        const keyword = (state.keyword || '').trim().toLowerCase();
        if (!keyword || !comment.includes(keyword)) return;

        const username = data.uniqueId;
        if (!username || state.entries.some(e => e.username === username)) return;

        state.entries.push({ id: ++this.rouletteSlotCounter, username, avatar: data.profilePictureUrl || '' });
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
    }

    // Modo Gift: da entradas por VALOR, no por nombre exacto — mismo
    // criterio y mismo motivo que processGiftElim (el catálogo del
    // selector viene de la librería v1, el regalo real en vivo lo decodifica
    // la v2, y esta versión concreta de ambas no siempre nombra igual el
    // mismo regalo). Cualquier regalo cuenta, acumulado por espectador
    // dentro de GIFT_ACCUMULATE_WINDOW_MS y convertido a "cuántas veces
    // vale al regalo base configurado" según sus monedas — proporcional,
    // igual que Eliminación (más regalos, más chances, a propósito).
    processGiftRoulette({ username, avatar, totalCoins }) {
        const state = this.rouletteState;
        if (!state.isActive || state.mode !== 'joining' || state.paused || state.entryMode !== 'gift') return;
        if (!state.targetGiftCoins) return;
        const acc = this.accumulateGiftCoins(this.rouletteEntryAccum, username, totalCoins || 0);
        const totalUnits = Math.floor(acc.total / state.targetGiftCoins);
        const newUnits = totalUnits - acc.grantedUnits;
        if (newUnits < 1) return;
        acc.grantedUnits = totalUnits;

        for (let i = 0; i < newUnits; i++) {
            state.entries.push({ id: ++this.rouletteSlotCounter, username, avatar });
        }
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
    }

    // Ver comentario de stopKingContest.
    stopRoulette() {
        this.rouletteState.isActive = false;
        this.rouletteState.mode = 'idle';
        this.rouletteState.paused = false;
        if (this.rouletteTimerInterval) clearInterval(this.rouletteTimerInterval);
        if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
        this.maybeDisconnectTikTok();
    }

    // ==========================================
    // LÓGICA: TOP GIFTER (ranking continuo de regalos)
    // ==========================================
    getGifterPublicState() {
        const top = Object.values(this.gifterState.leaderboard).sort((a, b) => b.coins - a.coins).slice(0, CONTINUOUS_LEADERBOARD_SIZE);
        return { leaderboard: top };
    }

    // Suma siempre que haya conexión, sin importar qué juego esté activo (o
    // si no hay ninguno) — es un contador de fondo del directo, no de una
    // partida puntual.
    processGiftGifterBoard({ username, avatar, totalCoins }) {
        if (!username || !totalCoins) return;
        if (!this.gifterState.leaderboard[username]) this.gifterState.leaderboard[username] = { username, avatar, coins: 0 };
        this.gifterState.leaderboard[username].avatar = avatar;
        this.gifterState.leaderboard[username].coins += totalCoins;
        this.broadcast.emit('gifter_state_update', this.getGifterPublicState());
    }

    // ==========================================
    // LÓGICA: TOP TAP-TAP (ranking continuo de likes, con detección de ráfaga)
    // ==========================================
    getTapTapPublicState() {
        const top = Object.values(this.tapTapState.leaderboard).sort((a, b) => b.likes - a.likes).slice(0, CONTINUOUS_LEADERBOARD_SIZE);
        return { leaderboard: top };
    }

    // Ver comentario de tapTapDiagnostics en el constructor. `distinctUsers`
    // es un Set interno (no se manda tal cual — solo su tamaño), así que
    // esto arma el objeto plano que sí viaja por socket.
    getTapTapDiagnostics() {
        const d = this.tapTapDiagnostics;
        return {
            totalReceived: d.totalReceived,
            totalSettled: d.totalSettled,
            distinctUserCount: d.distinctUsers.size,
            lastEventAt: d.lastEventAt,
            lastEventUsername: d.lastEventUsername,
            lastSettledAt: d.lastSettledAt,
        };
    }

    // Se llama en CADA 'like' crudo que llega de TikTok, pase o no los
    // filtros de handleLikeEvent — pedido explícito (reporte de bug) de
    // poder ver en consola/panel si el problema es que TikTok/la librería
    // no está mandando eventos de más usuarios (acá nunca aparecerían) o si
    // los recibimos y algo los descarta después (acá sí aparecerían, pero
    // no en el ranking final). El broadcast al panel se throttlea a 1 vez
    // por segundo como mucho, para no saturar el socket si hay una ráfaga
    // de cientos de likes en simultáneo.
    recordTapTapEvent(username, likeCount) {
        const d = this.tapTapDiagnostics;
        d.totalReceived += 1;
        d.lastEventAt = Date.now();
        d.lastEventUsername = username || null;
        if (username) d.distinctUsers.add(username);

        if (!this.tapTapDiagnosticsBroadcastTimer) {
            this.tapTapDiagnosticsBroadcastTimer = setTimeout(() => {
                this.tapTapDiagnosticsBroadcastTimer = null;
                this.broadcast.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());
            }, 1000);
        }
    }

    // Acumula en `pendingByUser` sin tocar el ranking público todavía, y
    // reinicia el temporizador de asentamiento de ESE usuario — así una
    // ráfaga de 12k taps seguidos no mueve el número del overlay hasta que
    // la persona para de tocar (ver TAPTAP_SETTLE_MS).
    processLikeTapTap(username, avatar, likeCount) {
        const pending = this.tapTapPending[username];
        if (pending) {
            pending.likes += likeCount;
            pending.avatar = avatar || pending.avatar;
            clearTimeout(pending.timer);
        } else {
            this.tapTapPending[username] = { avatar, likes: likeCount, timer: null };
        }
        this.tapTapPending[username].timer = setTimeout(() => this.settleTapTap(username), TAPTAP_SETTLE_MS);
    }

    // La ráfaga terminó (silencio de TAPTAP_SETTLE_MS): recién acá se suma
    // de una sola vez al ranking que ve la audiencia.
    settleTapTap(username) {
        const pending = this.tapTapPending[username];
        if (!pending) return;
        delete this.tapTapPending[username];

        if (!this.tapTapState.leaderboard[username]) this.tapTapState.leaderboard[username] = { username, avatar: pending.avatar, likes: 0 };
        this.tapTapState.leaderboard[username].avatar = pending.avatar || this.tapTapState.leaderboard[username].avatar;
        this.tapTapState.leaderboard[username].likes += pending.likes;
        this.tapTapDiagnostics.totalSettled += 1;
        this.tapTapDiagnostics.lastSettledAt = Date.now();
        this.broadcast.emit('taptap_state_update', this.getTapTapPublicState());
        // Bug real encontrado verificando el diagnóstico: sin esto,
        // "asentados al ranking" se quedaba pegado en el último valor que
        // había mandado recordTapTapEvent (que solo se dispara con un
        // 'like' CRUDO nuevo) — si no llegaba ningún tap más después de que
        // este asentamiento ocurriera (1.5s más tarde, ver
        // TAPTAP_SETTLE_MS), el panel nunca se enteraba de que sí se
        // asentó, aunque el ranking real ya lo reflejaba bien.
        this.broadcast.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());
    }

    // ==========================================
    // LÓGICA: MODO EXTENSIBLE (cuenta regresiva que crece con follows/regalos)
    // ==========================================
    getExtensiblePublicState() {
        return {
            isActive: this.extensibleState.isActive,
            finished: this.extensibleState.finished,
            paused: this.extensibleState.paused,
            baseTime: this.extensibleState.baseTime,
            secondsPerFollow: this.extensibleState.secondsPerFollow,
            secondsPerGift: this.extensibleState.secondsPerGift,
            reverseMode: this.extensibleState.reverseMode,
            timeLeft: this.extensibleState.timeLeft,
        };
    }

    startExtensibleTimer() {
        if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        this.extensibleTimerInterval = setInterval(() => {
            if (!this.extensibleState.isActive || this.extensibleState.finished || this.extensibleState.paused) return;
            this.extensibleState.timeLeft -= 1;
            if (this.extensibleState.timeLeft <= 0) {
                this.extensibleState.timeLeft = 0;
                this.extensibleState.finished = true;
                clearInterval(this.extensibleTimerInterval);
            }
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        }, EXTENSIBLE_TICK_MS);
    }

    // Un follow detectado suma `secondsPerFollow` al tiempo restante. No hace
    // falta deduplicar por usuario: es TikTok quien decide cuándo emitir el
    // evento, y cada aparición es información nueva de la plataforma. Pedido
    // explícito (revisado): a diferencia de Rey del Trono/Zubastinis/
    // Eliminación, en Extensible la pausa SOLO congela el paso natural del
    // segundero (ver startExtensibleTimer) — los follows/regalos siguen
    // sumando (o restando, en reverseMode) mientras está pausado, para que
    // ese apoyo no se pierda si el streamer tuvo que pausar por un
    // imprevisto. Al reanudar, el conteo simplemente sigue desde el valor
    // ya actualizado.
    processFollowExtensible() {
        const state = this.extensibleState;
        if (!state.isActive || state.finished) return;
        // reverseMode invierte el signo: cada follow RESTA en vez de sumar
        // (pedido explícito, "Extensible Inverso") — si llega a 0 por esto,
        // termina igual que cuando lo agota el paso natural del segundero.
        state.timeLeft = Math.max(0, state.timeLeft + (state.reverseMode ? -state.secondsPerFollow : state.secondsPerFollow));
        if (state.timeLeft <= 0) {
            state.timeLeft = 0;
            state.finished = true;
            if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        }
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
    }

    // Bug real reportado: "SEGUNDOS POR REGALO" está pensado como segundos
    // POR MONEDA (♦) del regalo — un regalo de 50 monedas debe sumar 50x
    // este valor — pero multiplicaba por `repeatCount` (cuántas veces se
    // mandó el MISMO regalo en el combo, no su valor). Con un regalo caro
    // mandado una sola vez, repeatCount daba 1 y el conteo casi no se movía,
    // como si el regalo no se hubiera detectado. Ahora usa `totalCoins`
    // (diamondCount * repeatCount, ya calculado en handleGiftEvent), que sí
    // refleja el valor real del regalo — cualquier regalo cuenta, a
    // propósito no está atado a uno específico como Eliminación/Ruleta.
    // Mismo criterio de reverseMode y de pausa que processFollowExtensible
    // (ver comentario ahí): sigue sumando/restando aunque esté pausado.
    processGiftExtensible({ totalCoins }) {
        const state = this.extensibleState;
        if (!state.isActive || state.finished) return;
        const coins = Math.max(1, totalCoins || 1);
        const magnitude = state.secondsPerGift * coins;
        state.timeLeft = Math.max(0, state.timeLeft + (state.reverseMode ? -magnitude : magnitude));
        if (state.timeLeft <= 0) {
            state.timeLeft = 0;
            state.finished = true;
            if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        }
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
    }

    // Ver comentario de stopKingContest.
    stopExtensible() {
        this.extensibleState.isActive = false;
        this.extensibleState.paused = false;
        if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        this.maybeDisconnectTikTok();
    }

    // ==========================================
    // SOCKET.IO: conecta un socket individual de este tenant.
    // El aislamiento entre licencias ya está resuelto por el room de
    // Socket.io (el caller hace socket.join(this.licenseId) antes de
    // llamar a este método); acá solo hace falta registrar los handlers
    // de siempre, delegando a los métodos de instancia.
    // ==========================================
    attachSocket(socket) {
        // Fire-and-forget: ver el comentario de loadAlertConfigs.
        this.loadAlertConfigs();

        // Sincronizar al nuevo cliente al instante
        socket.emit('state_update', this.contestState);
        socket.emit('zub_state_update', this.getZubPublicState());
        socket.emit('elim_state_update', this.getElimPublicState());
        socket.emit('roulette_state_update', this.getRoulettePublicState());
        socket.emit('gifter_state_update', this.getGifterPublicState());
        socket.emit('taptap_state_update', this.getTapTapPublicState());
        socket.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());
        socket.emit('extensible_state_update', this.getExtensiblePublicState());
        socket.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        socket.emit('spotify_settings_update', this.getSpotifySettingsPublicState());
        // Pedido explícito: el overlay de Playlist tiene que poder mostrar
        // "now playing" apenas alguien lo abre, sin depender de que ya
        // hubiera un !play pedido antes (ver maybeStartSpotifyPolling).
        this.maybeStartSpotifyPolling().catch(() => {});
        socket.emit('active_app_changed', this.activeApp);
        // `desiredUsername` (no solo `username`/`connected`) para que el panel
        // pueda RECUPERAR la conexión que ya estaba viva después de un F5 —
        // ver el comentario de `hasEditedUsernameRef` en App.jsx: sin esto,
        // el panel arranca con el campo vacío en cada carga y termina
        // mandando `set_desired_username(null)`, matando una conexión real
        // que el backend nunca perdió (el Tenant vive en memoria mientras el
        // proceso no se reinicie, independiente de que este socket puntual
        // se haya desconectado/reconectado).
        socket.emit('live_status', { username: this.currentTikTokUsername, desiredUsername: this.desiredUsername, connected: this.liveConnected });
        socket.emit('prize_updated', this.prize);
        socket.emit('theme_updated', this.theme);
        socket.emit('overlay_customization_update', this.overlayCustomization);
        socket.emit('dice_state_update', this.diceState);

        // ── COLOR SAYS (dados) ───────────────────────
        // El panel tira los dados y decide el resultado (con su propia
        // lógica, ver Colorsays.jsx); acá solo se valida la forma básica y
        // se reenvía al overlay especial de Colores (?screen=colors).
        socket.on('set_dice_state', ({ diceCount, diceResult, rolling } = {}) => {
            this.diceState = {
                diceCount: Number.isInteger(diceCount) ? Math.max(1, Math.min(6, diceCount)) : this.diceState.diceCount,
                diceResult: Array.isArray(diceResult) ? diceResult.slice(0, 6) : this.diceState.diceResult,
                rolling: !!rolling,
            };
            this.broadcast.emit('dice_state_update', this.diceState);
        });

        // ── PREMIO (compartido entre Rey del Trono/Zubastinis/Eliminación/
        // Ruleta) ─────────────────────────────────
        // La imagen llega ya redimensionada por el cliente (~100px de lado)
        // como data URL; igual se valida acá tamaño y formato para que un
        // cliente malicioso no infle la memoria del tenant ni meta HTML.
        socket.on('update_prize', ({ title, image } = {}) => {
            const cleanTitle = typeof title === 'string' ? title.slice(0, 60).trim() : '';
            const cleanImage = (typeof image === 'string' && image.startsWith('data:image/') && image.length <= 500000)
                ? image : null;
            this.prize = (cleanTitle || cleanImage) ? { title: cleanTitle, image: cleanImage } : null;
            this.broadcast.emit('prize_updated', this.prize);
        });

        // ── VERIFICACIÓN DE USUARIO LIVE (independiente de cualquier módulo) ──
        socket.on('set_desired_username', (uname) => {
            this.desiredUsername = uname && uname.trim() ? uname.trim().replace(/^@+/, '') : null;
            if (this.desiredUsername) {
                this.ensureTikTokConnection(this.desiredUsername).catch(() => {});
            } else {
                this.maybeDisconnectTikTok();
            }
        });

        // ── REY DEL TRONO ──────────────────────────
        socket.on('start_contest', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO REY DEL TRONO...`);
            db.incrementUsage(this.licenseId, 'king_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(king_starts):`, err.message));

            this.contestState = {
                ...this.contestState,
                ...config,
                isActive: true,
                mode: 'waiting',
                paused: false,
                timeLeft: config.mainTime,
                lastParticipant: null,
                winner: null
            };
            this.kingTargetAccum = {};
            this.kingInstaWinAccum = {};
            this.broadcast.emit('contest_started', this.contestState);

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).then(() => this.startKingTimer()).catch(() => {});
            }
        });

        socket.on('pause_contest', () => {
            if (this.contestState.isActive && this.contestState.mode !== 'finished') {
                this.contestState.paused = true;
                this.broadcast.emit('state_update', this.contestState);
            }
        });

        socket.on('resume_contest', () => {
            if (this.contestState.isActive && this.contestState.mode !== 'finished') {
                this.contestState.paused = false;
                this.broadcast.emit('state_update', this.contestState);
            }
        });

        socket.on('restart_contest', () => {
            if (this.contestState.isActive) {
                console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO REY DEL TRONO...`);
                this.contestState.mode = 'waiting';
                this.contestState.paused = false;
                this.contestState.timeLeft = this.contestState.mainTime;
                this.contestState.lastParticipant = null;
                this.contestState.winner = null;
                this.kingTargetAccum = {};
                this.kingInstaWinAccum = {};
                this.broadcast.emit('state_update', this.contestState);
                this.startKingTimer();
            }
        });

        socket.on('update_settings', (newConfig) => {
            if (this.contestState.isActive) {
                this.contestState.targetGiftName = newConfig.targetGiftName;
                this.contestState.targetGiftIcon = newConfig.targetGiftIcon;
                this.contestState.targetGiftCoins = newConfig.targetGiftCoins;
                this.contestState.instaWinGiftName = newConfig.instaWinGiftName;
                this.contestState.instaWinGiftIcon = newConfig.instaWinGiftIcon;
                this.contestState.instaWinGiftCoins = newConfig.instaWinGiftCoins;
                this.contestState.mainTime = newConfig.mainTime;
                this.contestState.snipeTime = newConfig.snipeTime;

                // Pedido explícito: reflejar el cambio de tiempo al instante si la
                // fase correspondiente está corriendo ahora mismo (igual que ya
                // hacía Zubastinis) — si se agranda el tiempo, el conteo salta
                // hacia arriba; si se achica, salta hacia abajo. En 'waiting'
                // (todavía no llegó el primer regalo) no hay nada que saltar, el
                // valor nuevo ya queda guardado para cuando arranque.
                if (this.contestState.mode === 'main') this.contestState.timeLeft = newConfig.mainTime;
                else if (this.contestState.mode === 'snipe') this.contestState.timeLeft = newConfig.snipeTime;
                this.broadcast.emit('state_update', this.contestState);
            }
        });

        socket.on('stop_contest', () => this.stopKingContest());

        // ── ZUBASTINIS ──────────────────────────────
        socket.on('start_zubastinis', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO ZUBASTINIS...`);
            db.incrementUsage(this.licenseId, 'zub_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(zub_starts):`, err.message));

            this.zubState = {
                isActive: true, mode: 'main', paused: false,
                mainTime: config.mainTime, snipeTime: config.snipeTime,
                tiebreakTime: config.tiebreakTime, minCoins: config.minCoins || 0,
                timeLeft: config.mainTime,
                leaderboard: {}, winner: null, noWinnerReason: null,
                tiebreakUsernames: [],
            };
            this.broadcast.emit('zub_state_update', this.getZubPublicState());
            this.startZubTimer();

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        socket.on('pause_zubastinis', () => {
            if (this.zubState.isActive && this.zubState.mode !== 'finished') {
                this.zubState.paused = true;
                this.broadcast.emit('zub_state_update', this.getZubPublicState());
            }
        });

        socket.on('resume_zubastinis', () => {
            if (this.zubState.isActive && this.zubState.mode !== 'finished') {
                this.zubState.paused = false;
                this.broadcast.emit('zub_state_update', this.getZubPublicState());
            }
        });

        socket.on('restart_zubastinis', () => {
            if (this.zubState.isActive) {
                console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO ZUBASTINIS...`);
                this.zubState.mode = 'main';
                this.zubState.paused = false;
                this.zubState.timeLeft = this.zubState.mainTime;
                this.zubState.leaderboard = {};
                this.zubState.winner = null;
                this.zubState.noWinnerReason = null;
                this.zubState.tiebreakUsernames = [];
                this.broadcast.emit('zub_state_update', this.getZubPublicState());
                this.startZubTimer();
            }
        });

        socket.on('update_zub_settings', (newConfig) => {
            if (this.zubState.isActive) {
                this.zubState.mainTime = newConfig.mainTime;
                this.zubState.snipeTime = newConfig.snipeTime;
                this.zubState.tiebreakTime = newConfig.tiebreakTime;
                this.zubState.minCoins = newConfig.minCoins || 0;

                if (this.zubState.mode === 'main') this.zubState.timeLeft = newConfig.mainTime;
                else if (this.zubState.mode === 'snipe') this.zubState.timeLeft = newConfig.snipeTime;
                else if (this.zubState.mode === 'tiebreak') this.zubState.timeLeft = newConfig.tiebreakTime;

                this.broadcast.emit('zub_state_update', this.getZubPublicState());
            }
        });

        socket.on('stop_zubastinis', () => this.stopZubastinis());

        // ── ELIMINACIÓN ──────────────────────────────
        socket.on('start_elimination', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO ELIMINACIÓN...`);
            db.incrementUsage(this.licenseId, 'elim_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(elim_starts):`, err.message));

            if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
            if (this.elimResultTimeout) { clearTimeout(this.elimResultTimeout); this.elimResultTimeout = null; }
            this.elimState = {
                isActive: true, mode: 'joining', paused: false,
                targetGiftName: config.targetGiftName, targetGiftIcon: config.targetGiftIcon, targetGiftCoins: config.targetGiftCoins,
                instaWinGiftName: config.instaWinGiftName || '', instaWinGiftIcon: config.instaWinGiftIcon || '', instaWinGiftCoins: config.instaWinGiftCoins || 0,
                baseTime: config.baseTime, rejoinTime: config.rejoinTime, timeLeft: config.baseTime,
                fastMode: !!config.fastMode,
                eliminationsPerRound: Math.max(1, Number(config.eliminationsPerRound) || 1),
                lockedMode: !!config.lockedMode,
                participants: [], revealTargetIds: [], lastEliminatedList: [], winner: null,
            };
            this.elimSlotCounter = 0;
            this.elimEntryAccum = {};
            this.elimInstaWinAccum = {};
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            this.startElimTimer();

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        socket.on('pause_elimination', () => {
            if (this.elimState.isActive && this.elimState.mode !== 'finished') {
                this.elimState.paused = true;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        socket.on('resume_elimination', () => {
            if (this.elimState.isActive && this.elimState.mode !== 'finished') {
                this.elimState.paused = false;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        socket.on('restart_elimination', () => {
            if (this.elimState.isActive) {
                console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO ELIMINACIÓN...`);
                if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
                if (this.elimResultTimeout) { clearTimeout(this.elimResultTimeout); this.elimResultTimeout = null; }
                this.elimState.mode = 'joining';
                this.elimState.paused = false;
                this.elimState.timeLeft = this.elimState.baseTime;
                this.elimState.participants = [];
                this.elimState.revealTargetIds = [];
                this.elimState.lastEliminatedList = [];
                this.elimState.winner = null;
                this.elimSlotCounter = 0;
                this.elimEntryAccum = {};
                this.elimInstaWinAccum = {};
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
                this.startElimTimer();
            }
        });

        socket.on('update_elim_settings', (newConfig) => {
            if (this.elimState.isActive) {
                this.elimState.targetGiftName = newConfig.targetGiftName;
                this.elimState.targetGiftIcon = newConfig.targetGiftIcon;
                this.elimState.targetGiftCoins = newConfig.targetGiftCoins;
                this.elimState.instaWinGiftName = newConfig.instaWinGiftName || '';
                this.elimState.instaWinGiftIcon = newConfig.instaWinGiftIcon || '';
                this.elimState.instaWinGiftCoins = newConfig.instaWinGiftCoins || 0;
                this.elimState.baseTime = newConfig.baseTime;
                this.elimState.rejoinTime = newConfig.rejoinTime;
                this.elimState.fastMode = !!newConfig.fastMode;
                this.elimState.eliminationsPerRound = Math.max(1, Number(newConfig.eliminationsPerRound) || 1);
                // Pedido explícito: una vez arrancada la ronda con Locked Mode
                // activado, no se puede desactivar hasta Detener/Reiniciar — evita
                // levantar el bloqueo a mitad de ronda para dejar entrar gente
                // nueva a último momento. Prender sí se puede en cualquier momento.
                this.elimState.lockedMode = this.elimState.lockedMode || !!newConfig.lockedMode;

                // Pedido explícito (igual que Zubastinis): reflejar el cambio de
                // tiempo al instante si la fase correspondiente está corriendo
                // ahora mismo — si se agranda el tiempo, el conteo salta hacia
                // arriba; si se achica, salta hacia abajo.
                if (this.elimState.mode === 'joining') this.elimState.timeLeft = newConfig.baseTime;
                else if (this.elimState.mode === 'rejoin') this.elimState.timeLeft = newConfig.rejoinTime;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        // Suma entradas a mano, sin depender de un regalo o comentario real —
        // pedido explícito para poder premiar a alguien puntualmente o corregir
        // a mano. Cuentan EXACTAMENTE igual que las entradas por regalo (mismo
        // array de slots que usa el sorteo), y a propósito ignoran Locked Mode:
        // es una acción explícita del admin, no una entrada automática. Si el
        // usuario ya está en la lista, reusa su avatar real; si es nuevo, le
        // toca uno al azar de la galería (ver DEFAULT_MANUAL_AVATARS/
        // pickDefaultManualAvatar) — queda fijo mientras dure la ronda.
        socket.on('elim_add_manual_entry', ({ username, count } = {}) => {
            if (!this.elimState.isActive || this.elimState.mode === 'finished') return;
            const uname = (username || '').trim();
            if (!uname) return;
            const n = Math.max(1, Math.min(1000, Math.round(Number(count) || 1)));
            const existing = this.elimState.participants.find(p => p.username === uname);
            const avatar = existing ? existing.avatar : pickDefaultManualAvatar();
            for (let i = 0; i < n; i++) {
                this.elimSlotCounter += 1;
                this.elimState.participants.push({ id: this.elimSlotCounter, username: uname, avatar });
            }
            console.log(`[${this.licenseId}] [ELIMINACION] ➕ Entrada manual: @${uname} x${n}`);
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
        });

        socket.on('stop_elimination', () => this.stopElimination());

        // ── RULETA ──────────────────────────────────
        // No hay evento de "girar" manual: el giro arranca solo al vencer
        // entryWindowSec (ver startRouletteTimer) — pedido explícito.
        socket.on('start_roulette', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO RULETA (${config.entryMode === 'gift' ? 'modo regalo' : 'modo chat'})...`);
            db.incrementUsage(this.licenseId, 'roulette_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(roulette_starts):`, err.message));

            if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
            this.rouletteState = {
                isActive: true, mode: 'joining', paused: false,
                entryMode: config.entryMode === 'gift' ? 'gift' : 'chat',
                keyword: config.keyword || '',
                entryWindowSec: config.entryWindowSec,
                targetGiftName: config.targetGiftName || '', targetGiftIcon: config.targetGiftIcon || '', targetGiftCoins: config.targetGiftCoins || 0,
                winnerRule: config.winnerRule || 'first', winnerPosition: config.winnerPosition || 1,
                timeLeft: config.entryWindowSec,
                fastMode: !!config.fastMode,
                eliminationsPerRound: Math.max(1, Number(config.eliminationsPerRound) || 1),
                entries: [], revealOrder: [], winnerIndex: -1, revealCursor: 0, revealTargetIndexes: [],
                currentSpinIndex: null, spinQueue: [],
                lastEliminatedList: [], winner: null,
            };
            this.rouletteSlotCounter = 0;
            this.rouletteEntryAccum = {};
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            this.startRouletteTimer();

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        // `config` es opcional a propósito (compatibilidad hacia atrás):
        // si el panel manda los ajustes actuales, la ronda nueva arranca
        // con ESOS valores (pedido explícito — antes había que Stop,
        // cambiar los datos, e Iniciar de cero para que se reflejaran). Sin
        // config, reutiliza lo que ya tenía, igual que antes.
        socket.on('restart_roulette', (config) => {
            if (!this.rouletteState.isActive) return;
            console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO RULETA...`);
            if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
            if (config) {
                this.rouletteState.entryMode = config.entryMode === 'gift' ? 'gift' : 'chat';
                this.rouletteState.keyword = config.keyword || '';
                this.rouletteState.entryWindowSec = config.entryWindowSec || this.rouletteState.entryWindowSec;
                this.rouletteState.targetGiftName = config.targetGiftName || '';
                this.rouletteState.targetGiftIcon = config.targetGiftIcon || '';
                this.rouletteState.targetGiftCoins = config.targetGiftCoins || 0;
                this.rouletteState.winnerRule = config.winnerRule || 'first';
                this.rouletteState.winnerPosition = config.winnerPosition || 1;
                this.rouletteState.fastMode = !!config.fastMode;
                this.rouletteState.eliminationsPerRound = Math.max(1, Number(config.eliminationsPerRound) || 1);
            }
            this.rouletteState.mode = 'joining';
            this.rouletteState.paused = false;
            this.rouletteState.timeLeft = this.rouletteState.entryWindowSec;
            this.rouletteState.entries = [];
            this.rouletteState.revealOrder = [];
            this.rouletteState.winnerIndex = -1;
            this.rouletteState.revealCursor = 0;
            this.rouletteState.revealTargetIndexes = [];
            this.rouletteState.currentSpinIndex = null;
            this.rouletteState.spinQueue = [];
            this.rouletteState.lastEliminatedList = [];
            this.rouletteState.winner = null;
            this.rouletteSlotCounter = 0;
            this.rouletteEntryAccum = {};
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            this.startRouletteTimer();
        });

        // Cambios en vivo MIENTRAS se está uniendo gente (antes de que
        // arranque el giro, que ya queda comprometido con el shuffle) — el
        // mismo patrón que update_elim_settings/update_settings en los
        // otros modos. Pedido explícito (igual que Zubastinis): la ventana de
        // entrada SÍ se refleja al instante en el conteo que está corriendo
        // (como acá solo se llega con mode === 'joining', siempre es la fase
        // activa) — si se agranda, salta hacia arriba; si se achica, hacia abajo.
        socket.on('update_roulette_settings', (newConfig) => {
            if (this.rouletteState.isActive && this.rouletteState.mode === 'joining') {
                this.rouletteState.entryMode = newConfig.entryMode === 'gift' ? 'gift' : 'chat';
                this.rouletteState.keyword = newConfig.keyword || '';
                this.rouletteState.entryWindowSec = newConfig.entryWindowSec || this.rouletteState.entryWindowSec;
                this.rouletteState.targetGiftName = newConfig.targetGiftName || '';
                this.rouletteState.targetGiftIcon = newConfig.targetGiftIcon || '';
                this.rouletteState.targetGiftCoins = newConfig.targetGiftCoins || 0;
                this.rouletteState.winnerRule = newConfig.winnerRule || 'first';
                this.rouletteState.winnerPosition = newConfig.winnerPosition || 1;
                this.rouletteState.fastMode = !!newConfig.fastMode;
                this.rouletteState.eliminationsPerRound = Math.max(1, Number(newConfig.eliminationsPerRound) || 1);
                this.rouletteState.timeLeft = this.rouletteState.entryWindowSec;
                this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            }
        });

        // Ver comentario de elim_add_manual_entry — mismo criterio acá: cuenta
        // como una entrada real (mismo array que usa el sorteo), solo se puede
        // sumar mientras la ventana de entrada sigue abierta ('joining'), porque
        // una vez que arranca el giro el orden ya quedó barajado y fijo
        // (revealOrder/winnerIndex, ver beginRouletteSpin) — sumar gente después
        // no tendría forma de entrar en ese sorteo ya en curso.
        socket.on('roulette_add_manual_entry', ({ username, count } = {}) => {
            if (!this.rouletteState.isActive || this.rouletteState.mode !== 'joining') return;
            const uname = (username || '').trim();
            if (!uname) return;
            const n = Math.max(1, Math.min(1000, Math.round(Number(count) || 1)));
            const existing = this.rouletteState.entries.find(e => e.username === uname);
            const avatar = existing ? existing.avatar : pickDefaultManualAvatar();
            for (let i = 0; i < n; i++) {
                this.rouletteState.entries.push({ id: ++this.rouletteSlotCounter, username: uname, avatar });
            }
            console.log(`[${this.licenseId}] [RULETA] ➕ Entrada manual: @${uname} x${n}`);
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
        });

        // Pausa/reanuda SOLO la cuenta de "tiempo para entrar" (mientras
        // mode === 'joining') — el giro en sí no se pausa, una vez que
        // arranca ya queda comprometido con el shuffle (mismo criterio que
        // "no hay evento de girar manual", ver start_roulette).
        socket.on('pause_roulette', () => {
            if (this.rouletteState.isActive && this.rouletteState.mode === 'joining') {
                this.rouletteState.paused = true;
                this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            }
        });

        socket.on('resume_roulette', () => {
            if (this.rouletteState.isActive && this.rouletteState.mode === 'joining') {
                this.rouletteState.paused = false;
                this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            }
        });

        socket.on('stop_roulette', () => this.stopRoulette());

        // ── MODO EXTENSIBLE ──────────────────────────
        // 120 minutos (7200s) de tope para el tiempo base — mismo límite que
        // el slider del panel (ver Extensible.jsx), reforzado acá por si
        // algún día algo más allá del panel manda el config.
        const MAX_EXTENSIBLE_BASE_SECONDS = 120 * 60;
        const clampBaseTime = (value, fallback) => Math.min(MAX_EXTENSIBLE_BASE_SECONDS, Math.max(1, Number(value) || fallback));

        socket.on('start_extensible', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO MODO EXTENSIBLE...`);
            const baseTime = clampBaseTime(config?.baseTime, 60);
            this.extensibleState = {
                isActive: true, finished: false, paused: false,
                baseTime,
                secondsPerFollow: Math.max(0, Number(config?.secondsPerFollow) || 0),
                secondsPerGift: Math.max(0, Number(config?.secondsPerGift) || 0),
                reverseMode: !!config?.reverseMode,
                timeLeft: baseTime,
            };
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            this.startExtensibleTimer();

            if (config?.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        // Segundos por follow/regalo y Modo Inverso: se pueden cambiar en vivo
        // sin reiniciar el contador (pedido explícito). Tiempo base: pedido
        // explícito REVISADO — ya NO se edita en vivo (antes sí, sumando la
        // diferencia); ahora queda BLOQUEADO mientras el modo está activo, y
        // el valor que llegue acá se ignora a propósito (solo importa para el
        // próximo Reiniciar, ver restart_extensible más abajo). Para cambiar
        // el tiempo mientras corre está adjust_extensible_time (+/-, ver más
        // abajo), que sí actúa al instante.
        socket.on('update_extensible_settings', (config) => {
            if (!this.extensibleState.isActive) return;
            if (config?.secondsPerFollow !== undefined) this.extensibleState.secondsPerFollow = Math.max(0, Number(config.secondsPerFollow) || 0);
            if (config?.secondsPerGift !== undefined) this.extensibleState.secondsPerGift = Math.max(0, Number(config.secondsPerGift) || 0);
            if (config?.reverseMode !== undefined) this.extensibleState.reverseMode = !!config.reverseMode;
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        });

        // Ajuste manual de tiempo mientras el contador está activo (pedido
        // explícito: +1/+5 min, -1/-5 min, o un valor a medida desde el
        // panel) — reemplaza la antigua edición en vivo del tiempo base, que
        // ahora queda bloqueada (ver update_extensible_settings). A
        // diferencia de los follows/regalos, esto SÍ puede "revivir" una
        // cuenta que ya había llegado a 0: es una acción explícita del admin,
        // no una entrada automática, así que si el nuevo total queda arriba
        // de 0 el timer se re-arma solo.
        socket.on('adjust_extensible_time', ({ deltaSeconds } = {}) => {
            if (!this.extensibleState.isActive) return;
            const delta = Math.max(-MAX_EXTENSIBLE_BASE_SECONDS, Math.min(MAX_EXTENSIBLE_BASE_SECONDS, Math.round(Number(deltaSeconds) || 0)));
            if (!delta) return;
            const state = this.extensibleState;
            state.timeLeft = Math.max(0, state.timeLeft + delta);
            if (state.timeLeft > 0 && state.finished) {
                state.finished = false;
                this.startExtensibleTimer();
            } else if (state.timeLeft <= 0) {
                state.finished = true;
                if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
            }
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        });

        socket.on('restart_extensible', (config) => {
            if (!this.extensibleState.isActive) return;
            console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO MODO EXTENSIBLE...`);
            if (config?.baseTime !== undefined) this.extensibleState.baseTime = clampBaseTime(config.baseTime, this.extensibleState.baseTime);
            if (config?.secondsPerFollow !== undefined) this.extensibleState.secondsPerFollow = Math.max(0, Number(config.secondsPerFollow) || 0);
            if (config?.secondsPerGift !== undefined) this.extensibleState.secondsPerGift = Math.max(0, Number(config.secondsPerGift) || 0);
            if (config?.reverseMode !== undefined) this.extensibleState.reverseMode = !!config.reverseMode;
            this.extensibleState.timeLeft = this.extensibleState.baseTime;
            this.extensibleState.finished = false;
            this.extensibleState.paused = false;
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            this.startExtensibleTimer();
        });

        // Congela el contador entero (ni baja solo, ni suma por follow/gift)
        // — mismo criterio que Rey del Trono/Zubastinis/Eliminación.
        socket.on('pause_extensible', () => {
            if (this.extensibleState.isActive && !this.extensibleState.finished) {
                this.extensibleState.paused = true;
                this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            }
        });

        socket.on('resume_extensible', () => {
            if (this.extensibleState.isActive && !this.extensibleState.finished) {
                this.extensibleState.paused = false;
                this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            }
        });

        socket.on('stop_extensible', () => this.stopExtensible());

        // ── TOP GIFTER / TOP TAP-TAP (rankings continuos) ──
        // Sin start/stop: solo un botón de "reiniciar" a mano desde la
        // pestaña Overlays, para cuando el streamer quiere arrancar de cero
        // (ej. un directo nuevo).
        socket.on('reset_gifter_leaderboard', () => {
            this.gifterState.leaderboard = {};
            this.broadcast.emit('gifter_state_update', this.getGifterPublicState());
        });

        socket.on('reset_taptap_leaderboard', () => {
            Object.values(this.tapTapPending).forEach((p) => clearTimeout(p.timer));
            this.tapTapPending = {};
            this.tapTapState.leaderboard = {};
            // Reseteo completo pedido explícito (bug de Tap-Tap): el
            // diagnóstico también arranca de cero, para no arrastrar
            // conteos de una sesión/directo anterior.
            if (this.tapTapDiagnosticsBroadcastTimer) { clearTimeout(this.tapTapDiagnosticsBroadcastTimer); this.tapTapDiagnosticsBroadcastTimer = null; }
            this.tapTapDiagnostics = { totalReceived: 0, totalSettled: 0, distinctUsers: new Set(), lastEventAt: null, lastEventUsername: null, lastSettledAt: null };
            this.broadcast.emit('taptap_state_update', this.getTapTapPublicState());
            this.broadcast.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());
        });

        // ── SPOTIFY ──────────────────────────────────
        socket.on('clear_spotify_queue', () => {
            this.spotifyQueueState.queue = [];
            // A propósito YA NO apaga el polling acá (antes sí tenía
            // sentido: el polling solo existía para seguir pedidos por
            // chat, y sin pedidos no había nada que seguir). Ahora también
            // sostiene "now playing" (ver maybeStartSpotifyPolling/
            // pollSpotifyQueue) — vaciar la lista de pedidos no debería
            // apagar eso.
            this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        });

        // Quién puede usar !play/!skip (ver isAuthorizedForSpotifyCommands),
        // el apagado general del comando, y cuántas canciones se muestran
        // como mucho en el overlay (maxQueueSize, pedido explícito) — mismo
        // patrón que el resto de los ajustes en vivo (set_theme,
        // update_extensible_settings, etc.).
        socket.on('update_spotify_settings', (newSettings) => {
            this.spotifySettings = {
                enabled: Boolean(newSettings?.enabled),
                allUsers: Boolean(newSettings?.allUsers),
                moderators: Boolean(newSettings?.moderators),
                fanMembers: Boolean(newSettings?.fanMembers),
                minFanLevel: Math.max(1, Math.min(50, Number(newSettings?.minFanLevel) || 1)),
                maxQueueSize: Math.max(1, Math.min(20, Number(newSettings?.maxQueueSize) || SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT)),
            };
            this.broadcast.emit('spotify_settings_update', this.getSpotifySettingsPublicState());
            this.broadcast.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
        });

        // Control de volumen desde el panel — actúa sobre la reproducción
        // REAL de Spotify (mismos requisitos que !play/!skip: Premium +
        // dispositivo activo), no sobre nada propio de la plataforma.
        socket.on('set_spotify_volume', async (volumePercent) => {
            const account = await db.getSpotifyAccount(this.licenseId);
            if (!account) return;
            try {
                const accessToken = await spotify.getValidAccessToken(account);
                await spotify.setVolume(accessToken, Math.max(0, Math.min(100, Math.round(Number(volumePercent) || 0))));
            } catch (err) {
                this.broadcast.emit('spotify_error', { message: this.describeSpotifyError(err) });
            }
        });

        // ─────────────────────────────────────────────
        // EVENTOS PARA EL OVERLAY MULTI-APP
        // (Color Says ya no participa: se transmite directo desde su pantalla)
        // ─────────────────────────────────────────────
        socket.on('set_active_app', (appId) => {
            this.activeApp = appId;
            this.broadcast.emit('active_app_changed', this.activeApp);
        });

        // Botón "Refrescar overlays" del panel (pestaña Overlays) — a
        // diferencia de los "Reiniciar ranking" (que BORRAN datos), esto no
        // toca ningún estado: solo le pide a cada ventana de overlay que
        // recargue la página, para el caso en que hace falta que tomen un
        // cambio nuevo (p. ej. un deploy de frontend) sin que el streamer
        // tenga que sacar y volver a poner la fuente de navegador en OBS/
        // TikTok LIVE Studio a mano. El propio panel también está en este
        // room pero IGNORA este evento (ver el guard `if (overlayMode)` en
        // App.jsx) — recargar el panel a mitad de una edición sería peor
        // que el problema que este botón resuelve.
        socket.on('refresh_overlays', () => {
            this.broadcast.emit('force_overlay_refresh');
        });

        // ── TEMA (panel -> overlay) ──────────────────
        // El panel emite esto cada vez que el streamer cambia de skin (y una
        // vez al conectar, para sincronizar el estado inicial). Se reenvía a
        // TODO el room, overlay incluido, así el streamer y su audiencia ven
        // siempre el mismo skin.
        socket.on('set_theme', (theme) => {
            const style = VALID_THEME_STYLES.includes(theme?.style) ? theme.style : this.theme.style;
            const accent = VALID_THEME_ACCENTS.includes(theme?.accent) ? theme.accent : this.theme.accent;
            // Solo importa cuando accent === 'custom' (ver accentStyleVars en
            // ThemeContext.jsx) — igual se guarda siempre para que, si el
            // streamer vuelve a "Personalizado", no arranque del valor por
            // defecto en vez del último que había elegido.
            const customColor = sanitizeHexColor(theme?.customColor, this.theme.customColor || '#7C3AED');
            if (style === this.theme.style && accent === this.theme.accent && customColor === this.theme.customColor) return;
            this.theme = { style, accent, customColor };
            this.broadcast.emit('theme_updated', this.theme);
        });

        // ── PERSONALIZACIÓN DE OVERLAYS (fondo + color de usuario) ──
        // El panel manda el mapa COMPLETO (los 6 overlays configurables)
        // cada vez que el streamer toca cualquier control del modal de
        // "Personalizar" — mismo patrón que set_theme: se sanea y se
        // reenvía tal cual a todo el room, overlay de OBS incluido.
        socket.on('set_overlay_customization', (map) => {
            this.overlayCustomization = sanitizeOverlayCustomization(map);
            this.broadcast.emit('overlay_customization_update', this.overlayCustomization);
        });
    }
}

module.exports = Tenant;
