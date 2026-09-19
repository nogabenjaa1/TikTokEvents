// WebcastPushConnection se movió al subpath '/legacy' en una versión reciente
// de la librería — importarlo del paquete raíz devuelve `undefined` ahí
// (el root export ahora es solo el catálogo enorme de tipos protobuf), así
// que `new WebcastPushConnection(...)` explotaba con un TypeError SÍNCRONO
// en cada intento de conectar. Como eso pasaba dentro de un método async,
// se convertía en una promesa rechazada que todo caller atrapaba con
// `.catch(() => {})` sin loguear nada — por eso el panel se quedaba en
// "Conectando..." para siempre, sin ni éxito ni error visible.


// ==========================================
// Tenant: encapsula TODO lo que antes era estado global de server.js,
// una instancia por licencia activa. Cada tenant tiene su propio Rey del
// Trono / Zubastinis / Eliminación / conexión a TikTok, y sus broadcasts
// van únicamente al room de Socket.io de esa licencia (this.broadcast).
// La lógica de juego es la misma de siempre; lo único que cambia es que
// vive en `this` en vez de en variables de módulo.
// ==========================================
const {
    SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT,
} = require('./lib/tenantHelpers');
const {
    sanitizeOverlayCustomization,
} = require('./lib/tenantSanitizers');

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

        // ── OBJETIVO (meta de regalos o de seguidores, pedido explícito) ──
        // A diferencia de Extensible (cuenta regresiva con su propio
        // `setInterval`), acá no hay paso del tiempo -- es un simple
        // acumulador que suma en cada regalo/seguidor nuevo y se compara
        // contra `target`, igual de simple que processGiftGifterBoard (ver
        // más abajo) pero con UN solo total en vez de un ranking por
        // usuario. Un objetivo a la vez (pedido explícito: "uno a la vez"),
        // nunca dos corriendo en simultáneo -- `targetType` decide si lo
        // alimentan los regalos (en monedas) o los seguidores nuevos (de a
        // uno). `title` es un texto opcional del streamer (ej. "Para la
        // silla nueva") -- si lo deja vacío, el overlay muestra un título
        // genérico según `targetType`. No se resetea solo con la conexión
        // ni con el tiempo -- pedido explícito: el progreso se queda como
        // está hasta que el streamer lo reinicia a mano (ver reset_goal),
        // ni siquiera si TikTok se desconecta un rato.
        this.goalState = {
            isActive: false, finished: false,
            targetType: 'coins', // 'coins' | 'followers'
            target: 0, current: 0, title: '',
        };
        // Sonido opcional al completar el objetivo (pedido explícito) --
        // A DIFERENCIA de goalState de arriba (que se resetea con cada
        // start_goal), esto es una CONFIGURACIÓN que persiste entre
        // objetivos (igual que la voz elegida en TTS) -- sobrevive a
        // start_goal/stop_goal/reset_goal, y a un reinicio del server (ver
        // loadPersistedSettings/db.setGoalSettings). `goalAudioPath` nunca
        // se manda al cliente (ver getGoalPublicState) -- es solo la
        // referencia interna para poder borrar el archivo viejo de
        // Supabase Storage cuando se sube uno nuevo.
        this.goalAudioUrl = null;
        this.goalAudioPath = null;

        // ── ESPECTADORES EN VIVO (para el overlay de chat) ──
        // Ver handleRoomUserEvent más abajo -- viene de un evento de TikTok
        // que este codebase nunca escuchaba a propósito (ver el comentario
        // grande en server.js sobre por qué, y por qué ahora ya es seguro).
        this.viewerCount = 0;
        this.loggedRoomUserSample = false;

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

        // ── TTS (lee el chat en voz alta, 100% del lado del navegador del
        // streamer -- ver TtsChat.jsx) ──
        // A diferencia del resto de TtsChat (que corre y decide TODO en el
        // navegador, sin pasar por acá), quién puede activar una lectura sí
        // se sincroniza por acá -- pedido explícito: que estos filtros no se
        // pierdan al entrar desde otro navegador/computadora. `enabled` NO
        // se guarda acá a propósito (ver set_tts_settings): que el TTS lea
        // el chat siempre arranca APAGADO en cada sesión nueva, es una
        // decisión de seguridad ya existente en TtsChat.jsx, no algo que
        // deba "recordarse" solo.
        this.ttsSettings = { allUsers: false, moderators: true, superFans: true, fanMembers: true, minFanLevel: 1, usernameOverrides: [] };

        // Pedido explícito: que la personalización de tema/overlays y los
        // ajustes de Spotify/TTS de arriba sobrevivan a un reinicio del
        // server y a entrar desde otro dispositivo -- antes solo vivían acá
        // en memoria (se perdían en cada redeploy) y/o en el localStorage
        // de un único navegador. Se cargan una sola vez desde la DB (ver
        // loadPersistedSettings, llamado en attachSocket) igual que
        // alertConfigsLoaded de acá abajo.
        this.settingsLoaded = false;

        // ── ALERTAS DE REGALOS ──
        // Config guardada en DB (ver db.js/server.js — se edita subiendo un
        // archivo por HTTP, no por socket), cacheada acá en memoria para no
        // pegarle a la base en cada regalo que llega. `alertConfigs` mapea
        // nombre de regalo (en minúscula) -> { id, visualUrl, visualType,
        // visualMuted, audioUrl, text, textPosition, durationMs, position }.
        // server.js llama a setAlertConfig/
        // removeAlertConfig justo después de guardar/borrar en la DB, así
        // el cache nunca queda desactualizado sin tener que releer todo.
        this.alertConfigs = {};
        this.alertConfigsLoaded = false;
        this.alertTriggerCounter = 0;

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
        // Ver el comentario de SHORT_CONNECTION_THRESHOLD_MS mas arriba --
        // el circuit-breaker que corta el bucle de reconexión cuando el
        // LIVE ya terminó de verdad pero connect() sigue resolviendo.
        this.connectedAt = null;
        this.consecutiveShortDisconnects = 0;
        // Ver el comentario de WATCHDOG_TIMEOUT_MS mas arriba.
        this.lastTikTokMessageAt = null;
        this.watchdogInterval = null;
        // Último momento en que hubo (o dejó de haber) un socket conectado a
        // este tenant -- ver isEvictable/disposeTenant.
        this.lastSocketActivityAt = Date.now();
        // Foto periódica del estado en vivo (ver lib/tenant/runtimeState.js).
        this.lastRuntimeJson = null;
        this.runtimeInterval = null;
        // Etiqueta legible de la licencia para los logs (se completa al cargar
        // sus ajustes) y contador de intentos de conexión fallidos seguidos.
        this.licenseLabel = null;
        this.reconnectAttempts = 0;
    }

    // Identificador para los logs: "alias/8 primeros del id" -- el UUID
    // completo no dice de quién es la licencia.
    get logId() {
        const short = String(this.licenseId).slice(0, 8);
        return this.licenseLabel ? `${this.licenseLabel}/${short}` : short;
    }

    // Broadcast scopeado: reemplaza los antiguos io.emit(...) globales.
    get broadcast() {
        return this.io.to(this.licenseId);
    }

    // ==========================================
    // SOCKET.IO: conecta un socket individual de este tenant.
    // El aislamiento entre licencias ya está resuelto por el room de
    // Socket.io (el caller hace socket.join(this.licenseId) antes de
    // llamar a este método); acá solo hace falta registrar los handlers
    // de siempre, delegando a los métodos de instancia.
    // ==========================================
    attachSocket(socket) {
        this.lastSocketActivityAt = Date.now();
        socket.on('disconnect', () => { this.lastSocketActivityAt = Date.now(); });

        // Fire-and-forget: ver el comentario de loadAlertConfigs.
        this.loadAlertConfigs();

        // A diferencia de alertConfigs (que se auto-corrige solo con el
        // próximo regalo si llega a faltar por una fracción de segundo),
        // estos SÍ tienen que estar cargados de la DB ANTES de sincronizar
        // al cliente que se acaba de conectar -- pedido explícito: que
        // tema, personalización de overlays, ajustes de Spotify y de TTS
        // vuelvan tal cual quedaron la última vez, aunque el streamer entre
        // desde otro navegador/computadora (o el server se haya reiniciado
        // de por medio, que borra todo lo que solo vivía en memoria). Sin
        // este orden, el primer dispositivo en conectarse a un Tenant recién
        // creado vería por un instante los valores de fábrica en vez de lo
        // guardado -- y en el peor caso, otro ajuste hecho en ESE instante
        // desde ese dispositivo podría pisar sin querer lo real con esos
        // valores de fábrica.
        this.loadPersistedSettings().then(() => {
            socket.emit('theme_updated', this.theme);
            socket.emit('overlay_customization_update', this.overlayCustomization);
            socket.emit('spotify_settings_update', this.getSpotifySettingsPublicState());
            socket.emit('spotify_queue_update', this.getSpotifyQueuePublicState());
            socket.emit('tts_settings_update', this.ttsSettings);
            socket.emit('goal_state_update', this.getGoalPublicState());
            // Si loadPersistedSettings restauró estado en vivo tras un
            // reinicio, este cliente lo recibe ahora (los emits de más
            // abajo salieron antes de que terminara la carga).
            socket.emit('state_update', this.contestState);
            socket.emit('zub_state_update', this.getZubPublicState());
            socket.emit('elim_state_update', this.getElimPublicState());
            socket.emit('roulette_state_update', this.getRoulettePublicState());
            socket.emit('gifter_state_update', this.getGifterPublicState());
            socket.emit('taptap_state_update', this.getTapTapPublicState());
            socket.emit('extensible_state_update', this.getExtensiblePublicState());
            this.startRuntimePersistence();
        });

        // Sincronizar al nuevo cliente al instante -- todo esto es estado EN
        // VIVO de la transmisión actual (juegos/colas/conexión), no depende
        // de nada guardado en la DB.
        socket.emit('state_update', this.contestState);
        socket.emit('zub_state_update', this.getZubPublicState());
        socket.emit('elim_state_update', this.getElimPublicState());
        socket.emit('roulette_state_update', this.getRoulettePublicState());
        socket.emit('gifter_state_update', this.getGifterPublicState());
        socket.emit('taptap_state_update', this.getTapTapPublicState());
        socket.emit('taptap_diagnostics_update', this.getTapTapDiagnostics());
        socket.emit('extensible_state_update', this.getExtensiblePublicState());
        socket.emit('goal_state_update', this.getGoalPublicState());
        socket.emit('viewer_count_update', { viewerCount: this.viewerCount });
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
        socket.emit('dice_state_update', this.diceState);

        // Handlers de socket por área (ver backend/lib/tenant/*.js).
        this.registerMiscHandlers(socket);
        this.registerConnectionHandlers(socket);
        this.registerKingHandlers(socket);
        this.registerZubHandlers(socket);
        this.registerElimHandlers(socket);
        this.registerRouletteHandlers(socket);
        this.registerExtensibleHandlers(socket);
        this.registerGoalHandlers(socket);
        this.registerLeaderboardHandlers(socket);
        this.registerSpotifyHandlers(socket);
        this.registerSettingsHandlers(socket);
        this.registerAlertHandlers(socket);
    }
}

// Métodos por área: cada archivo de lib/tenant/ aporta los suyos al prototipo.
Object.assign(Tenant.prototype, require('./lib/tenant/connection'));
Object.assign(Tenant.prototype, require('./lib/tenant/events'));
Object.assign(Tenant.prototype, require('./lib/tenant/persistence'));
Object.assign(Tenant.prototype, require('./lib/tenant/runtimeState'));
Object.assign(Tenant.prototype, require('./lib/tenant/alerts'));
Object.assign(Tenant.prototype, require('./lib/tenant/spotify'));
Object.assign(Tenant.prototype, require('./lib/tenant/king'));
Object.assign(Tenant.prototype, require('./lib/tenant/zub'));
Object.assign(Tenant.prototype, require('./lib/tenant/elim'));
Object.assign(Tenant.prototype, require('./lib/tenant/roulette'));
Object.assign(Tenant.prototype, require('./lib/tenant/leaderboards'));
Object.assign(Tenant.prototype, require('./lib/tenant/extensible'));
Object.assign(Tenant.prototype, require('./lib/tenant/goal'));
Object.assign(Tenant.prototype, require('./lib/tenant/settings'));
Object.assign(Tenant.prototype, require('./lib/tenant/misc'));

module.exports = Tenant;
