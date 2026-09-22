// Modo Extensible.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const {
    EXTENSIBLE_TICK_MS,
} = require('../../lib/tenantHelpers');

// 120 minutos (7200s) de tope para el tiempo base y para cualquier ajuste —
// mismo límite que el slider del panel (ver Extensible.jsx), reforzado acá
// por si algo más allá del panel manda el config.
const MAX_EXTENSIBLE_BASE_SECONDS = 120 * 60;

module.exports = {
    // ==========================================
    // LÓGICA: MODO EXTENSIBLE (cuenta regresiva que crece con follows/regalos)
    // ==========================================
    getExtensiblePublicState() {
        return {
            isActive: this.extensibleState.isActive,
            finished: this.extensibleState.finished,
            paused: this.extensibleState.paused,
            baseTime: this.extensibleState.baseTime,
            secondsPerFollow: this.extensibleState.secondsPerFollow,
            secondsPerGift: this.extensibleState.secondsPerGift,
            reverseMode: this.extensibleState.reverseMode,
            timeLeft: this.extensibleState.timeLeft,
        };
    },

    startExtensibleTimer() {
        if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        this.extensibleTimerInterval = setInterval(() => {
            if (!this.extensibleState.isActive || this.extensibleState.finished || this.extensibleState.paused) return;
            this.extensibleState.timeLeft -= 1;
            if (this.extensibleState.timeLeft <= 0) {
                this.extensibleState.timeLeft = 0;
                this.extensibleState.finished = true;
                clearInterval(this.extensibleTimerInterval);
            }
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        }, EXTENSIBLE_TICK_MS);
    },

    // Un follow detectado suma `secondsPerFollow` al tiempo restante. No hace
    // falta deduplicar por usuario: es TikTok quien decide cuándo emitir el
    // evento, y cada aparición es información nueva de la plataforma. Pedido
    // explícito (revisado): a diferencia de Rey del Trono/Zubastinis/
    // Eliminación, en Extensible la pausa SOLO congela el paso natural del
    // segundero (ver startExtensibleTimer) — los follows/regalos siguen
    // sumando (o restando, en reverseMode) mientras está pausado, para que
    // ese apoyo no se pierda si el streamer tuvo que pausar por un
    // imprevisto. Al reanudar, el conteo simplemente sigue desde el valor
    // ya actualizado.
    processFollowExtensible() {
        const state = this.extensibleState;
        if (!state.isActive || state.finished) return;
        // reverseMode invierte el signo: cada follow RESTA en vez de sumar
        // (pedido explícito, "Extensible Inverso") — si llega a 0 por esto,
        // termina igual que cuando lo agota el paso natural del segundero.
        state.timeLeft = Math.max(0, state.timeLeft + (state.reverseMode ? -state.secondsPerFollow : state.secondsPerFollow));
        if (state.timeLeft <= 0) {
            state.timeLeft = 0;
            state.finished = true;
            if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        }
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
    },

    // Bug real reportado: "SEGUNDOS POR REGALO" está pensado como segundos
    // POR MONEDA (♦) del regalo — un regalo de 50 monedas debe sumar 50x
    // este valor — pero multiplicaba por `repeatCount` (cuántas veces se
    // mandó el MISMO regalo en el combo, no su valor). Con un regalo caro
    // mandado una sola vez, repeatCount daba 1 y el conteo casi no se movía,
    // como si el regalo no se hubiera detectado. Ahora usa `totalCoins`
    // (diamondCount * repeatCount, ya calculado en handleGiftEvent), que sí
    // refleja el valor real del regalo — cualquier regalo cuenta, a
    // propósito no está atado a uno específico como Eliminación/Ruleta.
    // Mismo criterio de reverseMode y de pausa que processFollowExtensible
    // (ver comentario ahí): sigue sumando/restando aunque esté pausado.
    processGiftExtensible({ totalCoins }) {
        const state = this.extensibleState;
        if (!state.isActive || state.finished) return;
        const coins = Math.max(1, totalCoins || 1);
        const magnitude = state.secondsPerGift * coins;
        state.timeLeft = Math.max(0, state.timeLeft + (state.reverseMode ? -magnitude : magnitude));
        if (state.timeLeft <= 0) {
            state.timeLeft = 0;
            state.finished = true;
            if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        }
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
    },

    // Ajuste manual (o programático) de tiempo mientras el contador está
    // activo -- cuerpo de lo que era el handler `adjust_extensible_time`
    // (ver más abajo), sacado a un método propio para que el modo Versus
    // (ver lib/tenant/versus.js) también pueda sumar/restar tiempo cuando un
    // regalo vinculado llega, sin pasar por un evento de socket. A
    // diferencia de los follows/regalos normales de Extensible, esto SÍ
    // puede "revivir" una cuenta que ya había llegado a 0: es una acción
    // explícita (del admin, o de Versus en su nombre), no una entrada
    // automática, así que si el nuevo total queda arriba de 0 el timer se
    // re-arma solo.
    adjustExtensibleTime(deltaSeconds) {
        if (!this.extensibleState.isActive) return;
        const delta = Math.max(-MAX_EXTENSIBLE_BASE_SECONDS, Math.min(MAX_EXTENSIBLE_BASE_SECONDS, Math.round(Number(deltaSeconds) || 0)));
        if (!delta) return;
        const state = this.extensibleState;
        state.timeLeft = Math.max(0, state.timeLeft + delta);
        if (state.timeLeft > 0 && state.finished) {
            state.finished = false;
            this.startExtensibleTimer();
        } else if (state.timeLeft <= 0) {
            state.finished = true;
            if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        }
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
    },

    // Ver comentario de stopKingContest.
    stopExtensible() {
        this.extensibleState.isActive = false;
        this.extensibleState.paused = false;
        if (this.extensibleTimerInterval) clearInterval(this.extensibleTimerInterval);
        this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        this.maybeDisconnectTikTok();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerExtensibleHandlers(socket) {
        // ── MODO EXTENSIBLE ──────────────────────────
        const clampBaseTime = (value, fallback) => Math.min(MAX_EXTENSIBLE_BASE_SECONDS, Math.max(1, Number(value) || fallback));

        socket.on('start_extensible', (config) => {
            console.log(`\n[${this.logId}] [JUEGO] ▶️ INICIANDO MODO EXTENSIBLE...`);
            const baseTime = clampBaseTime(config?.baseTime, 60);
            this.extensibleState = {
                isActive: true, finished: false, paused: false,
                baseTime,
                secondsPerFollow: Math.max(0, Number(config?.secondsPerFollow) || 0),
                secondsPerGift: Math.max(0, Number(config?.secondsPerGift) || 0),
                reverseMode: !!config?.reverseMode,
                timeLeft: baseTime,
            };
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            this.startExtensibleTimer();

            if (config?.tiktokUsername) {
                this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
            }
        });

        // Segundos por follow/regalo y Modo Inverso: se pueden cambiar en vivo
        // sin reiniciar el contador (pedido explícito). Tiempo base: pedido
        // explícito REVISADO — ya NO se edita en vivo (antes sí, sumando la
        // diferencia); ahora queda BLOQUEADO mientras el modo está activo, y
        // el valor que llegue acá se ignora a propósito (solo importa para el
        // próximo Reiniciar, ver restart_extensible más abajo). Para cambiar
        // el tiempo mientras corre está adjust_extensible_time (+/-, ver más
        // abajo), que sí actúa al instante.
        socket.on('update_extensible_settings', (config) => {
            if (!this.extensibleState.isActive) return;
            if (config?.secondsPerFollow !== undefined) this.extensibleState.secondsPerFollow = Math.max(0, Number(config.secondsPerFollow) || 0);
            if (config?.secondsPerGift !== undefined) this.extensibleState.secondsPerGift = Math.max(0, Number(config.secondsPerGift) || 0);
            if (config?.reverseMode !== undefined) this.extensibleState.reverseMode = !!config.reverseMode;
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
        });

        // Ajuste manual de tiempo mientras el contador está activo (pedido
        // explícito: +1/+5 min, -1/-5 min, o un valor a medida desde el
        // panel) — reemplaza la antigua edición en vivo del tiempo base, que
        // ahora queda bloqueada (ver update_extensible_settings). Ver
        // adjustExtensibleTime más arriba (también la usa el modo Versus).
        socket.on('adjust_extensible_time', ({ deltaSeconds } = {}) => this.adjustExtensibleTime(deltaSeconds));

        socket.on('restart_extensible', (config) => {
            if (!this.extensibleState.isActive) return;
            console.log(`\n[${this.logId}] [JUEGO] ⟲ REINICIANDO MODO EXTENSIBLE...`);
            if (config?.baseTime !== undefined) this.extensibleState.baseTime = clampBaseTime(config.baseTime, this.extensibleState.baseTime);
            if (config?.secondsPerFollow !== undefined) this.extensibleState.secondsPerFollow = Math.max(0, Number(config.secondsPerFollow) || 0);
            if (config?.secondsPerGift !== undefined) this.extensibleState.secondsPerGift = Math.max(0, Number(config.secondsPerGift) || 0);
            if (config?.reverseMode !== undefined) this.extensibleState.reverseMode = !!config.reverseMode;
            this.extensibleState.timeLeft = this.extensibleState.baseTime;
            this.extensibleState.finished = false;
            this.extensibleState.paused = false;
            this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            this.startExtensibleTimer();
        });

        // Congela el contador entero (ni baja solo, ni suma por follow/gift)
        // — mismo criterio que Rey del Trono/Zubastinis/Eliminación.
        socket.on('pause_extensible', () => {
            if (this.extensibleState.isActive && !this.extensibleState.finished) {
                this.extensibleState.paused = true;
                this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            }
        });

        socket.on('resume_extensible', () => {
            if (this.extensibleState.isActive && !this.extensibleState.finished) {
                this.extensibleState.paused = false;
                this.broadcast.emit('extensible_state_update', this.getExtensiblePublicState());
            }
        });

        socket.on('stop_extensible', () => this.stopExtensible());
    },
};
