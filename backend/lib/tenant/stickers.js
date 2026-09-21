// Stickers del club de fans: catálogo por licencia, alertas por sticker y espera al
// TTS. Métodos de Tenant (se agregan a su prototipo en tenant.js).
//
// Un comentario (o evento) con stickers pasa por processStickerUse: se anotan en el
// catálogo, se muestran en la actividad del Dashboard y disparan la alerta de CADA
// sticker una sola vez aunque venga repetido. Si el comentario trae texto que el TTS del
// panel va a leer, las alertas esperan a que termine (pedido explícito): el TTS corre en
// el navegador del streamer, así que el servidor no puede saber cuándo acaba; el panel
// se lo avisa con `tts_message_done` (ver TtsChat.jsx) y entonces se sueltan.
const db = require('../../db');
const { createStickerDirectory } = require('../stickerDirectoryCore');
const {
    STICKER_TTS_WAIT_MAX_MS,
    stickerAlertKey,
    pickStickerAlerts,
    createStickerRepeatGuard,
} = require('../stickerCatalog');

module.exports = {
    // Catálogo de esta licencia (ver stickerDirectoryCore.js). Se crea al primer uso y
    // empieza a leer lo guardado enseguida.
    getStickerDirectory() {
        if (!this.stickerDirectory) {
            this.stickerDirectory = createStickerDirectory({
                listRows: () => db.listSeenStickers(this.licenseId),
                upsertRow: (sticker) => db.upsertSeenSticker(this.licenseId, sticker),
            });
            this.stickerDirectory.load();
        }
        return this.stickerDirectory;
    },

    getKnownStickers() {
        return this.getStickerDirectory().list();
    },

    // Anota los stickers vistos y le avisa al panel de los nuevos (o de una imagen
    // distinta) para que aparezcan en el selector de alertas sin recargar nada.
    noteSeenStickers(stickers) {
        const directory = this.getStickerDirectory();
        for (const sticker of stickers) {
            if (sticker.id && directory.record(sticker)) this.broadcast.emit('sticker_seen', { id: sticker.id, imageUrl: sticker.imageUrl });
        }
    },

    // Una sola vez por sesión, en el registro: cómo marca TikTok los emotes de ESTE canal (tipo,
    // escena y condición) y si trae imagen. Es lo único que no se pudo comprobar sin un LIVE
    // real (si TikTok los marca como del club de fans o no), y con esta línea se ve en Render
    // sin adivinar. Mismo criterio que la muestra de `roomUser` (ver handleRoomUserEvent).
    noteEmoteSample(source, emotes) {
        if (this.loggedEmoteSample || !Array.isArray(emotes) || emotes.length === 0) return;
        const emote = emotes[0];
        if (!emote || typeof emote !== 'object') return;
        this.loggedEmoteSample = true;
        console.log(`[${this.logId}] [EMOTE] Muestra de emote (una sola vez, llegó como ${source}):`, JSON.stringify({
            emoteId: emote.emoteId ?? null, emoteType: emote.emoteType ?? null, emoteScene: emote.emoteScene ?? null,
            rewardCondition: emote.rewardCondition ?? null, conImagen: !!(emote.emoteImageUrl || emote.image?.urlList?.length),
        }));
    },

    // Un comentario o evento con stickers (emotes). `holdForTts`: el comentario
    // trae texto que el TTS puede leer, así que las alertas esperan a que termine de
    // leerse (`messageId` es el mismo id que lleva el mensaje del TTS). Devuelve true si
    // quedaron esperando (el mensaje del TTS tiene que pedirle al panel que avise al terminar).
    processStickerUse({ username, nickname, avatar, userKey, stickers, messageId, holdForTts = false }) {
        if (!Array.isArray(stickers) || stickers.length === 0) return false;
        if (!this.stickerRepeatGuard) this.stickerRepeatGuard = createStickerRepeatGuard();
        const now = Date.now();
        const who = userKey || username || '?';
        // El mismo usuario con el mismo sticker dos veces casi a la vez es una sola acción
        // (TikTok a veces la entrega como comentario y como evento de sticker).
        const fresh = stickers.filter((sticker) => this.stickerRepeatGuard.allow(who, sticker.id, now));
        if (fresh.length === 0) return false;

        // Todos los stickers quedan en el catálogo (para poder elegirlos en una alerta), pero solo
        // los del club de fans, o uno que dispara una alerta, salen en la actividad del Dashboard.
        this.noteSeenStickers(fresh);
        const fires = pickStickerAlerts(fresh, {
            findSpecific: (id) => this.alertConfigs[stickerAlertKey(id)] || null,
            generic: this.alertConfigs[stickerAlertKey('')] || null,
        });
        if (fires.length > 0 || fresh.some((sticker) => sticker.club)) {
            this.pushFeed({
                type: 'sticker', username, nickname, avatar,
                icon: fresh.find((sticker) => sticker.imageUrl)?.imageUrl || '',
            });
        }
        if (fires.length === 0) return false;

        const target = { username: username || '', nickname: nickname || username || '', alerts: fires.map(({ alert }) => alert) };
        if (holdForTts && messageId && this.panelSockets?.size > 0) return this.holdStickerAlerts(messageId, target);
        this.fireStickerAlerts(target);
        return false;
    },

    fireStickerAlerts({ username, nickname, alerts }) {
        for (const alert of alerts) this.emitAlertTriggered(alert, { username, nickname, count: 1 });
    },

    // Deja las alertas esperando el aviso del panel. Se sueltan cuando TODOS los paneles
    // abiertos avisan que ya no tienen que leer ese mensaje (lo leyeron, no lo iban a
    // leer o lo descartaron), cuando se cierra el último que faltaba, o -- para que nunca
    // se pierdan -- pasado STICKER_TTS_WAIT_MAX_MS.
    holdStickerAlerts(messageId, target) {
        if (this.pendingStickerAlerts.has(messageId)) this.releaseStickerAlerts(messageId);
        const timer = setTimeout(() => this.releaseStickerAlerts(messageId), STICKER_TTS_WAIT_MAX_MS);
        if (timer.unref) timer.unref();
        this.pendingStickerAlerts.set(messageId, { target, waiting: new Set(this.panelSockets), timer });
        return true;
    },

    releaseStickerAlerts(messageId) {
        const pending = this.pendingStickerAlerts.get(messageId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingStickerAlerts.delete(messageId);
        this.fireStickerAlerts(pending.target);
    },

    // Un panel avisó que terminó con ese mensaje. Solo cuenta el aviso de un panel de los
    // que se esperaban (un overlay no lee nada), y las alertas salen al llegar el último.
    acknowledgeTtsMessage(socketId, messageId) {
        const pending = this.pendingStickerAlerts.get(messageId);
        if (!pending || !pending.waiting.delete(socketId)) return;
        if (pending.waiting.size === 0) this.releaseStickerAlerts(messageId);
    },

    // Un panel se cerró: ya no se le espera. Si era el único que faltaba, las alertas salen.
    forgetPanelSocket(socketId) {
        this.panelSockets.delete(socketId);
        for (const [messageId, pending] of [...this.pendingStickerAlerts]) {
            if (pending.waiting.delete(socketId) && pending.waiting.size === 0) this.releaseStickerAlerts(messageId);
        }
    },

    // Al soltar el tenant: nada de temporizadores vivos ni alertas que salgan después.
    clearStickerHolds() {
        for (const { timer } of this.pendingStickerAlerts.values()) clearTimeout(timer);
        this.pendingStickerAlerts.clear();
        this.panelSockets.clear();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js, solo para
    // quien puede controlar: nunca para un overlay de solo lectura).
    registerStickerHandlers(socket) {
        this.getStickerDirectory(); // que el catálogo ya esté leído cuando llegue el primer sticker
        // Solo se espera a un panel que avisó que sabe avisar (`tts_ack_ready`, lo manda
        // TtsChat al conectarse): una pestaña con una versión vieja del panel, o una sin
        // sesión de usuario (un overlay que entra con la clave), no contestaría nunca y
        // dejaría las alertas esperando el máximo.
        socket.on('tts_ack_ready', () => {
            if (socket.authMethod !== 'jwt') return;
            this.panelSockets.add(socket.id);
        });
        socket.on('disconnect', () => this.forgetPanelSocket(socket.id));
        socket.on('tts_message_done', (messageId) => {
            if (typeof messageId === 'string' && messageId && messageId.length <= 120) this.acknowledgeTtsMessage(socket.id, messageId);
        });
    },
};
