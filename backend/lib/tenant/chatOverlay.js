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
    subscribeItem,
    superFanJoinItem,
    chestItem,
    fansLevelUpItem,
} = require('../chatOverlay');

// Una misma suscripción puede llegar dos veces: como WebcastSubNotifyMessage y
// como el aviso "se hizo Superfan" (barrage). Si de la misma persona llega la
// otra dentro de este tiempo, no se repite en el chat.
const SUBSCRIBE_DEDUP_MS = 2 * 60 * 1000;
// Cofres que ya se mostraron (TikTok puede volver a mandar el mismo).
const SEEN_CHESTS_MAX = 200;
// Nivel del club de fans visto por persona en este LIVE (para mostrar el
// anterior en una subida y no repetirla). Acotado.
const FAN_LEVELS_MAX = 5000;

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
        this.chatRecentSubscribers = new Map();
        this.chatSeenChests = new Set();
        this.chatFanLevels = new Map();
    },

    // El nivel del club de fans que el chat ya vio de cada persona (de sus
    // insignias en mensajes y eventos, o de una subida).
    noteChatFanLevel(item) {
        const uid = item?.user?.uniqueId;
        const level = item?.user?.badges?.fanLevel || 0;
        if (!uid || level <= 0) return;
        if ((this.chatFanLevels.get(uid) || 0) >= level) return;
        if (!this.chatFanLevels.has(uid) && this.chatFanLevels.size >= FAN_LEVELS_MAX) this.chatFanLevels.delete(this.chatFanLevels.keys().next().value);
        this.chatFanLevels.set(uid, level);
    },

    // ── Suscripciones, Superfans y cofres (ver lib/chatOverlay.js) ──
    // Las tres líneas de registro permiten confirmar en Render el formato real
    // la primera vez que lleguen (nunca se vieron en un LIVE real).
    handleSubscribeEvent(data) {
        const item = subscribeItem(data);
        console.log(`[${this.logId}] [CHAT] Suscripción — messageType=${data?.messageType} subMonth=${data?.subMonth} status=${data?.oldSubscribeStatus} type=${data?.subscribeType} → ${item ? 'mostrada' : 'ignorada'}`);
        this.pushSubscribeItem(item);
    },

    handleBarrageEvent(data) {
        const item = superFanJoinItem(data);
        if (item) {
            console.log(`[${this.logId}] [CHAT] Superfan nuevo (barrage) — @${item.user.uniqueId}`);
            this.pushSubscribeItem(item);
            return;
        }
        this.handleFansLevelUp(data);
    },

    // Subida de nivel del club de fans. Una misma subida (o una vieja que llega
    // tarde) no se repite: solo se muestra si el nivel es MAYOR que el último
    // que el chat sabe de esa persona. Ese último también es el "anterior".
    handleFansLevelUp(data) {
        const probe = fansLevelUpItem(data);
        if (!probe) return;
        const known = this.chatFanLevels.get(probe.user.uniqueId) || 0;
        console.log(`[${this.logId}] [CHAT] Subida de nivel del club — @${probe.user.uniqueId} nivel=${probe.levelUp.level} conocido=${known || '-'} → ${probe.levelUp.level > known ? 'mostrada' : 'repetida'}`);
        if (probe.levelUp.level <= known) return;
        this.pushChatItem(fansLevelUpItem(data, { previous: known }));
    },

    pushSubscribeItem(item) {
        if (!item) return;
        const now = Date.now();
        for (const [user, at] of this.chatRecentSubscribers) if (now - at > SUBSCRIBE_DEDUP_MS) this.chatRecentSubscribers.delete(user);
        if (this.chatRecentSubscribers.has(item.user.uniqueId)) return;
        this.chatRecentSubscribers.set(item.user.uniqueId, now);
        this.pushChatItem(item);
    },

    handleEnvelopeEvent(data) {
        const item = chestItem(data);
        const info = data?.envelopeInfo || {};
        console.log(`[${this.logId}] [CHAT] Cofre — display=${data?.display} businessType=${info.businessType} monedas=${info.diamondCount} personas=${info.peopleCount} → ${item ? 'mostrado' : 'ignorado'}`);
        if (!item) return;
        if (item.chest.id) {
            if (this.chatSeenChests.has(item.chest.id)) return;
            this.chatSeenChests.add(item.chest.id);
            if (this.chatSeenChests.size > SEEN_CHESTS_MAX) this.chatSeenChests.delete(this.chatSeenChests.values().next().value);
        }
        this.pushChatItem(item);
    },

    // Un evento nuevo del chat (ya armado por lib/chatOverlay.js). Lo más
    // reciente queda al final de `chatRecent`; el overlay decide el orden.
    pushChatItem(item) {
        if (!item) return null;
        this.noteChatFanLevel(item);
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
            this.pushChatItem(giftItem({ username: 'fan_top', nickname: 'Fan top', giftName: 'Rosa', count: 5, unitCoins: 1, badgesSource: { topGifterRank: 1 } }));
            // Un miembro de nivel alto que además es Superfan (borde y efectos
            // especiales), una suscripción y un cofre, con los mismos datos que
            // mandaría TikTok.
            const vip = { uniqueId: 'superfan_vip', nickname: 'Superfan VIP', teamMemberLevel: 27, userSceneTypes: [4, 10] };
            this.pushChatItem(chatMessageItem(vip, { rawComment: 'Así se ven los miembros de nivel alto que además son Superfan.' }));
            this.pushChatItem(subscribeItem({ ...vip, uniqueId: 'nueva_superfan', nickname: 'Nueva Superfan', teamMemberLevel: 3, messageType: 0, subMonth: '1', oldSubscribeStatus: 0 }));
            this.pushChatItem(chestItem({ display: 1, envelopeInfo: { envelopeId: '', sendUserName: 'Fan del cofre', diamondCount: 1000, peopleCount: 50 } }));
            // Subidas de nivel del club: una común (5 → 6) y una a más de 20.
            this.pushChatItem(fansLevelUpItem({ msgType: 10, uniqueId: 'fan_que_sube', nickname: 'Fan que sube', fansLevelParam: { currentGrade: 6 } }, { previous: 5 }));
            this.pushChatItem(fansLevelUpItem({ msgType: 10, uniqueId: 'fan_de_nivel_alto', nickname: 'Fan de nivel alto', userSceneTypes: [4], fansLevelParam: { currentGrade: 21 } }, { previous: 20 }));
        });

        socket.on('clear_chat_overlay', () => {
            if (socket.authMethod !== 'jwt') return;
            this.chatRecent = [];
            this.io.to(this.chatRoom).emit('chat_snapshot', { items: [], pinned: this.chatPinned, settings: this.chatSettings });
        });
    },
};
