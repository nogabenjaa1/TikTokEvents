// Estado en vivo que sobrevive a un reinicio del servidor (deploy, caída,
// Render dormido): juegos activos, Extensible, rankings de Top Gifter/Tap-Tap
// y la cola de Spotify. Antes todo esto vivía solo en memoria y un reinicio
// lo borraba en silencio, dejando el panel inconsistente con lo que el
// streamer tenía en pantalla.
//
// Cómo funciona:
//  - Cada RUNTIME_SAVE_INTERVAL_MS se toma una "foto" del estado y, si cambió
//    desde la última, se guarda en la DB (licenses.runtime_state). Si no hay
//    nada activo, la foto es null y no se escribe nada de más.
//  - Al reiniciar, el Tenant nuevo restaura esa foto al cargar sus ajustes
//    (ver loadPersistedSettings) SIEMPRE EN PAUSA: el tiempo no debe correr
//    ni declararse un ganador mientras no hay conexión con TikTok. El
//    streamer revisa y toca "Reanudar".
//  - Las fases que son puro efecto visual con temporizadores (el sorteo de
//    Eliminación/Ruleta) no se pueden continuar a mitad de animación: se
//    vuelven a una fase estable (ver restoreRuntimeState).
//  - Una foto de hace más de RUNTIME_MAX_AGE_MS se ignora: no tiene sentido
//    resucitar el directo de ayer.
const db = require('../../db');

const RUNTIME_SAVE_INTERVAL_MS = 10 * 1000;
const RUNTIME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

module.exports = {
    // Solo se incluye lo que de verdad tiene algo: juegos activos y rankings
    // no vacíos. null = no hay nada que guardar.
    buildRuntimeSnapshot() {
        const snap = {};
        if (this.contestState.isActive) snap.king = this.contestState;
        if (this.zubState.isActive) snap.zub = this.zubState;
        if (this.elimState.isActive) { snap.elim = this.elimState; snap.elimSlotCounter = this.elimSlotCounter; }
        if (this.rouletteState.isActive) { snap.roulette = this.rouletteState; snap.rouletteSlotCounter = this.rouletteSlotCounter; }
        if (this.extensibleState.isActive && !this.extensibleState.finished) snap.extensible = this.extensibleState;
        if (this.versusState.isActive) snap.versus = this.versusState;
        if (Object.keys(this.gifterState.leaderboard).length) snap.gifter = this.gifterState.leaderboard;
        if (Object.keys(this.tapTapState.leaderboard).length) snap.taptap = this.tapTapState.leaderboard;
        if (this.spotifyQueueState.queue.length) snap.spotifyQueue = this.spotifyQueueState.queue;
        return Object.keys(snap).length ? snap : null;
    },

    // `force`: escribe aunque no haya cambiado (cierre del proceso).
    async persistRuntimeState(force = false) {
        const snap = this.buildRuntimeSnapshot();
        const json = snap ? JSON.stringify(snap) : 'null';
        if (!force && json === this.lastRuntimeJson) return;
        this.lastRuntimeJson = json;
        try {
            await db.setRuntimeState(this.licenseId, snap ? { ...snap, savedAt: Date.now() } : null);
        } catch (err) {
            this.lastRuntimeJson = null; // reintenta en el próximo ciclo
            console.error(`[${this.logId}] [DB] setRuntimeState:`, err.message);
        }
    },

    startRuntimePersistence() {
        if (this.runtimeInterval) return;
        this.runtimeInterval = setInterval(() => { this.persistRuntimeState(); }, RUNTIME_SAVE_INTERVAL_MS);
        this.runtimeInterval.unref?.();
    },

    stopRuntimePersistence() {
        if (this.runtimeInterval) { clearInterval(this.runtimeInterval); this.runtimeInterval = null; }
    },

    // Restaura la foto guardada. Devuelve true si restauró algo.
    restoreRuntimeState(saved) {
        if (!isPlainObject(saved)) return false;
        if (!(Number(saved.savedAt) > Date.now() - RUNTIME_MAX_AGE_MS)) return false;
        let restored = 0;

        // Rey del Trono: fases con reloj (waiting/main/snipe), en pausa.
        const king = saved.king;
        if (isPlainObject(king) && king.isActive && ['waiting', 'main', 'snipe'].includes(king.mode) && !this.contestState.isActive) {
            this.contestState = { ...this.contestState, ...king, isActive: true, paused: true };
            this.startKingTimer();
            restored += 1;
        }

        const zub = saved.zub;
        if (isPlainObject(zub) && zub.isActive && ['main', 'snipe', 'tiebreak'].includes(zub.mode) && !this.zubState.isActive) {
            this.zubState = { ...this.zubState, ...zub, isActive: true, paused: true };
            this.startZubTimer();
            restored += 1;
        }

        // Eliminación: si estaba en pleno sorteo ('revealing'/'result') no se
        // puede continuar la animación; vuelve a la ventana de reingreso con
        // sus participantes tal cual estaban.
        const elim = saved.elim;
        if (isPlainObject(elim) && elim.isActive && ['joining', 'rejoin', 'revealing', 'result'].includes(elim.mode) && !this.elimState.isActive && Array.isArray(elim.participants)) {
            const midReveal = elim.mode === 'revealing' || elim.mode === 'result';
            this.elimState = {
                ...this.elimState, ...elim, isActive: true, paused: true,
                ...(midReveal ? { mode: 'rejoin', timeLeft: Math.max(1, Number(elim.rejoinTime) || 20), revealTargetIds: [] } : {}),
            };
            const maxId = elim.participants.reduce((m, p) => Math.max(m, Number(p?.id) || 0), 0);
            this.elimSlotCounter = Math.max(Number(saved.elimSlotCounter) || 0, maxId);
            this.startElimTimer();
            restored += 1;
        }

        // Ruleta: con el giro a medias vuelve a la fase de entradas (con las
        // entradas que quedaban) y un margen corto para que el streamer decida.
        const roulette = saved.roulette;
        if (isPlainObject(roulette) && roulette.isActive && ['joining', 'spinning', 'result'].includes(roulette.mode) && !this.rouletteState.isActive && Array.isArray(roulette.entries)) {
            const midSpin = roulette.mode !== 'joining';
            this.rouletteState = {
                ...this.rouletteState, ...roulette, isActive: true, paused: true,
                ...(midSpin ? {
                    mode: 'joining', timeLeft: 30, revealOrder: [], winnerIndex: -1, revealCursor: 0,
                    revealTargetIndexes: [], currentSpinIndex: null, spinQueue: [], lastEliminatedList: [], winner: null,
                } : {}),
            };
            const maxId = roulette.entries.reduce((m, p) => Math.max(m, Number(p?.id) || 0), 0);
            this.rouletteSlotCounter = Math.max(Number(saved.rouletteSlotCounter) || 0, maxId);
            this.startRouletteTimer();
            restored += 1;
        }

        const ext = saved.extensible;
        if (isPlainObject(ext) && ext.isActive && !ext.finished && !this.extensibleState.isActive) {
            this.extensibleState = { ...this.extensibleState, ...ext, isActive: true, finished: false, paused: true };
            this.startExtensibleTimer();
            restored += 1;
        }

        // Versus: sin timer que rearmar (es un contador, no una cuenta
        // regresiva) -- alcanza con restaurar los counts tal cual quedaron.
        const versus = saved.versus;
        if (isPlainObject(versus) && versus.isActive && !this.versusState.isActive) {
            this.versusState = { ...this.versusState, ...versus, isActive: true, paused: true };
            restored += 1;
        }

        if (isPlainObject(saved.gifter) && !Object.keys(this.gifterState.leaderboard).length) {
            this.gifterState.leaderboard = saved.gifter;
            restored += 1;
        }
        if (isPlainObject(saved.taptap) && !Object.keys(this.tapTapState.leaderboard).length) {
            this.tapTapState.leaderboard = saved.taptap;
            restored += 1;
        }
        if (Array.isArray(saved.spotifyQueue) && !this.spotifyQueueState.queue.length) {
            this.spotifyQueueState.queue = saved.spotifyQueue;
            restored += 1;
        }

        if (restored > 0) {
            // La conexión con TikTok se restablece sola cuando el panel
            // vuelve a pedirla; que esa reconexión no cuente como "directo
            // nuevo" (borraría lo recién restaurado). Si el LIVE ya terminó,
            // el flujo normal de "offline" lo detiene todo (ver
            // ensureTikTokConnection).
            this.wasEverConnected = true;
            this.lastRuntimeJson = null;
            console.log(`[${this.logId}] [RESTAURACIÓN] ${restored} elemento(s) de estado en vivo restaurados tras el reinicio (juegos en pausa).`);
        }
        return restored > 0;
    },
};
