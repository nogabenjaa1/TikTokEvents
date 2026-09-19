// Ruleta.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    REVEAL_SELECT_MS,
    REVEAL_RESULT_MS,
    REVEAL_SELECT_MS_FAST,
    REVEAL_RESULT_MS_FAST,
    pickDefaultManualAvatar,
    shuffleArray,
} = require('../../lib/tenantHelpers');

module.exports = {
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    finishRouletteWithWinner() {
        const entry = this.rouletteState.revealOrder[this.rouletteState.winnerIndex];
        this.rouletteState.mode = 'finished';
        this.rouletteState.isActive = false;
        this.rouletteState.winner = { username: entry.username, avatar: entry.avatar };
        this.rouletteState.lastEliminatedList = [];
        console.log(`[${this.licenseId}] [RULETA] 👑 GANADORA: @${entry.username}`);
        this.broadcast.emit('roulette_winner_declared', this.getRoulettePublicState());
        this.maybeDisconnectTikTok();
    },

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
    },

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
    },

    // Ver comentario de stopKingContest.
    stopRoulette() {
        this.rouletteState.isActive = false;
        this.rouletteState.mode = 'idle';
        this.rouletteState.paused = false;
        if (this.rouletteTimerInterval) clearInterval(this.rouletteTimerInterval);
        if (this.rouletteRevealTimeout) { clearTimeout(this.rouletteRevealTimeout); this.rouletteRevealTimeout = null; }
        this.broadcast.emit('roulette_state_update', this.getRoulettePublicState());
        this.maybeDisconnectTikTok();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerRouletteHandlers(socket) {
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
    },
};
