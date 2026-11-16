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
    timerTick,
} = require('../../lib/tenantHelpers');
const { normalizeUsername, clampCount, findParticipantName, setEntries, mergeParticipants, insertSlotsRandomly, roundEliminationCount, MAX_ROUND_SETTING } = require('../../lib/elimEntries');

// Cuántos de los últimos que mandaron regalo recuerda la ronda (ver
// noteElimGifter): los que se muestran en el panel para dar entradas a mano.
const ELIM_SEEN_USERS_MAX = 20;

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
            finalPhaseAt: this.elimState.finalPhaseAt || 0, finalPhasePerRound: this.elimState.finalPhasePerRound || 1,
            participants: this.elimState.participants,
            revealTargetIds: this.elimState.revealTargetIds,
            revealSelectMs: this.elimState.fastMode ? REVEAL_SELECT_MS_FAST : REVEAL_SELECT_MS,
            revealResultMs: this.elimState.fastMode ? REVEAL_RESULT_MS_FAST : REVEAL_RESULT_MS,
            lastEliminatedList: this.elimState.lastEliminatedList, winner: this.elimState.winner,
            // Los últimos que mandaron cualquier regalo en esta ronda, del más
            // reciente al más viejo (ver noteElimGifter).
            recentGifters: [...(this.elimSeenUsers || new Map()).values()].reverse(),
        };
    },

    // Anota a quien manda un regalo durante la ronda, le alcance o no para
    // una entrada (pedido explícito): así el streamer le pide "mándame una
    // rosa" a alguien que pagó dentro del juego y le da entradas a mano con
    // su @ y su foto de TikTok, como si hubiera mandado las monedas.
    // Si ya tenía entradas manuales con la foto por defecto, pasan a su foto real.
    noteElimGifter(username, avatar) {
        if (!username) return false;
        if (!this.elimSeenUsers) this.elimSeenUsers = new Map();
        const key = username.toLowerCase();
        const prev = this.elimSeenUsers.get(key);
        this.elimSeenUsers.delete(key);
        this.elimSeenUsers.set(key, { username, avatar: avatar || prev?.avatar || '' });
        while (this.elimSeenUsers.size > ELIM_SEEN_USERS_MAX) this.elimSeenUsers.delete(this.elimSeenUsers.keys().next().value);
        let changed = !prev;
        if (avatar) {
            for (const slot of this.elimState.participants) {
                if (slot.username.toLowerCase() === key && slot.avatar !== avatar) { slot.avatar = avatar; changed = true; }
            }
        }
        return changed;
    },

    // Foto para alguien que se agrega a mano: la que ya tiene en la lista, la
    // de TikTok si mandó algún regalo en la ronda, o una al azar de la galería.
    elimAvatarFor(username) {
        const existing = findParticipantName(this.elimState.participants, username);
        if (existing) return this.elimState.participants.find(p => p.username === existing).avatar;
        const seen = this.elimSeenUsers?.get(normalizeUsername(username).toLowerCase());
        return seen?.avatar || pickDefaultManualAvatar();
    },

    // Las ediciones a mano (quitar, fijar, combinar) no se aceptan durante la
    // animación del sorteo: ese sorteo ya eligió sus slots y cambiarlos a
    // medio camino haría que se elimine a quien no se ve en pantalla.
    // Locked Mode (pedido explícito): las entradas se pueden tocar todo lo que
    // se quiera durante el tiempo para unirse, pero ya no una vez que empiezan
    // las eliminaciones, ni siquiera para agregar. En modo normal se pueden
    // editar en cualquier fase menos la animación del sorteo.
    elimEditBlockedReason() {
        if (!this.elimState.isActive || this.elimState.mode === 'finished') return 'Inicia una ronda de Eliminación para editar las entradas.';
        if (this.elimState.lockedMode && this.elimState.mode !== 'joining') return 'Locked Mode: las entradas ya no se pueden modificar porque empezaron las eliminaciones.';
        if (this.elimState.mode === 'revealing') return 'Espera a que termine el sorteo para editar las entradas.';
        return null;
    },

    finishElimination() {
        const pool = this.elimState.participants;
        this.elimState.mode = 'finished';
        this.elimState.isActive = false;
        const winnerSlot = pool[0] || null;
        this.elimState.winner = winnerSlot ? { username: winnerSlot.username, avatar: winnerSlot.avatar } : null;
        clearInterval(this.elimTimerInterval);
        console.log(`[${this.logId}] [ELIMINACION] 🛑 FINALIZADO — ${winnerSlot ? `gana @${winnerSlot.username}` : 'nadie participó'}`);
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

        const maxCount = roundEliminationCount(pool.length, {
            perRound: this.elimState.eliminationsPerRound,
            finalAt: this.elimState.finalPhaseAt,
            finalPerRound: this.elimState.finalPhasePerRound,
        });
        const batch = pickEliminationBatch(pool, maxCount);
        this.elimState.mode = 'revealing';
        this.elimState.revealTargetIds = batch.map(p => p.id);
        console.log(`[${this.logId}] [ELIMINACION] 🎯 SORTEANDO... (${batch.length})`);
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
        console.log(`[${this.logId}] [ELIMINACION] 💀 ELIMINADOS: ${this.elimState.lastEliminatedList.map(e => '@' + e.username).join(', ') || '(nadie)'}`);

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
            const modeBefore = this.elimState.mode;

            if (this.elimState.timeLeft <= 0) {
                if (this.elimState.mode === 'joining') {
                    console.log(`[${this.logId}] [ELIMINACION] ⚔️ INICIA LA ELIMINACIÓN`);
                    this.beginEliminationReveal();
                } else if (this.elimState.mode === 'rejoin') {
                    this.beginEliminationReveal();
                }
            }
            // Ancho de banda: el estado completo lleva la lista de participantes
            // (con la URL del avatar de cada slot) y antes salía entera cada
            // segundo a cada pantalla abierta. Cualquier cambio de la lista ya
            // manda su propio elim_state_update, así que el segundero solo
            // necesita el reloj -- salvo en el tick que cambia de fase.
            if (this.elimState.mode !== modeBefore) {
                this.broadcast.emit('elim_timer_updated', this.getElimPublicState());
            } else {
                this.broadcast.emit('elim_tick', timerTick(this.elimState));
            }
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
        if (!this.elimState.isActive) return;
        // Antes de cualquier filtro (pausa, Locked Mode, monto): cuenta para la
        // lista de "regalaron hace poco" del panel aunque no dé entrada.
        if (this.elimState.mode !== 'finished' && this.noteElimGifter(username, avatar)) {
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
        }
        if (this.elimState.paused) return;
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
                console.log(`[${this.logId}] [ELIMINACION] 👑 INSTA-WIN: @${username}`);
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
        const slots = [];
        for (let i = 0; i < newUnits; i++) {
            this.elimSlotCounter += 1;
            slots.push({ id: this.elimSlotCounter, username, avatar, source: 'gift' });
        }
        insertSlotsRandomly(this.elimState.participants, slots);
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
            console.log(`\n[${this.logId}] [JUEGO] ▶️ INICIANDO ELIMINACIÓN...`);
            db.incrementUsage(this.licenseId, 'elim_starts').catch(err => console.error(`[${this.logId}] [DB] incrementUsage(elim_starts):`, err.message));

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
                finalPhaseAt: clampCount(config.finalPhaseAt, 0, MAX_ROUND_SETTING) ?? 0,
                finalPhasePerRound: clampCount(config.finalPhasePerRound, 1, MAX_ROUND_SETTING) ?? 1,
                participants: [], revealTargetIds: [], lastEliminatedList: [], winner: null,
            };
            this.elimSlotCounter = 0;
            this.elimEntryAccum = {};
            this.elimInstaWinAccum = {};
            this.elimSeenUsers = new Map();
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            this.startElimTimer();

            if (config.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        // Pausa solo durante el tiempo para unirse, en los dos modos (pedido
        // explícito): se puede pausar y reanudar las veces que se quiera antes de
        // la primera eliminación, pero ya no después.
        socket.on('pause_elimination', () => {
            if (this.elimState.isActive && this.elimState.mode === 'joining' && !this.elimState.paused) {
                this.elimState.paused = true;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        // Reanudar sí en cualquier fase: una ronda recuperada tras un reinicio
        // del servidor vuelve pausada en el reingreso (ver runtimeState.js) y
        // tiene que poder seguir.
        socket.on('resume_elimination', () => {
            if (this.elimState.isActive && this.elimState.paused && this.elimState.mode !== 'finished') {
                this.elimState.paused = false;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        socket.on('restart_elimination', () => {
            if (this.elimState.isActive) {
                console.log(`\n[${this.logId}] [JUEGO] ⟲ REINICIANDO ELIMINACIÓN...`);
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
                this.elimSeenUsers = new Map();
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
                this.startElimTimer();
            }
        });

        socket.on('update_elim_settings', (newConfig) => {
            if (this.elimState.isActive) {
                const prevBase = this.elimState.baseTime;
                const prevRejoin = this.elimState.rejoinTime;
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
                // Fase final: se usa en el próximo sorteo (ver roundEliminationCount).
                this.elimState.finalPhaseAt = clampCount(newConfig.finalPhaseAt, 0, MAX_ROUND_SETTING) ?? 0;
                this.elimState.finalPhasePerRound = clampCount(newConfig.finalPhasePerRound, 1, MAX_ROUND_SETTING) ?? 1;
                // Pedido explícito: una vez arrancada la ronda con Locked Mode
                // activado, no se puede desactivar hasta Detener/Reiniciar — evita
                // levantar el bloqueo a mitad de ronda para dejar entrar gente
                // nueva a último momento. Prender sí se puede en cualquier momento.
                this.elimState.lockedMode = this.elimState.lockedMode || !!newConfig.lockedMode;

                // Pedido explícito (igual que Zubastinis): reflejar el cambio de
                // tiempo al instante si la fase correspondiente está corriendo
                // ahora mismo — si se agranda el tiempo, el conteo salta hacia
                // arriba; si se achica, salta hacia abajo.
                // Solo si cambió ESE tiempo: antes cualquier ajuste (un regalo,
                // el mínimo...) mandaba el reloj de vuelta al tiempo completo y le
                // devolvía a quien iba ganando todo el tiempo que ya había corrido.
                if (this.elimState.mode === 'joining' && newConfig.baseTime !== prevBase) this.elimState.timeLeft = newConfig.baseTime;
                else if (this.elimState.mode === 'rejoin' && newConfig.rejoinTime !== prevRejoin) this.elimState.timeLeft = newConfig.rejoinTime;
                this.broadcast.emit('elim_state_update', this.getElimPublicState());
            }
        });

        // Suma entradas a mano, sin depender de un regalo o comentario real —
        // pedido explícito para poder premiar a alguien puntualmente o corregir
        // a mano. Cuentan EXACTAMENTE igual que las entradas por regalo (mismo
        // array de slots que usa el sorteo). Antes ignoraban Locked Mode; ahora
        // (pedido explícito) siguen la misma regla que el resto de las
        // ediciones: con Locked Mode, solo durante el tiempo para unirse (ver
        // elimEditBlockedReason). Durante la animación del sorteo sí se puede
        // agregar: igual que un regalo, entra para la ronda siguiente.
        // Sirve también para sumarle a quien ya entró con regalos (mismo @, sin
        // importar mayúsculas). La foto sale de elimAvatarFor: la que ya tiene,
        // la de TikTok si mandó algún regalo en la ronda (aunque no le
        // alcanzara para una entrada), o una al azar de la galería (ver
        // DEFAULT_MANUAL_AVATARS) que queda fija mientras dure la ronda.
        // `ack` (opcional): el panel muestra si se aplicó o por qué no.
        socket.on('elim_add_manual_entry', (payload, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            const { username, count } = payload || {};
            if (!this.elimState.isActive || this.elimState.mode === 'finished') return reply({ ok: false, error: 'Inicia una ronda de Eliminación para agregar entradas.' });
            if (this.elimState.lockedMode && this.elimState.mode !== 'joining') return reply({ ok: false, error: this.elimEditBlockedReason() });
            const typed = normalizeUsername(username);
            if (!typed) return reply({ ok: false, error: 'Escribe el usuario.' });
            const n = clampCount(count, 1) ?? 1;
            const uname = findParticipantName(this.elimState.participants, typed)
                || this.elimSeenUsers?.get(typed.toLowerCase())?.username
                || typed;
            const avatar = this.elimAvatarFor(uname);
            const slots = [];
            for (let i = 0; i < n; i++) {
                this.elimSlotCounter += 1;
                slots.push({ id: this.elimSlotCounter, username: uname, avatar, source: 'manual' });
            }
            insertSlotsRandomly(this.elimState.participants, slots);
            console.log(`[${this.logId}] [ELIMINACION] ➕ Entrada manual: @${uname} x${n}`);
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            reply({ ok: true, username: uname, added: n });
        });

        // Deja a un participante con un número exacto de entradas (sumar,
        // restar o 0 para sacarlo), sin importar si eran de regalo o manuales
        // (pedido explícito). Ver setEntries en lib/elimEntries.js.
        socket.on('elim_set_entries', (payload, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            const blocked = this.elimEditBlockedReason();
            if (blocked) return reply({ ok: false, error: blocked });
            const result = setEntries(this.elimState.participants, {
                username: payload?.username, count: payload?.count,
                nextId: () => { this.elimSlotCounter += 1; return this.elimSlotCounter; },
            });
            if (!result.ok) return reply(result);
            console.log(`[${this.logId}] [ELIMINACION] ✏️ Entradas de @${result.username}: ${result.before} → ${result.after}`);
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            reply(result);
        });

        // Combina las entradas de dos participantes en uno de los dos o en un
        // tercer perfil (pedido explícito). Ver mergeParticipants en
        // lib/elimEntries.js.
        socket.on('elim_merge_participants', (payload, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            const blocked = this.elimEditBlockedReason();
            if (blocked) return reply({ ok: false, error: blocked });
            const result = mergeParticipants(this.elimState.participants, {
                a: payload?.a, b: payload?.b, target: payload?.target, customUsername: payload?.customUsername,
                avatarFor: (name) => this.elimAvatarFor(name),
                nextId: () => { this.elimSlotCounter += 1; return this.elimSlotCounter; },
            });
            if (!result.ok) return reply(result);
            console.log(`[${this.logId}] [ELIMINACION] 🔗 Combinados @${normalizeUsername(payload.a)} + @${normalizeUsername(payload.b)} → @${result.username} (${result.total})`);
            this.broadcast.emit('elim_state_update', this.getElimPublicState());
            reply(result);
        });

        socket.on('stop_elimination', () => this.stopElimination());
    },
};
