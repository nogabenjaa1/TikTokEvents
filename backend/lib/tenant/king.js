// Rey del Trono.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');

module.exports = {
    // ==========================================
    // LÓGICA: REY DEL TRONO (KING)
    // ==========================================
    startKingTimer() {
        if (this.kingTimerInterval) clearInterval(this.kingTimerInterval);
        console.log(`[${this.logId}] [RELOJ-KING] ⏸️ Esperando primer participante...`);

        this.kingTimerInterval = setInterval(() => {
            if (!this.contestState.isActive || this.contestState.mode === 'waiting' || this.contestState.paused) return;
            this.contestState.timeLeft--;

            if (this.contestState.timeLeft <= 0) {
                if (this.contestState.mode === 'main') {
                    console.log(`[${this.logId}] [KING] ⚠️ MODO SNIPE`);
                    this.contestState.mode = 'snipe';
                    this.contestState.timeLeft = this.contestState.snipeTime;
                    this.broadcast.emit('snipe_started', this.contestState);
                } else if (this.contestState.mode === 'snipe') {
                    console.log(`[${this.logId}] [KING] 🛑 FINALIZADO`);
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
    },

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
    },

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
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerKingHandlers(socket) {
        // ── REY DEL TRONO ──────────────────────────
        socket.on('start_contest', (config) => {
            console.log(`\n[${this.logId}] [JUEGO] ▶️ INICIANDO REY DEL TRONO...`);
            db.incrementUsage(this.licenseId, 'king_starts').catch(err => console.error(`[${this.logId}] [DB] incrementUsage(king_starts):`, err.message));

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
                console.log(`\n[${this.logId}] [JUEGO] ⟲ REINICIANDO REY DEL TRONO...`);
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
    },
};
