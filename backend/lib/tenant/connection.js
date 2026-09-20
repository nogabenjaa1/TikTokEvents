// Conexión con TikTok: reconexión, guardián, verificación de usuario y limpieza.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const { WebcastPushConnection } = require('tiktok-live-connector/legacy');
const db = require('../../db');
const {
    TIKTOK_CONNECT_TIMEOUT_MS,
    WATCHDOG_CHECK_INTERVAL_MS,
    WATCHDOG_TIMEOUT_MS,
    SHORT_CONNECTION_THRESHOLD_MS,
    MAX_CONSECUTIVE_SHORT_DISCONNECTS,
    TikTokConnectTimeoutError,
    RECONNECT_BACKOFF_MS,
    RECONNECT_LOG_EVERY,
} = require('../../lib/tenantHelpers');

module.exports = {
    // Un tenant se puede sacar de memoria cuando nadie lo usa: sin sockets
    // (ni panel ni overlays de OBS), sin nada activo ni conexión con TikTok
    // (anyContestNeedsConnection cubre juegos, extensible, objetivo y el
    // usuario deseado), y sin actividad de sockets hace `idleMs`. Todo lo
    // que importa se guarda en la DB y se vuelve a cargar al reconectarse
    // (ver loadPersistedSettings); solo se pierde estado efímero como los
    // rankings de Top Gifter/Tap-Tap y la cola de Spotify, que igual se
    // reinician al empezar un directo nuevo.
    isEvictable(hasSockets, idleMs) {
        if (hasSockets) return false;
        if (this.liveConnected || this.connectingPromise || this.anyContestNeedsConnection()) return false;
        return Date.now() - this.lastSocketActivityAt >= idleMs;
    },

    // Libera todo lo que este tenant tuviera vivo (timers/conexión) antes de
    // quitarlo del Map de server.js.
    dispose() {
        this.disconnectTikTok();
        this.openGiftCombos.forEach(({ timer }) => clearTimeout(timer));
        this.openGiftCombos.clear();
        this.stopSpotifyQueuePolling();
        this.stopRuntimePersistence();
        this.persistRuntimeState(true); // deja guardado que ya no hay nada activo
        if (this.goalPersistTimer) this.persistGoalProgress(); // guarda lo último pendiente antes de soltar el tenant
        if (this.tapTapDiagnosticsBroadcastTimer) { clearTimeout(this.tapTapDiagnosticsBroadcastTimer); this.tapTapDiagnosticsBroadcastTimer = null; }
    },

    // ==========================================
    // CONEXIÓN TIKTOK
    // ==========================================
    anyContestNeedsConnection() {
        return this.contestState.isActive || this.zubState.isActive || this.elimState.isActive || this.rouletteState.isActive || this.extensibleState.isActive || this.goalState.isActive || !!this.desiredUsername;
    },

    disconnectTikTok() {
        if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }
        if (this.watchdogInterval) { clearInterval(this.watchdogInterval); this.watchdogInterval = null; }
        if (this.tiktokConnection) {
            this.tiktokConnection.removeAllListeners();
            this.tiktokConnection.disconnect();
        }
        this.tiktokConnection = null;
        this.currentTikTokUsername = null;
        this.liveConnected = false;
        this.connectingPromise = null;
        this.wasEverConnected = false;
        this.connectedAt = null;
        this.consecutiveShortDisconnects = 0;
        this.reconnectAttempts = 0;

        // Ráfagas de tap-tap en curso quedan huérfanas si la conexión se cae
        // a mitad de una: sin esto, sus timers seguirían vivos apuntando a
        // un tenant que ya no está escuchando likes.
        Object.values(this.tapTapPending).forEach((p) => clearTimeout(p.timer));
        this.tapTapPending = {};


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
    },

    maybeDisconnectTikTok() {
        if (!this.anyContestNeedsConnection()) this.disconnectTikTok();
    },

    // Corre cada WATCHDOG_CHECK_INTERVAL_MS mientras dure una conexion
    // (arrancado/detenido junto con ella, ver ensureTikTokConnection/
    // disconnectTikTok). `username` se pasa explicito (no se lee
    // this.currentTikTokUsername directo) para que un watchdog viejo de
    // una conexion ya reemplazada nunca actue sobre la nueva -- el chequeo
    // de mas abajo lo confirma de todos modos, pero esto deja la intencion
    // clara.
    checkTikTokWatchdog(username) {
        if (!this.liveConnected || this.currentTikTokUsername !== username) return;
        const silentForMs = Date.now() - (this.lastTikTokMessageAt || 0);
        if (silentForMs < WATCHDOG_TIMEOUT_MS) return;
        console.warn(`[${this.logId}] [TIKTOK] 🧟 Sin mensajes hace ${Math.round(silentForMs / 1000)}s pese a seguir "conectado" -- se fuerza una reconexión.`);
        this.liveConnected = false;
        if (this.watchdogInterval) { clearInterval(this.watchdogInterval); this.watchdogInterval = null; }
        this.broadcast.emit('live_disconnected');
        this.scheduleReconnect(username);
    },

    // Reconexión manual pedida desde el panel (botón "Reconectar TikTok"):
    // mismo camino que la reconexión automática del guardián -- conserva
    // rankings y partidas (no toca wasEverConnected) y suelta la conexión
    // vieja dentro de ensureTikTokConnection. Se ignora si se pidió hace
    // menos de 5 s, para que un doble clic no dispare dos conexiones.
    forceReconnect() {
        const username = this.desiredUsername || this.currentTikTokUsername;
        if (!username) return;
        const now = Date.now();
        if (now - (this.lastForceReconnectAt || 0) < 5000) return;
        this.lastForceReconnectAt = now;
        this.reconnectAttempts = 0;
        console.log(`[${this.logId}] [TIKTOK] 🔄 Reconexión manual pedida desde el panel.`);
        if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }
        if (this.watchdogInterval) { clearInterval(this.watchdogInterval); this.watchdogInterval = null; }
        this.liveConnected = false;
        this.connectingPromise = null;
        this.connectedAt = null;
        this.consecutiveShortDisconnects = 0;
        this.broadcast.emit('live_disconnected');
        this.ensureTikTokConnection(username).catch(() => {});
    },

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
    },

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
    },

    scheduleReconnect(username) {
        if (!this.anyContestNeedsConnection()) return;
        if (this.retryTimeout) clearTimeout(this.retryTimeout);
        // Espera creciente según los intentos fallidos seguidos (ver
        // RECONNECT_BACKOFF_MS): 0 o 1 fallo -> 3 s, y sube hasta 60 s.
        const step = Math.min(Math.max(0, this.reconnectAttempts - 1), RECONNECT_BACKOFF_MS.length - 1);
        this.retryTimeout = setTimeout(() => this.ensureTikTokConnection(username).catch(() => {}), RECONNECT_BACKOFF_MS[step]);
    },

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
        // Con la cuenta todavía sin estar en vivo esto se repetía cada 3 s: se
        // loguea el primer intento y luego solo cada RECONNECT_LOG_EVERY.
        const verbose = this.reconnectAttempts === 0 || this.reconnectAttempts % RECONNECT_LOG_EVERY === 0;
        if (verbose) console.log(`[${this.logId}] [TIKTOK] 📡 Intentando conectar a @${username}...${this.reconnectAttempts > 0 ? ` (intento ${this.reconnectAttempts + 1})` : ''}`);
        // Diagnóstico sin exponer el valor: si esto imprime "false" con la
        // variable YA puesta en Render, el problema es que no está llegando
        // al proceso (nombre mal escrito, falta redeploy, etc.) — no un
        // límite del plan de Euler Stream.
        if (this.reconnectAttempts === 0) console.log(`[${this.logId}] [TIKTOK] SIGN_API_KEY presente: ${Boolean(process.env.SIGN_API_KEY)}`);

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
            this.tiktokConnection.on('emote', (data) => this.handleEmoteEvent(data));
            // 'roomUser' (estadísticas de espectadores, para el overlay de
            // chat) -- ver handleRoomUserEvent y el comentario grande en
            // server.js sobre por qué antes nunca se escuchaba esto.
            this.tiktokConnection.on('roomUser', (data) => this.handleRoomUserEvent(data));
            // Cualquier mensaje (no solo los que procesamos) cuenta como
            // señal de vida -- ver WATCHDOG_TIMEOUT_MS.
            this.tiktokConnection.on('rawData', () => { this.lastTikTokMessageAt = Date.now(); });
            this.tiktokConnection.on('error', ({ info, exception } = {}) => {
                const message = exception?.message || info || 'Error interno del conector';
                // "No está en vivo" ya lo reporta el catch de connect() con su
                // propio mensaje: no se duplica acá.
                if (/isn't online|offline/i.test(String(message))) return;
                console.error(`[${this.logId}] [TIKTOK] ⚠️ ${message}`);
            });
            this.tiktokConnection.on('disconnected', () => {
                console.log(`[${this.logId}] [TIKTOK] 🔌 Desconectado de @${username}`);
                this.liveConnected = false;
                this.viewerCount = 0;
                this.broadcast.emit('live_disconnected');
                this.broadcast.emit('viewer_count_update', { viewerCount: 0 });

                // Circuit-breaker (ver SHORT_CONNECTION_THRESHOLD_MS más
                // arriba): esta conexión duró muy poco -- probablemente el
                // LIVE ya terminó y TikTok solo dejó pasar el handshake
                // antes de cortar, en vez de rechazar connect() directo
                // (ese otro caso ya lo cubre isUserOfflineError más abajo).
                const durationMs = this.connectedAt ? Date.now() - this.connectedAt : Infinity;
                this.connectedAt = null;
                if (durationMs < SHORT_CONNECTION_THRESHOLD_MS) {
                    this.consecutiveShortDisconnects += 1;
                } else {
                    this.consecutiveShortDisconnects = 0;
                }

                if (this.consecutiveShortDisconnects >= MAX_CONSECUTIVE_SHORT_DISCONNECTS) {
                    console.log(`[${this.logId}] [TIKTOK] 🛑 @${username} se desconectó ${this.consecutiveShortDisconnects} veces seguidas casi al instante — probablemente el LIVE ya terminó, se corta el reintento automático.`);
                    this.consecutiveShortDisconnects = 0;
                    this.wasEverConnected = false;
                    this.desiredUsername = null;
                    this.stopAllActiveGames();
                    this.broadcast.emit('live_stream_ended', { username });
                    this.maybeDisconnectTikTok();
                    return;
                }

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
            console.error(`[${this.logId}] [TIKTOK] ❌ Error sincrónico al armar la conexión:`, err);
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
            console.log(`[${this.logId}] [TIKTOK] ✅ ¡CONECTADO!`);
            this.reconnectAttempts = 0;
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
            this.connectedAt = Date.now();
            this.connectingPromise = null;
            this.lastTikTokMessageAt = Date.now();
            if (this.watchdogInterval) clearInterval(this.watchdogInterval);
            this.watchdogInterval = setInterval(() => this.checkTikTokWatchdog(username), WATCHDOG_CHECK_INTERVAL_MS);
            this.broadcast.emit('live_connected', username);
        }).catch(err => {
            const offline = this.isUserOfflineError(err);
            this.reconnectAttempts += 1;
            // Cuenta sin estar en vivo: se avisa el primer fallo y luego cada
            // RECONNECT_LOG_EVERY intentos (los demás son ruido idéntico).
            if (!offline || this.reconnectAttempts === 1 || this.reconnectAttempts % RECONNECT_LOG_EVERY === 0) {
                const nextS = Math.round(RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempts - 1, RECONNECT_BACKOFF_MS.length - 1)] / 1000);
                console.error(`[${this.logId}] [TIKTOK] ❌ Error con @${username}: ${err.message}${offline ? ` — intento ${this.reconnectAttempts}, se reintenta con espera creciente (próximo en ${nextS} s)` : ''}`);
            }
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
                console.log(`[${this.logId}] [TIKTOK] 🛑 @${username} ya no está en vivo — se corta el reintento automático.`);
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
    },

    isUserOfflineError(error) {
        const raw = String(error?.message || '').toLowerCase();
        return error?.name === 'UserOfflineError' || raw.includes("isn't online") || raw.includes('offline');
    },

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
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerConnectionHandlers(socket) {
        // ── VERIFICACIÓN DE USUARIO LIVE (independiente de cualquier módulo) ──
        socket.on('set_desired_username', (uname) => {
            const nextDesiredUsername = uname && uname.trim() ? uname.trim().replace(/^@+/, '') : null;
            // Un reintento ya agendado (ver scheduleReconnect) capturó el
            // username VIEJO en su closure y no vuelve a chequear
            // `desiredUsername` antes de disparar — sin cortarlo acá,
            // seguía reconectándose solo al username abandonado para
            // siempre (bug real: logs de "Intentando conectar" sin fin
            // tras limpiar el campo).
            if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }
            if (nextDesiredUsername !== this.desiredUsername) this.reconnectAttempts = 0;
            this.desiredUsername = nextDesiredUsername;
            if (this.desiredUsername) {
                this.ensureTikTokConnection(this.desiredUsername).catch(() => {});
            } else {
                this.maybeDisconnectTikTok();
            }
        });

        socket.on('force_reconnect', () => this.forceReconnect());
    },
};
