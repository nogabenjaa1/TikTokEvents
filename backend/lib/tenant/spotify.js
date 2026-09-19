// Spotify: cola de pedidos, comandos del chat y "now playing".
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const spotify = require('../../spotify');
const {
    SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT,
    SPOTIFY_QUEUE_INTERNAL_CAP,
    SPOTIFY_POLL_INTERVAL_MS,
} = require('../../lib/tenantHelpers');

module.exports = {
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
    },

    getSpotifySettingsPublicState() {
        return { ...this.spotifySettings };
    },

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
    },

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
            console.log(`[${this.logId}] [SPOTIFY] "${comment}" de @${username} ignorado — el comando está DESACTIVADO en el panel.`);
            return;
        }
        if (!username) return;

        if (/^!skip\s*$/i.test(comment)) {
            if (!this.isAuthorizedForSpotifyCommands(data, identity)) {
                console.log(`[${this.logId}] [SPOTIFY] !skip de @${username} RECHAZADO — no cumple los permisos configurados (settings: ${JSON.stringify(this.spotifySettings)}).`);
                return;
            }
            console.log(`[${this.logId}] [SPOTIFY] !skip de @${username} autorizado — saltando canción...`);
            this.skipSpotifyTrack().catch((err) => {
                console.error(`[${this.logId}] [SPOTIFY] Error inesperado en !skip de @${username}:`, err.message);
            });
            return;
        }

        if (/^!revoke\s*$/i.test(comment)) {
            console.log(`[${this.logId}] [SPOTIFY] !revoke de @${username} — sacando sus pedidos de la lista.`);
            this.revokeSpotifyRequest(username);
            return;
        }

        const match = /^!play\s+(.+)/i.exec(comment);
        if (!match) {
            console.log(`[${this.logId}] [SPOTIFY] "${comment}" de @${username} — !play sin texto después, ignorado.`);
            return;
        }
        const query = match[1].trim();
        if (!query) return;
        if (!this.isAuthorizedForSpotifyCommands(data, identity)) {
            console.log(`[${this.logId}] [SPOTIFY] !play "${query}" de @${username} RECHAZADO — no cumple los permisos configurados (settings: ${JSON.stringify(this.spotifySettings)}, isModerator: ${data.isModerator}, isSubscriber: ${data.isSubscriber}, teamMemberLevel: ${data.teamMemberLevel}).`);
            return;
        }

        console.log(`[${this.logId}] [SPOTIFY] !play "${query}" de @${username} autorizado — buscando en Spotify...`);
        this.requestSpotifySong(username, query).catch((err) => {
            console.error(`[${this.logId}] [SPOTIFY] Error inesperado en !play de @${username}:`, err.message);
        });
    },

    // Salta a la siguiente canción en la reproducción REAL de Spotify
    // (POST /me/player/next) — a diferencia de !revoke, esto sí actúa sobre
    // la cola de verdad, no solo sobre nuestra lista de "lo pedido".
    async skipSpotifyTrack() {
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) {
            console.log(`[${this.logId}] [SPOTIFY] !skip ignorado — no hay ninguna cuenta de Spotify conectada.`);
            return;
        }
        let accessToken;
        try {
            accessToken = await spotify.getValidAccessToken(account);
        } catch (err) {
            console.error(`[${this.logId}] [SPOTIFY] No se pudo renovar el token para !skip:`, err.message);
            this.broadcast.emit('spotify_error', { message: 'Tu conexión con Spotify venció — reconéctala desde el panel.' });
            return;
        }
        try {
            await spotify.skipToNext(accessToken);
            console.log(`[${this.logId}] [SPOTIFY] !skip OK.`);
        } catch (err) {
            console.error(`[${this.logId}] [SPOTIFY] !skip falló — code: ${err.code || 'N/A'}, mensaje: ${err.message}`);
            this.broadcast.emit('spotify_error', { message: this.describeSpotifyError(err) });
        }
    },

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
    },

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
    },

    // Busca la canción en Spotify y la agrega a la cola DEL STREAMER (su
    // cuenta conectada, ver /api/spotify/connect). Los errores esperables
    // (sin cuenta conectada, sin dispositivo activo, sin Premium) se
    // reportan al panel vía `spotify_error` — nunca al chat, el streamer es
    // quien decide si lo comenta en vivo o no.
    async requestSpotifySong(username, query) {
        const account = await db.getSpotifyAccount(this.licenseId);
        if (!account) {
            console.log(`[${this.logId}] [SPOTIFY] !play ignorado — no hay ninguna cuenta de Spotify conectada.`);
            return; // streamer no conectó Spotify — !play no hace nada, en silencio
        }

        let accessToken;
        try {
            accessToken = await spotify.getValidAccessToken(account);
            console.log(`[${this.logId}] [SPOTIFY] Token OK (renovado si hacía falta).`);
        } catch (err) {
            console.error(`[${this.logId}] [SPOTIFY] No se pudo renovar el token para !play:`, err.message);
            this.broadcast.emit('spotify_error', { message: 'Tu conexión con Spotify venció — reconéctala desde el panel.' });
            return;
        }

        const track = await spotify.searchTrack(accessToken, query);
        if (!track) {
            console.log(`[${this.logId}] [SPOTIFY] Búsqueda de "${query}" no encontró ninguna canción.`);
            this.broadcast.emit('spotify_error', { message: `@${username} pidió "${query}" — no se encontró ninguna canción.` });
            return;
        }
        console.log(`[${this.logId}] [SPOTIFY] Encontrado: "${track.name}" (${(track.artists || []).map((a) => a.name).join(', ')}) — agregando a la cola...`);

        try {
            await spotify.addToQueue(accessToken, track.uri);
            console.log(`[${this.logId}] [SPOTIFY] !play OK — agregada a la cola real de Spotify.`);
        } catch (err) {
            console.error(`[${this.logId}] [SPOTIFY] addToQueue falló — code: ${err.code || 'N/A'}, mensaje: ${err.message}`);
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
    },

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
    },

    stopSpotifyQueuePolling() {
        if (this.spotifyPollInterval) {
            clearInterval(this.spotifyPollInterval);
            this.spotifyPollInterval = null;
        }
    },

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
    },

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
            console.error(`[${this.logId}] [SPOTIFY] Polling: no se pudo renovar el token, reintenta en el próximo tick:`, err.message);
            return;
        }

        let live;
        try {
            live = await spotify.getQueue(accessToken);
        } catch (err) {
            console.error(`[${this.logId}] [SPOTIFY] Polling: no se pudo leer la cola real, reintenta en el próximo tick:`, err.message);
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
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerSpotifyHandlers(socket) {
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
            // Pedido explícito: que sobreviva a un reinicio del server y a
            // entrar desde otro dispositivo -- fire-and-forget, la copia en
            // memoria ya se actualizó y ya se reenvió arriba, esto solo la
            // deja guardada para la próxima vez que se cree este Tenant.
            db.setSpotifySettings(this.licenseId, this.spotifySettings).catch((err) => {
                console.error(`[${this.logId}] No se pudo guardar spotify_settings:`, err.message);
            });
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
    },
};
