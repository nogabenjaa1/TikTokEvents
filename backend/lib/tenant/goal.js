// Objetivo (meta de regalos o de seguidores).
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');

module.exports = {
    getGoalPublicState() {
        return { ...this.goalState, audioUrl: this.goalAudioUrl };
    },

    // Emite el estado del objetivo Y lo guarda en la DB (con debounce: un
    // regalo grande o una ráfaga de seguidores no debe pegarle a la DB una
    // vez por evento). Si el servidor se reinicia, loadPersistedSettings lo
    // restaura tal cual.
    emitGoalState() {
        this.broadcast.emit('goal_state_update', this.getGoalPublicState());
        if (this.goalPersistTimer) clearTimeout(this.goalPersistTimer);
        this.goalPersistTimer = setTimeout(() => this.persistGoalProgress(), 1500);
    },

    persistGoalProgress() {
        if (this.goalPersistTimer) { clearTimeout(this.goalPersistTimer); this.goalPersistTimer = null; }
        const { isActive, finished, targetType, target, current, title } = this.goalState;
        return db.setGoalProgress(this.licenseId, { isActive, finished, targetType, target, current, title })
            .catch((err) => console.error(`[${this.logId}] [DB] setGoalProgress:`, err.message));
    },

    // Llamado desde server.js justo después de subir/borrar el audio en
    // Supabase Storage -- mantiene este cache en memoria al día (mismo
    // criterio que setAlertConfig) y avisa al overlay/panel al instante.
    setGoalAudio(audioUrl, audioPath) {
        this.goalAudioUrl = audioUrl || null;
        this.goalAudioPath = audioPath || null;
        this.broadcast.emit('goal_state_update', this.getGoalPublicState());
    },

    // Acumulador simple (igual que processGiftGifterBoard, pero UN total en
    // vez de un ranking por usuario) -- sin `setInterval` ni paso del
    // tiempo, a diferencia de Extensible: un objetivo no decae solo, solo
    // crece con cada regalo/seguidor nuevo hasta llegar a `target`. Se
    // ignora en silencio si no hay un objetivo activo de este tipo (ej. un
    // regalo mientras el objetivo activo es de seguidores) -- las dos
    // categorías nunca se mezclan, pedido explícito ("uno a la vez").
    processGiftGoal(totalCoins) {
        const state = this.goalState;
        if (!state.isActive || state.finished || state.targetType !== 'coins' || !totalCoins) return;
        state.current = Math.min(state.target, state.current + totalCoins);
        if (state.current >= state.target) state.finished = true;
        this.emitGoalState();
    },

    processFollowGoal() {
        const state = this.goalState;
        if (!state.isActive || state.finished || state.targetType !== 'followers') return;
        state.current = Math.min(state.target, state.current + 1);
        if (state.current >= state.target) state.finished = true;
        this.emitGoalState();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerGoalHandlers(socket) {
        // ── OBJETIVO (meta de regalos o de seguidores) ──
        // A diferencia de Extensible, arrancar SIEMPRE parte de cero (un
        // objetivo nuevo, pedido explícito) -- no tiene sentido "seguir"
        // desde un progreso viejo con un target/tipo distinto. El progreso
        // en curso NO se toca acá si ya estaba activo (ver
        // update_goal_settings para eso).
        socket.on('start_goal', (config) => {
            const targetType = config?.targetType === 'followers' ? 'followers' : 'coins';
            const cap = targetType === 'coins' ? 10_000_000 : 1_000_000;
            const target = Math.max(1, Math.min(cap, Math.round(Number(config?.target)) || 1));
            const title = typeof config?.title === 'string' ? config.title.trim().slice(0, 60) : '';
            this.goalState = { isActive: true, finished: false, targetType, target, current: 0, title };
            this.emitGoalState();
            if (config?.tiktokUsername) this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
        });

        // Cambia el título/la meta de un objetivo YA activo sin reiniciar
        // el progreso acumulado (ej. el streamer quiere subir la meta
        // porque ya casi la alcanza) -- pedido implícito de simetría con
        // update_extensible_settings. No permite cambiar `targetType` acá
        // (eso exige un objetivo nuevo, ver start_goal) para no mezclar un
        // progreso en monedas con una meta que de repente pasa a ser de
        // seguidores.
        socket.on('update_goal_settings', (config) => {
            if (!this.goalState.isActive) return;
            if (typeof config?.title === 'string') this.goalState.title = config.title.trim().slice(0, 60);
            if (config?.target !== undefined) {
                const cap = this.goalState.targetType === 'coins' ? 10_000_000 : 1_000_000;
                this.goalState.target = Math.max(1, Math.min(cap, Math.round(Number(config.target)) || this.goalState.target));
                this.goalState.finished = this.goalState.current >= this.goalState.target;
            }
            this.emitGoalState();
        });

        // Botón "Reiniciar progreso" -- pedido explícito: el objetivo (tipo
        // y meta) se queda igual, solo el contador vuelve a cero. Es la
        // única forma de resetear el progreso -- nunca se hace solo por
        // tiempo ni por reconexión (ver comentario del constructor).
        socket.on('reset_goal', () => {
            this.goalState.current = 0;
            this.goalState.finished = false;
            this.emitGoalState();
        });

        socket.on('stop_goal', () => {
            this.goalState.isActive = false;
            this.emitGoalState();
        });
    },
};
