// Feed de actividad en vivo: lo último que pasó en el directo (regalos,
// seguidores, stickers del club de fans) para mostrarlo en el Dashboard del
// panel. No es un overlay: solo lo ve el streamer. Métodos de Tenant (se
// agregan a su prototipo en tenant.js).
const FEED_MAX = 50;
const FEED_TYPES = ['gift', 'follow', 'sticker'];

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Solo imágenes por https: el feed se pinta en el panel y no debe cargar otra cosa.
const image = (value) => (typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= 500 ? value : '');

// Un evento crudo -> el item que ve el panel, o null si no sirve. Todo lo que
// llega de TikTok se limita en tamaño y tipo antes de reenviarse.
function sanitizeFeedItem(raw) {
    if (!raw || !FEED_TYPES.includes(raw.type)) return null;
    const username = text(raw.username, 40);
    if (!username) return null;
    const count = Math.trunc(Number(raw.count));
    const coins = Math.trunc(Number(raw.coins));
    return {
        type: raw.type,
        username,
        nickname: text(raw.nickname, 60) || username,
        avatar: image(raw.avatar),
        giftName: raw.type === 'gift' ? text(raw.giftName, 60) : '',
        giftId: raw.type === 'gift' && Number.isSafeInteger(Number(raw.giftId)) ? Number(raw.giftId) : null,
        // La imagen del regalo, o la del sticker del club de fans cuando la trae.
        icon: raw.type === 'gift' || raw.type === 'sticker' ? image(raw.icon) : '',
        count: raw.type === 'gift' && Number.isFinite(count) && count > 0 ? Math.min(count, 999999) : 1,
        coins: raw.type === 'gift' && Number.isFinite(coins) && coins > 0 ? Math.min(coins, 99999999) : 0,
    };
}

module.exports = {
    sanitizeFeedItem,
    FEED_MAX,

    // Anota algo que pasó en el directo y se lo avisa al panel al momento. Lo
    // más reciente va primero; solo se recuerdan los últimos FEED_MAX.
    pushFeed(raw) {
        const item = sanitizeFeedItem(raw);
        if (!item) return null;
        const entry = { id: ++this.feedCounter, at: Date.now(), ...item };
        this.feed.unshift(entry);
        if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
        this.broadcast.emit('feed_item', entry);
        return entry;
    },

    // Un panel que se conecta (o recarga) recibe lo reciente de una vez.
    registerFeedHandlers(socket) {
        socket.emit('feed_snapshot', this.feed);
    },
};
