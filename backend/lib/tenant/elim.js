// Eliminación.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    REVEAL_SELECT_MS,
    REVEAL_RESULT_MS,
    REVEAL_SELECT_MS_FAST,
    REVEAL_RESULT_MS_FAST,
    pickDefaultManualAvatar,
    pickEliminationBatch,
} = require('../../lib/tenantHelpers');

module.exports = {
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    // Ver comentario de stopKingContest.
    stopElimination() {
        this.elimState.isActive = false;
        this.elimState.mode = 'idle';
        if (this.elimTimerInterval) clearInterval(this.elimTimerInterval);
        if (this.elimRevealTimeout) { clearTimeout(this.elimRevealTimeout); this.elimRevealTimeout = null; }
        if (this.elimResultTimeout) { clearTimeout(this.elimResultTimeout); this.elimResultTimeout = null; }
        this.broadcast.emit('elim_state_update', this.getElimPublicState());
        this.maybeDisconnectTikTok();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerElimHandlers(socket) {
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
    },
};
