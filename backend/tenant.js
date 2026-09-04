const { WebcastPushConnection } = require('tiktok-live-connector');
const db = require('./db');

// Duración de la animación de "sorteo" (tipo ruleta) en el overlay de
// Eliminación antes de revelar a quién le tocó.
const ELIM_REVEAL_MS = 4000;

// RULETA: delay (ms) antes de revelar el siguiente lugar, según cuántos
// pasos faltan para llegar al ganador — 0 = el próximo paso ES el ganador
// (la pausa más larga, el momento de más suspenso), 1-3 = los últimos
// lugares antes de esa revelación, ya notablemente más lentos que el resto.
// Cualquier distancia mayor usa el ritmo normal.
const ROULETTE_REVEAL_DELAY_MS = { 0: 5000, 1: 4000, 2: 3000, 3: 2000 };
const ROULETTE_REVEAL_DELAY_DEFAULT_MS = 1100;

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

// Cuántos puestos exponen los rankings continuos (Top Gifter / Top Tap-Tap)
// — no son partidas con inicio/fin, así que no hace falta acotarlos a un
// top 3 como Zubastinis.
const CONTINUOUS_LEADERBOARD_SIZE = 8;

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

// Espejo del catálogo de frontend/src/ThemeContext.jsx: valida lo que manda
// el cliente antes de guardarlo/emitirlo, para que un socket manipulado a
// mano no pueda meter un valor arbitrario en --theme-style/--accent.
const VALID_THEME_STYLES = ['default', 'kawaii', 'minimal', 'cute'];
const VALID_THEME_ACCENTS = ['purple', 'blue', 'pink', 'green'];

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
            isActive: false, mode: 'idle', paused: false, // idle | joining | revealing | rejoin | finished
            targetGiftName: '', targetGiftIcon: '', targetGiftCoins: 0,
            instaWinGiftName: '', instaWinGiftIcon: '', instaWinGiftCoins: 0,
            baseTime: 60, rejoinTime: 20, timeLeft: 0,
            participants: [], // [{ id, username, avatar }]
            revealTargetId: null,
            lastEliminated: null, winner: null,
        };
        this.elimTimerInterval = null;
        this.elimSlotCounter = 0;
        this.elimRevealTimeout = null;

        // ── RULETA (sorteo por comentario o por regalo) ──
        // entryMode 'chat': comenta la keyword (opcionalmente solo
        // seguidores) = una vida, una por username. entryMode 'gift': manda
        // el regalo configurado = una vida por cada unidad (slots, igual que
        // Eliminación). El giro es azar genuino sobre TODA la lista barajada
        // — ver shuffleArray/beginRouletteSpin — la "posición ganadora" solo
        // dice EN QUÉ LUGAR del sorteo aparece la ganadora, no la elige de
        // antemano.
        this.rouletteState = {
            isActive: false, mode: 'idle', // idle | joining | spinning | finished
            entryMode: 'chat', keyword: '', followersOnly: false, entryWindowSec: 300,
            targetGiftName: '', targetGiftIcon: '', targetGiftCoins: 0,
            winnerRule: 'first', winnerPosition: 1, // 'first' | 'last' | 'position'
            timeLeft: 0,
            entries: [], // [{ id, username, avatar }]
            revealOrder: [], winnerIndex: -1, revealCursor: 0, // solo durante 'spinning'
            lastEliminated: null, winner: null,
        };
        this.rouletteTimerInterval = null;
        this.rouletteSlotCounter = 0;
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
        this.theme = { style: 'default', accent: 'purple' };

        // ── COLOR SAYS (dados) ──
        // Client-autoritativo, igual que `theme`/`prizes`: el panel de
        // control tira los dados y decide el resultado (con su propia
        // lógica de Safe Mode), acá solo se reenvía tal cual al overlay
        // especial de Colores para que la audiencia vea lo mismo en vivo.
        this.diceState = { diceCount: 4, diceResult: [], rolling: false };

        // ── PREMIOS (opcionales, por modo) ──
        // { title, image } donde image es un data URL chico (≤ ~100px de
        // lado, redimensionado en el cliente) o null. Se muestran en el
        // overlay para que la gente sepa qué se está jugando. Viven fuera de
        // los estados de juego a propósito: sobreviven a start/stop.
        this.prizes = { king: null, zub: null, elim: null, roulette: null };

        // ── CONEXIÓN TIKTOK (una por tenant) ──
        this.tiktokConnection = null;
        this.currentTikTokUsername = null;
        this.liveConnected = false;
        this.connectingPromise = null;
        this.retryTimeout = null;
        this.desiredUsername = null;
    }

    // Broadcast scopeado: reemplaza los antiguos io.emit(...) globales.
    get broadcast() {
        return this.io.to(this.licenseId);
    }

    // ==========================================
    // CONEXIÓN TIKTOK
    // ==========================================
    anyContestNeedsConnection() {
        return this.contestState.isActive || this.zubState.isActive || this.elimState.isActive || this.rouletteState.isActive || !!this.desiredUsername;
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

        // Ráfagas de tap-tap en curso quedan huérfanas si la conexión se cae
        // a mitad de una: sin esto, sus timers seguirían vivos apuntando a
        // un tenant que ya no está escuchando likes.
        Object.values(this.tapTapPending).forEach((p) => clearTimeout(p.timer));
        this.tapTapPending = {};
    }

    maybeDisconnectTikTok() {
        if (!this.anyContestNeedsConnection()) this.disconnectTikTok();
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

        if (this.tiktokConnection && this.currentTikTokUsername !== username) this.disconnectTikTok();

        this.currentTikTokUsername = username;
        console.log(`[${this.licenseId}] [TIKTOK] 📡 Intentando conectar a @${username}...`);
        this.tiktokConnection = new WebcastPushConnection(username, { enableExtendedGiftInfo: true });
        this.tiktokConnection.on('gift', (data) => this.handleGiftEvent(data));
        this.tiktokConnection.on('chat', (data) => this.handleChatEvent(data));
        this.tiktokConnection.on('like', (data) => this.handleLikeEvent(data));
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

        // Sin este timeout propio, un connect() colgado (ver comentario de
        // TIKTOK_CONNECT_TIMEOUT_MS) deja al panel esperando para siempre.
        const timedConnect = Promise.race([
            this.tiktokConnection.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new TikTokConnectTimeoutError()), TIKTOK_CONNECT_TIMEOUT_MS)),
        ]);

        this.connectingPromise = timedConnect.then(() => {
            console.log(`[${this.licenseId}] [TIKTOK] ✅ ¡CONECTADO!`);
            this.liveConnected = true;
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
            this.scheduleReconnect(username);
            throw err;
        });

        return this.connectingPromise;
    }

    getTikTokConnectionErrorMessage(error) {
        const raw = String(error?.message || '').toLowerCase();
        if (error instanceof TikTokConnectTimeoutError) {
            return `La conexión no respondió a tiempo (¿estás en vivo ahora mismo?). Si esto se repite seguido aunque sí estés en vivo, puede deberse a que TikTok está bloqueando las conexiones directas desde este servidor — configurar una API key de Euler Stream (variable de entorno SIGN_API_KEY, gratis en eulerstream.com) suele evitarlo.`;
        }
        if (error?.name === 'UserOfflineError' || raw.includes("isn't online") || raw.includes('offline')) {
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
        if (data.giftType === 1 && !data.repeatEnd) return; // esperar a que termine el combo

        const event = {
            username: data.uniqueId,
            avatar: data.userDetails?.profilePictureUrls?.[0] || '',
            giftName: data.giftName,
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
    }

    // Igual que el chat/gift: campos leídos por analogía con cómo esos dos
    // handlers ya normalizan `data` (uniqueId/userDetails), no confirmado
    // todavía contra un LIVE real para el evento `like` puntualmente — ver
    // aviso en el plan antes de confiar en Top Tap-Tap para un directo real.
    handleLikeEvent(data) {
        const username = data.uniqueId;
        const likeCount = Number(data.likeCount) || 0;
        if (!username || likeCount <= 0) return;

        const avatar = data.userDetails?.profilePictureUrls?.[0] || '';
        this.processLikeTapTap(username, avatar, likeCount);
    }

    // Reenviamos únicamente los datos necesarios para que el panel decida
    // qué voces pueden entrar al TTS. La síntesis ocurre en el navegador del
    // streamer; el backend nunca reproduce ni almacena los comentarios.
    handleChatEvent(data) {
        const comment = typeof data.comment === 'string' ? data.comment.trim() : '';
        if (!comment) return;

        const badges = Array.isArray(data.userBadges) ? data.userBadges : [];
        const badgeText = badges.map((badge) => [badge.type, badge.name, badge.url].filter(Boolean).join(' ')).join(' ').toLowerCase();
        const identity = data.userIdentity || {};

        this.broadcast.emit('tts_chat_message', {
            id: data.msgId || `${Date.now()}-${data.userId || data.uniqueId || 'chat'}`,
            username: data.nickname || data.uniqueId || 'Usuario',
            comment: comment.slice(0, 300),
            isModerator: Boolean(data.isModerator || identity.isModeratorOfAnchor),
            isSuperFan: badgeText.includes('superfan') || badgeText.includes('super_fan') || badgeText.includes('super fan'),
            isSubscriber: Boolean(data.isSubscriber || identity.isSubscriberOfAnchor),
            fanLevel: Math.max(0, Number(data.teamMemberLevel) || Number(data.user?.fansClubInfo?.fansLevel) || 0),
        });

        this.processRouletteComment(data);
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

    processGiftKing({ username, avatar, giftName }) {
        if (!this.contestState.isActive || this.contestState.mode === 'finished' || this.contestState.paused) return;

        if (this.contestState.instaWinGiftName && giftName.toLowerCase() === this.contestState.instaWinGiftName.toLowerCase()) {
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

        if (giftName.toLowerCase() === this.contestState.targetGiftName.toLowerCase()) {
            this.contestState.lastParticipant = { username, avatar, giftName };
            this.contestState.mode = 'main';
            this.contestState.timeLeft = this.contestState.mainTime;
            this.broadcast.emit('gift_received', this.contestState);
        }
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

    // ==========================================
    // LÓGICA: ELIMINACIÓN
    // ==========================================
    getElimPublicState() {
        return {
            isActive: this.elimState.isActive, mode: this.elimState.mode, paused: this.elimState.paused,
            targetGiftName: this.elimState.targetGiftName, targetGiftIcon: this.elimState.targetGiftIcon, targetGiftCoins: this.elimState.targetGiftCoins,
            instaWinGiftName: this.elimState.instaWinGiftName, instaWinGiftIcon: this.elimState.instaWinGiftIcon, instaWinGiftCoins: this.elimState.instaWinGiftCoins,
            baseTime: this.elimState.baseTime, rejoinTime: this.elimState.rejoinTime, timeLeft: this.elimState.timeLeft,
            participants: this.elimState.participants,
            revealTargetId: this.elimState.revealTargetId, revealDurationMs: ELIM_REVEAL_MS,
            lastEliminated: this.elimState.lastEliminated, winner: this.elimState.winner,
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
    // directamente; si no, se elige el slot que va a caer y arranca la
    // animación de "sorteo" en el overlay — recién cuando esa animación termina
    // se elimina el slot de verdad y arranca el tiempo de rejoin.
    beginEliminationReveal() {
        const pool = this.elimState.participants;
        const distinctUsers = new Set(pool.map(p => p.username));

        if (distinctUsers.size <= 1) {
            this.finishElimination();
            return;
        }

        const idx = Math.floor(Math.random() * pool.length);
        this.elimState.mode = 'revealing';
        this.elimState.revealTargetId = pool[idx].id;
        console.log(`[${this.licenseId}] [ELIMINACION] 🎯 SORTEANDO...`);
        this.broadcast.emit('elim_reveal_started', this.getElimPublicState());

        if (this.elimRevealTimeout) clearTimeout(this.elimRevealTimeout);
        this.elimRevealTimeout = setTimeout(() => this.resolveEliminationReveal(), ELIM_REVEAL_MS);
    }

    resolveEliminationReveal() {
        this.elimRevealTimeout = null;
        const pool = this.elimState.participants;
        const idx = pool.findIndex(p => p.id === this.elimState.revealTargetId);
        const victimSlot = idx !== -1 ? pool.splice(idx, 1)[0] : null;
        this.elimState.revealTargetId = null;

        if (victimSlot) {
            const stillHasSlots = pool.some(p => p.username === victimSlot.username);
            this.elimState.lastEliminated = { username: victimSlot.username, avatar: victimSlot.avatar, final: !stillHasSlots };
            console.log(`[${this.licenseId}] [ELIMINACION] 💀 SLOT ELIMINADO: @${victimSlot.username}${stillHasSlots ? ' (le quedan slots)' : ' (fuera del todo)'}`);
        }

        this.elimState.mode = 'rejoin';
        this.elimState.timeLeft = this.elimState.rejoinTime;
        this.broadcast.emit('elim_eliminated', this.getElimPublicState());
    }

    startElimTimer() {
        if (this.elimTimerInterval) clearInterval(this.elimTimerInterval);

        this.elimTimerInterval = setInterval(() => {
            if (!this.elimState.isActive || this.elimState.mode === 'revealing' || this.elimState.paused) return;
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

    processGiftElim({ username, avatar, giftName, repeatCount }) {
        if (!this.elimState.isActive || this.elimState.paused) return;
        // 'revealing' (la animación de sorteo) también acepta regalos: antes se
        // ignoraban del todo y esos usuarios se quedaban afuera de la siguiente
        // ronda de rejoin sin darse cuenta. Ahora entran igual, solo que no
        // participan del sorteo que ya está en curso (arrancó con la lista de
        // antes) — quedan listos para la ronda que sigue apenas termine.
        if (this.elimState.mode !== 'joining' && this.elimState.mode !== 'rejoin' && this.elimState.mode !== 'revealing') return;

        if (this.elimState.instaWinGiftName && giftName.toLowerCase() === this.elimState.instaWinGiftName.toLowerCase()) {
            // Si llega durante la animación, cancelamos el sorteo pendiente para
            // que no se resuelva después y pise este resultado.
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

        if (!this.elimState.targetGiftName || giftName.toLowerCase() !== this.elimState.targetGiftName.toLowerCase()) return;

        // Admite duplicados: cada regalo (o cada unidad de un combo) agrega un
        // slot nuevo, aunque el usuario ya esté participando.
        const slotsToAdd = Math.max(1, repeatCount || 1);
        for (let i = 0; i < slotsToAdd; i++) {
            this.elimSlotCounter += 1;
            this.elimState.participants.push({ id: this.elimSlotCounter, username, avatar });
        }
        this.broadcast.emit('elim_state_update', this.getElimPublicState());
    }

    // ==========================================
    // LÓGICA: RULETA (sorteo por comentario o por regalo)
    // ==========================================
    getRoulettePublicState() {
        return {
            isActive: this.rouletteState.isActive, mode: this.rouletteState.mode,
            entryMode: this.rouletteState.entryMode,
            keyword: this.rouletteState.keyword, followersOnly: this.rouletteState.followersOnly,
            entryWindowSec: this.rouletteState.entryWindowSec,
            targetGiftName: this.rouletteState.targetGiftName, targetGiftIcon: this.rouletteState.targetGiftIcon, targetGiftCoins: this.rouletteState.targetGiftCoins,
            winnerRule: this.rouletteState.winnerRule, winnerPosition: this.rouletteState.winnerPosition,
            timeLeft: this.rouletteState.timeLeft,
            entries: this.rouletteState.entries,
            lastEliminated: this.rouletteState.lastEliminated, winner: this.rouletteState.winner,
        };
    }

    startRouletteTimer() {
        if (this.rouletteTimerInterval) clearInterval(this.rouletteTimerInterval);

        this.rouletteTimerInterval = setInterval(() => {
            if (!this.rouletteState.isActive || this.rouletteState.mode !== 'joining') return;
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
        this.rouletteState.lastEliminated = null;
        console.log(`[${this.licenseId}] [RULETA] 🎡 GIRANDO — ${total} entradas, ganadora en la posición ${winnerPos}`);
        this.broadcast.emit('roulette_spin_started', this.getRoulettePublicState());
        this.stepRouletteReveal();
    }

    // Revela un lugar a la vez del shuffle ya armado. Al llegar al índice
    // ganador, para ahí — no hace falta seguir revelando el resto de la
    // lista. El delay antes de cada paso se achica cerca del final (ver
    // ROULETTE_REVEAL_DELAY_MS) para el efecto de suspenso pedido.
    stepRouletteReveal() {
        const { revealOrder, winnerIndex, revealCursor } = this.rouletteState;
        const entry = revealOrder[revealCursor];

        if (revealCursor === winnerIndex) {
            this.rouletteState.mode = 'finished';
            this.rouletteState.winner = { username: entry.username, avatar: entry.avatar };
            this.rouletteState.lastEliminated = null;
            console.log(`[${this.licenseId}] [RULETA] 👑 GANADORA: @${entry.username}`);
            this.broadcast.emit('roulette_winner_declared', this.getRoulettePublicState());
            this.maybeDisconnectTikTok();
            return;
        }

        this.rouletteState.lastEliminated = { username: entry.username, avatar: entry.avatar };
        this.broadcast.emit('roulette_step', this.getRoulettePublicState());

        this.rouletteState.revealCursor += 1;
        const distanceToWinner = this.rouletteState.winnerIndex - this.rouletteState.revealCursor;
        const delay = ROULETTE_REVEAL_DELAY_MS[distanceToWinner] ?? ROULETTE_REVEAL_DELAY_DEFAULT_MS;
        this.rouletteRevealTimeout = setTimeout(() => this.stepRouletteReveal(), delay);
    }

    // Modo Chat: comentar la keyword configurada (opcionalmente solo
    // seguidores, ver data.followRole — normalizado por tiktok-live-connector
    // desde followInfo.followStatus) da UNA vida, sin importar cuántas veces
    // vuelva a comentar la misma persona.
    processRouletteComment(data) {
        const state = this.rouletteState;
        if (!state.isActive || state.mode !== 'joining' || state.entryMode !== 'chat') return;

        const comment = typeof data.comment === 'string' ? data.comment.trim().toLowerCase() : '';
        const keyword = (state.keyword || '').trim().toLowerCase();
        if (!keyword || !comment.includes(keyword)) return;
        if (state.followersOnly && !(Number(data.followRole) > 0)) return;

        const username = data.uniqueId;
        if (!username || state.entries.some(e => e.username === username)) return;

        state.entries.push({ id: ++this.rouletteSlotCounter, username, avatar: data.userDetails?.profilePictureUrls?.[0] || '' });
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
    }

    // Modo Gift: mandar el regalo configurado suma una entrada POR CADA
    // unidad del combo — mismo mecanismo de slots que ya usa Eliminación
    // (más regalos, más chances, a propósito).
    processGiftRoulette({ username, avatar, giftName, repeatCount, followRole }) {
        const state = this.rouletteState;
        if (!state.isActive || state.mode !== 'joining' || state.entryMode !== 'gift') return;
        if (!state.targetGiftName || giftName.toLowerCase() !== state.targetGiftName.toLowerCase()) return;
        if (state.followersOnly && !(Number(followRole) > 0)) return;

        const slotsToAdd = Math.max(1, repeatCount || 1);
        for (let i = 0; i < slotsToAdd; i++) {
            state.entries.push({ id: ++this.rouletteSlotCounter, username, avatar });
        }
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
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
        this.broadcast.emit('taptap_state_update', this.getTapTapPublicState());
    }

    // ==========================================
    // SOCKET.IO: conecta un socket individual de este tenant.
    // El aislamiento entre licencias ya está resuelto por el room de
    // Socket.io (el caller hace socket.join(this.licenseId) antes de
    // llamar a este método); acá solo hace falta registrar los handlers
    // de siempre, delegando a los métodos de instancia.
    // ==========================================
    attachSocket(socket) {
        // Sincronizar al nuevo cliente al instante
        socket.emit('state_update', this.contestState);
        socket.emit('zub_state_update', this.getZubPublicState());
        socket.emit('elim_state_update', this.getElimPublicState());
        socket.emit('roulette_state_update', this.getRoulettePublicState());
        socket.emit('gifter_state_update', this.getGifterPublicState());
        socket.emit('taptap_state_update', this.getTapTapPublicState());
        socket.emit('active_app_changed', this.activeApp);
        socket.emit('live_status', { username: this.currentTikTokUsername, connected: this.liveConnected });
        socket.emit('prizes_updated', this.prizes);
        socket.emit('theme_updated', this.theme);
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

        // ── PREMIOS ─────────────────────────────────
        // La imagen llega ya redimensionada por el cliente (~100px de lado)
        // como data URL; igual se valida acá tamaño y formato para que un
        // cliente malicioso no infle la memoria del tenant ni meta HTML.
        socket.on('update_prize', ({ app, title, image } = {}) => {
            if (!['king', 'zub', 'elim', 'roulette'].includes(app)) return;
            const cleanTitle = typeof title === 'string' ? title.slice(0, 60).trim() : '';
            const cleanImage = (typeof image === 'string' && image.startsWith('data:image/') && image.length <= 500000)
                ? image : null;
            this.prizes[app] = (cleanTitle || cleanImage) ? { title: cleanTitle, image: cleanImage } : null;
            this.broadcast.emit('prizes_updated', this.prizes);
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

                // A propósito NO se toca timeLeft acá: cambiar el tiempo no debe
                // recortar/alargar la fase que está corriendo en este momento (eso
                // reiniciaba el conteo del participante actual de la nada). El
                // nuevo valor queda guardado y se aplica solo la próxima vez que
                // esa fase arranca de cero (alguien roba el lugar -> nuevo mainTime;
                // se acaba el main -> nuevo snipeTime).
                this.broadcast.emit('state_update', this.contestState);
            }
        });

        socket.on('stop_contest', () => {
            this.contestState.isActive = false;
            this.contestState.mode = 'idle';
            this.contestState.paused = false;
            if (this.kingTimerInterval) clearInterval(this.kingTimerInterval);
            this.broadcast.emit('state_update', this.contestState);
            this.maybeDisconnectTikTok();
        });

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

        socket.on('stop_zubastinis', () => {
            this.zubState.isActive = false;
            this.zubState.mode = 'idle';
            this.zubState.paused = false;
            this.zubState.tiebreakUsernames = [];
            if (this.zubTimerInterval) clearInterval(this.zubTimerInterval);
            this.broadcast.emit('zub_state_update', this.getZubPublicState());
            this.maybeDisconnectTikTok();
        });

        // ── ELIMINACIÓN ──────────────────────────────
        socket.on('start_elimination', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO ELIMINACIÓN...`);
            db.incrementUsage(this.licenseId, 'elim_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(elim_starts):`, err.message));

            if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
            this.elimState = {
                isActive: true, mode: 'joining', paused: false,
                targetGiftName: config.targetGiftName, targetGiftIcon: config.targetGiftIcon, targetGiftCoins: config.targetGiftCoins,
                instaWinGiftName: config.instaWinGiftName || '', instaWinGiftIcon: config.instaWinGiftIcon || '', instaWinGiftCoins: config.instaWinGiftCoins || 0,
                baseTime: config.baseTime, rejoinTime: config.rejoinTime, timeLeft: config.baseTime,
                participants: [], revealTargetId: null, lastEliminated: null, winner: null,
            };
            this.elimSlotCounter = 0;
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
                this.elimState.mode = 'joining';
                this.elimState.paused = false;
                this.elimState.timeLeft = this.elimState.baseTime;
                this.elimState.participants = [];
                this.elimState.revealTargetId = null;
                this.elimState.lastEliminated = null;
                this.elimState.winner = null;
                this.elimSlotCounter = 0;
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

                // Igual que en Rey del Trono: no se toca timeLeft. La fase que
                // esté corriendo sigue con el tiempo que ya tenía; el valor nuevo
                // se aplica solo la próxima vez que esa fase arranca de cero
                // (próxima ventana de unirse o próxima ventana de rejoin).
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        socket.on('stop_elimination', () => {
            this.elimState.isActive = false;
            this.elimState.mode = 'idle';
            if (this.elimTimerInterval) clearInterval(this.elimTimerInterval);
            if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            this.maybeDisconnectTikTok();
        });

        // ── RULETA ──────────────────────────────────
        // No hay evento de "girar" manual: el giro arranca solo al vencer
        // entryWindowSec (ver startRouletteTimer) — pedido explícito.
        socket.on('start_roulette', (config) => {
            console.log(`\n[${this.licenseId}] [JUEGO] ▶️ INICIANDO RULETA (${config.entryMode === 'gift' ? 'modo regalo' : 'modo chat'})...`);
            db.incrementUsage(this.licenseId, 'roulette_starts').catch(err => console.error(`[${this.licenseId}] [DB] incrementUsage(roulette_starts):`, err.message));

            if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
            this.rouletteState = {
                isActive: true, mode: 'joining',
                entryMode: config.entryMode === 'gift' ? 'gift' : 'chat',
                keyword: config.keyword || '', followersOnly: !!config.followersOnly,
                entryWindowSec: config.entryWindowSec,
                targetGiftName: config.targetGiftName || '', targetGiftIcon: config.targetGiftIcon || '', targetGiftCoins: config.targetGiftCoins || 0,
                winnerRule: config.winnerRule || 'first', winnerPosition: config.winnerPosition || 1,
                timeLeft: config.entryWindowSec,
                entries: [], revealOrder: [], winnerIndex: -1, revealCursor: 0,
                lastEliminated: null, winner: null,
            };
            this.rouletteSlotCounter = 0;
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            this.startRouletteTimer();

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        socket.on('restart_roulette', () => {
            if (!this.rouletteState.isActive) return;
            console.log(`\n[${this.licenseId}] [JUEGO] ⟲ REINICIANDO RULETA...`);
            if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
            this.rouletteState.mode = 'joining';
            this.rouletteState.timeLeft = this.rouletteState.entryWindowSec;
            this.rouletteState.entries = [];
            this.rouletteState.revealOrder = [];
            this.rouletteState.winnerIndex = -1;
            this.rouletteState.revealCursor = 0;
            this.rouletteState.lastEliminated = null;
            this.rouletteState.winner = null;
            this.rouletteSlotCounter = 0;
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            this.startRouletteTimer();
        });

        socket.on('stop_roulette', () => {
            this.rouletteState.isActive = false;
            this.rouletteState.mode = 'idle';
            if (this.rouletteTimerInterval) clearInterval(this.rouletteTimerInterval);
            if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
            this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
            this.maybeDisconnectTikTok();
        });

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
            this.broadcast.emit('taptap_state_update', this.getTapTapPublicState());
        });

        // ─────────────────────────────────────────────
        // EVENTOS PARA EL OVERLAY MULTI-APP
        // (Color Says ya no participa: se transmite directo desde su pantalla)
        // ─────────────────────────────────────────────
        socket.on('set_active_app', (appId) => {
            this.activeApp = appId;
            this.broadcast.emit('active_app_changed', this.activeApp);
        });

        // ── TEMA (panel -> overlay) ──────────────────
        // El panel emite esto cada vez que el streamer cambia de skin (y una
        // vez al conectar, para sincronizar el estado inicial). Se reenvía a
        // TODO el room, overlay incluido, así el streamer y su audiencia ven
        // siempre el mismo skin.
        socket.on('set_theme', (theme) => {
            const style = VALID_THEME_STYLES.includes(theme?.style) ? theme.style : this.theme.style;
            const accent = VALID_THEME_ACCENTS.includes(theme?.accent) ? theme.accent : this.theme.accent;
            if (style === this.theme.style && accent === this.theme.accent) return;
            this.theme = { style, accent };
            this.broadcast.emit('theme_updated', this.theme);
        });
    }
}

module.exports = Tenant;
