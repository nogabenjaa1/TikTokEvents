// Rankings continuos: Top Gifter y Top Tap-Tap.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const {
    TAPTAP_SETTLE_MS,
    CONTINUOUS_LEADERBOARD_SIZE,
} = require('../../lib/tenantHelpers');

module.exports = {
    // ==========================================
    // LÓGICA: TOP GIFTER (ranking continuo de regalos)
    // ==========================================
    getGifterPublicState() {
        const top = Object.values(this.gifterState.leaderboard).sort((a, b) => b.coins - a.coins).slice(0, CONTINUOUS_LEADERBOARD_SIZE);
        return { leaderboard: top };
    },

    // Suma siempre que haya conexión, sin importar qué juego esté activo (o
    // si no hay ninguno) — es un contador de fondo del directo, no de una
    // partida puntual.
    processGiftGifterBoard({ username, avatar, totalCoins }) {
        if (!username || !totalCoins) return;
        if (!this.gifterState.leaderboard[username]) this.gifterState.leaderboard[username] = { username, avatar, coins: 0 };
        this.gifterState.leaderboard[username].avatar = avatar;
        this.gifterState.leaderboard[username].coins += totalCoins;
        this.broadcast.emit('gifter_state_update', this.getGifterPublicState());
    },

    // ==========================================
    // LÓGICA: TOP TAP-TAP (ranking continuo de likes, con detección de ráfaga)
    // ==========================================
    getTapTapPublicState() {
        const top = Object.values(this.tapTapState.leaderboard).sort((a, b) => b.likes - a.likes).slice(0, CONTINUOUS_LEADERBOARD_SIZE);
        return { leaderboard: top };
    },

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
    },

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
    },

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
    },

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
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerLeaderboardHandlers(socket) {
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
    },
};
