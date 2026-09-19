// Zubastinis.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');

module.exports = {
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
    },

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
            console.log(`[${this.logId}] [ZUBASTINIS] 🤝 EMPATE ENTRE ${this.zubState.tiebreakUsernames.map(u => '@' + u).join(', ')} — DESEMPATE`);
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
            console.log(`[${this.logId}] [ZUBASTINIS] 🛑 FINALIZADO — nadie alcanzó el mínimo de ${this.zubState.minCoins} 🪙`);
        } else if (!top1) {
            this.zubState.winner = null;
            this.zubState.noWinnerReason = 'no_gifts';
            console.log(`[${this.logId}] [ZUBASTINIS] 🛑 FINALIZADO — nadie participó`);
        } else {
            this.zubState.winner = top1;
            this.zubState.noWinnerReason = null;
            console.log(`[${this.logId}] [ZUBASTINIS] 🛑 FINALIZADO — gana @${top1.username}`);
        }

        clearInterval(this.zubTimerInterval);
        this.broadcast.emit('zub_winner_declared', this.getZubPublicState());
        this.maybeDisconnectTikTok();
    },

    startZubTimer() {
        if (this.zubTimerInterval) clearInterval(this.zubTimerInterval);

        this.zubTimerInterval = setInterval(() => {
            if (!this.zubState.isActive || this.zubState.paused) return;
            this.zubState.timeLeft--;

            if (this.zubState.timeLeft <= 0) {
                if (this.zubState.mode === 'main') {
                    console.log(`[${this.logId}] [ZUBASTINIS] ⚠️ MODO SNIPE`);
                    this.zubState.mode = 'snipe';
                    this.zubState.timeLeft = this.zubState.snipeTime;
                    this.broadcast.emit('zub_snipe_started', this.getZubPublicState());
                } else if (this.zubState.mode === 'snipe' || this.zubState.mode === 'tiebreak') {
                    this.resolveZubEnding();
                }
            }
            this.broadcast.emit('zub_timer_updated', this.getZubPublicState());
        }, 1000);
    },

    processGiftZub({ username, avatar, totalCoins }) {
        if (!this.zubState.isActive || this.zubState.paused || this.zubState.mode === 'finished' || !totalCoins) return;
        if (this.zubState.mode === 'tiebreak' && !this.zubState.tiebreakUsernames.includes(username)) return;

        if (!this.zubState.leaderboard[username]) this.zubState.leaderboard[username] = { username, avatar, coins: 0 };
        this.zubState.leaderboard[username].avatar = avatar;
        this.zubState.leaderboard[username].coins += totalCoins;

        this.broadcast.emit('zub_state_update', this.getZubPublicState());
    },

    // Ver comentario de stopKingContest.
    stopZubastinis() {
        this.zubState.isActive = false;
        this.zubState.mode = 'idle';
        this.zubState.paused = false;
        this.zubState.tiebreakUsernames = [];
        if (this.zubTimerInterval) clearInterval(this.zubTimerInterval);
        this.broadcast.emit('zub_state_update', this.getZubPublicState());
        this.maybeDisconnectTikTok();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerZubHandlers(socket) {
        // ── ZUBASTINIS ──────────────────────────────
        socket.on('start_zubastinis', (config) => {
            console.log(`\n[${this.logId}] [JUEGO] ▶️ INICIANDO ZUBASTINIS...`);
            db.incrementUsage(this.licenseId, 'zub_starts').catch(err => console.error(`[${this.logId}] [DB] incrementUsage(zub_starts):`, err.message));

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
                console.log(`\n[${this.logId}] [JUEGO] ⟲ REINICIANDO ZUBASTINIS...`);
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
    },
};
