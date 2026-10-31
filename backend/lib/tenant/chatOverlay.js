// Overlay de chat (pestaña Chat de Eventos): mensajes, seguidores, regalos,
// compartidos y el mensaje anclado, para mostrarlos como el chat de Social
// Stream Ninja. Métodos de Tenant (se agregan a su prototipo en tenant.js).
//
// Ancho de banda (ver la nota de Render en el repo: ya se agotó una vez): el
// chat es lo que más mensajes genera en un LIVE, así que NO va al room de la
// licencia completo sino a uno aparte (`<licencia>:chat`) al que solo entran
// los overlays de chat (`overlayScreen: 'chat'`) y el panel mientras tiene
// abierta la pestaña Chat (`chat_overlay_subscribe`).
const db = require('../../db');
const {
    CHAT_SETTINGS_DEFAULTS,
    CHAT_RECENT_MAX,
    sanitizeChatSettings,
    pinnedFromRoomPin,
    chatMessageItem,
    followItem,
    giftItem,
} = require('../chatOverlay');

module.exports = {
    get chatRoom() {
        return `${this.licenseId}:chat`;
    },

    initChatOverlayState() {
        this.chatSettings = { ...CHAT_SETTINGS_DEFAULTS };
        this.chatRecent = [];
        this.chatPinned = null;
        this.chatItemCounter = 0;
        this.chatPinTimer = null;
    },

    // Un evento nuevo del chat (ya armado por lib/chatOverlay.js). Lo más
    // reciente queda al final de `chatRecent`; el overlay decide el orden.
    pushChatItem(item) {
        if (!item) return null;
        const entry = { id: ++this.chatItemCounter, at: Date.now(), ...item };
        this.chatRecent.push(entry);
        if (this.chatRecent.length > CHAT_RECENT_MAX) this.chatRecent.splice(0, this.chatRecent.length - CHAT_RECENT_MAX);
        this.io.to(this.chatRoom).emit('chat_item', entry);
        return entry;
    },

    // Mensaje anclado/desanclado desde TikTok (evento 'roomPin'). Se recuerda
    // para que un overlay que se abre después también lo muestre; si TikTok
    // dice cuánto dura, se quita solo al vencer.
    handleRoomPinEvent(data) {
        const result = pinnedFromRoomPin(data);
        // Nunca visto en un LIVE real: esta línea permite confirmarlo en los
        // registros de Render la primera vez que llegue.
        console.log(`[${this.logId}] [CHAT] Mensaje anclado — action=${data?.action} ${result ? result.action : 'ignorado'}`);
        if (!result) return;
        if (this.chatPinTimer) { clearTimeout(this.chatPinTimer); this.chatPinTimer = null; }
        if (result.action === 'unpin') {
            this.setChatPinned(null);
            return;
        }
        this.setChatPinned({ id: ++this.chatItemCounter, at: Date.now(), ...result.item });
        if (result.item.durationSeconds > 0) {
            this.chatPinTimer = setTimeout(() => { this.chatPinTimer = null; this.setChatPinned(null); }, result.item.durationSeconds * 1000);
            if (this.chatPinTimer.unref) this.chatPinTimer.unref();
        }
    },

    setChatPinned(pinned) {
        this.chatPinned = pinned;
        this.io.to(this.chatRoom).emit('chat_pinned', pinned);
    },

    // Un LIVE nuevo empieza con el chat vacío y sin anclado.
    resetChatOverlay() {
        this.chatRecent = [];
        if (this.chatPinTimer) { clearTimeout(this.chatPinTimer); this.chatPinTimer = null; }
        this.setChatPinned(null);
    },

    // Entra a la sala del chat y recibe lo reciente, el anclado y los ajustes.
    // El overlay lo pide él mismo (chat_overlay_subscribe) cuando ya está
    // escuchando: si se mandara solo al conectar, podría llegar antes de que
    // el componente empiece a escuchar y perderse.
    joinChatRoom(socket) {
        socket.join(this.chatRoom);
        socket.emit('chat_snapshot', { items: this.chatRecent, pinned: this.chatPinned, settings: this.chatSettings });
    },

    // Solo ver: entrar y salir de la sala del chat. Es lo único del chat que
    // se registra para el overlay de OBS con token de solo lectura (ver
    // attachSocket en tenant.js, que no le da ninguna acción de control).
    registerChatOverlayViewerHandlers(socket) {
        // El overlay de chat de OBS entra solo a la sala del chat.
        if (socket.authMethod !== 'jwt' && socket.handshake?.auth?.overlayScreen === 'chat') this.joinChatRoom(socket);

        // El overlay lo pide al empezar a escuchar; el panel, mientras tiene
        // abierta la pestaña Chat (vista previa en vivo), y sale al cerrarla.
        socket.on('chat_overlay_subscribe', () => this.joinChatRoom(socket));
        socket.on('chat_overlay_unsubscribe', () => socket.leave(this.chatRoom));
    },

    registerChatOverlayHandlers(socket) {
        this.registerChatOverlayViewerHandlers(socket);

        socket.on('update_chat_settings', (raw) => {
            if (socket.authMethod !== 'jwt') return; // los overlays solo reciben
            this.chatSettings = sanitizeChatSettings(raw, this.chatSettings);
            this.broadcast.emit('chat_settings_update', this.chatSettings);
            // Fire-and-forget, igual que los ajustes de Spotify: la copia en
            // memoria ya se actualizó y ya se reenvió.
            db.setChatSettings(this.licenseId, this.chatSettings).catch((err) => {
                console.error(`[${this.logId}] No se pudo guardar chat_settings:`, err.message);
            });
        });

        // "Mensaje de prueba" del panel: para ver el overlay en OBS sin estar
        // en vivo. Un mensaje, uno largo de alguien con varias insignias (para
        // ver cómo baja de línea), un seguidor y un regalo, como si llegaran
        // de TikTok. Con freno, para que no se pueda llenar el chat a clics.
        socket.on('chat_overlay_test', () => {
            if (socket.authMethod !== 'jwt') return;
            const now = Date.now();
            if (now - (this.chatTestAt || 0) < 1500) return;
            this.chatTestAt = now;
            const tester = { uniqueId: 'prueba', nickname: 'Prueba', teamMemberLevel: 12, isModerator: true };
            this.pushChatItem(chatMessageItem(tester, { rawComment: '¡Hola! Así se ve un mensaje en tu chat.' }));
            const regular = { uniqueId: 'fan_de_siempre', nickname: 'Fan de siempre con nombre largo', teamMemberLevel: 25, gifterLevel: 30, isSubscriber: true, topGifterRank: 2 };
            this.pushChatItem(chatMessageItem(regular, { rawComment: 'Un mensaje largo se ve completo: sigue en las líneas de abajo, alineado con su comienzo, sin cortarse ni perder nada de lo que escribió la persona.' }));
            this.pushChatItem(followItem({ uniqueId: 'nuevo_seguidor', nickname: 'Nuevo seguidor' }));
            this.pushChatItem(giftItem({ username: 'fan_top', nickname: 'Fan top', giftName: 'Rosa', count: 5, coins: 5, badgesSource: { topGifterRank: 1 } }));
        });

        socket.on('clear_chat_overlay', () => {
            if (socket.authMethod !== 'jwt') return;
            this.chatRecent = [];
            this.io.to(this.chatRoom).emit('chat_snapshot', { items: [], pinned: this.chatPinned, settings: this.chatSettings });
        });
    },
};
