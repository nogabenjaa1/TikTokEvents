// Overlay de chat (pestaña Chat de Eventos): reglas puras, sin estado. Arma lo
// que ve el overlay a partir de los eventos crudos de TikTok (mensajes,
// seguidores, regalos, compartidos y mensajes anclados) y limpia los ajustes
// que manda el panel. Todo lo que llega de TikTok se limita en tamaño y tipo
// antes de reenviarse, igual que el feed del Dashboard (lib/tenant/feed.js).

const CHAT_SETTINGS_DEFAULTS = Object.freeze({
    // Segundos que se queda cada mensaje antes de desvanecerse; 0 = nunca
    // (solo salen cuando llegan más y se pasa de maxMessages).
    fadeSeconds: 30,
    // Lo más nuevo arriba y lo anterior va bajando (pedido explícito, como
    // Social Stream Ninja); en false, lo más nuevo abajo.
    newestOnTop: true,
    maxMessages: 12,
    // Tamaño de letra fijo del overlay, en px.
    fontSize: 16,
    showAvatars: true,
    showBadges: true,
    showFollows: true,
    showGifts: true,
    showShares: true,
    showPinned: true,
    showViewerCount: true,
});

const FADE_MAX_SECONDS = 600;
const MAX_MESSAGES_MAX = 30;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 32;
const CHAT_RECENT_MAX = MAX_MESSAGES_MAX;
const BADGE_IMAGES_MAX = 4;

const BOOLEAN_SETTINGS = ['newestOnTop', 'showAvatars', 'showBadges', 'showFollows', 'showGifts', 'showShares', 'showPinned', 'showViewerCount'];

function clampInt(value, min, max, fallback) {
    // null/'' no son números: Number(null) daría 0 y se tomaría como válido.
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Ajustes que manda el panel (o que vienen de la base): lo que falte o venga
// inválido se queda con lo que ya había, nunca se confía a ciegas.
function sanitizeChatSettings(raw, current = CHAT_SETTINGS_DEFAULTS) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = { ...CHAT_SETTINGS_DEFAULTS, ...current };
    if (source.fadeSeconds !== undefined) next.fadeSeconds = clampInt(source.fadeSeconds, 0, FADE_MAX_SECONDS, next.fadeSeconds);
    if (source.maxMessages !== undefined) next.maxMessages = clampInt(source.maxMessages, 1, MAX_MESSAGES_MAX, next.maxMessages);
    if (source.fontSize !== undefined) next.fontSize = clampInt(source.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, next.fontSize);
    for (const key of BOOLEAN_SETTINGS) {
        if (source[key] !== undefined) next[key] = Boolean(source[key]);
    }
    return next;
}

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Solo imágenes por https: el overlay corre en OBS y no debe cargar otra cosa.
const image = (value) => (typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= 500 ? value : '');

// Las insignias del usuario como las muestra TikTok: las imágenes reales que
// trae `userBadges` (club de fans con su nivel, nivel de gifter, top gifter,
// moderador...) y, aparte, las señales que ya resuelve la librería, para
// dibujar una insignia propia cuando TikTok no manda imagen.
function badgesFrom(data = {}) {
    const raw = Array.isArray(data.userBadges) ? data.userBadges : [];
    const images = [];
    for (const badge of raw) {
        const url = image(badge?.url);
        if (url && !images.includes(url)) images.push(url);
        if (images.length >= BADGE_IMAGES_MAX) break;
    }
    const identity = data.userIdentity || {};
    const topGifterRank = clampInt(data.topGifterRank, 0, 3, 0);
    return {
        images,
        moderator: Boolean(data.isModerator || identity.isModeratorOfAnchor),
        subscriber: Boolean(data.isSubscriber || identity.isSubscriberOfAnchor),
        topGifterRank: topGifterRank || null,
        fanLevel: clampInt(data.teamMemberLevel ?? data.user?.fansClubInfo?.fansLevel, 0, 99, 0),
        gifterLevel: clampInt(data.gifterLevel, 0, 99, 0),
    };
}

function userFrom(data = {}) {
    const uniqueId = text(data.uniqueId, 40);
    return {
        uniqueId,
        nickname: text(data.nickname, 60) || uniqueId,
        avatar: image(data.profilePictureUrl),
        badges: badgesFrom(data),
    };
}

// Un mensaje de chat. Va TODO, incluidos comandos (!play) y @menciones
// (pedido explícito: "mostrar todo, como en el chat real"). `stickers` son
// los emotes del mensaje ya resueltos (ver lib/stickerCatalog.js).
function chatMessageItem(data, { comment = '', stickers = [] } = {}) {
    const user = userFrom(data);
    const body = text(comment, 300);
    const emotes = (Array.isArray(stickers) ? stickers : []).map((s) => image(s?.imageUrl || s?.image || s?.url)).filter(Boolean).slice(0, 6);
    if (!user.uniqueId || (!body && emotes.length === 0)) return null;
    return { kind: 'chat', user, text: body, emotes };
}

function followItem(data) {
    const user = userFrom(data);
    return user.uniqueId ? { kind: 'follow', user } : null;
}

function shareItem(data) {
    const user = userFrom(data);
    return user.uniqueId ? { kind: 'share', user } : null;
}

// Un regalo ya cerrado (una racha x7 es UN evento, ver dispatchGiftEvent).
function giftItem({ username, nickname, avatar, giftName, icon, count, coins, badgesSource }) {
    const user = userFrom({ ...(badgesSource || {}), uniqueId: username, nickname, profilePictureUrl: avatar });
    if (!user.uniqueId) return null;
    return {
        kind: 'gift',
        user,
        gift: {
            name: text(giftName, 60),
            icon: image(icon),
            count: clampInt(count, 1, 999999, 1),
            coins: clampInt(coins, 0, 99999999, 0),
        },
    };
}

// Un "compartió el LIVE": TikTok manda follows y compartidos en el mismo
// mensaje social. Un follow trae action "1" (confirmado en vivo, ver
// handleSocialEvent); un compartido nunca se vio en un LIVE real, así que se
// reconoce por traer datos de compartir y no ser follow.
function isShareSocial(data = {}) {
    if (String(data.action) === '1') return false;
    return Boolean(data.shareType || data.shareTarget || Number(data.shareCount) > 0 || String(data.displayType || '').includes('share'));
}

// Mensaje anclado (WebcastRoomPinMessage, evento 'roomPin'): la librería no lo
// simplifica, llega crudo. action 1 = anclar, 2 = quitar.
const PIN_ACTION = { PIN: 1, CANCEL: 2 };
function pinnedFromRoomPin(data = {}) {
    const action = Number(data.action);
    if (action === PIN_ACTION.CANCEL) return { action: 'unpin' };
    if (action !== PIN_ACTION.PIN) return null;
    const chat = data.chatMessage || {};
    const rawUser = chat.user || {};
    const avatarList = rawUser.avatarThumb?.urlList || rawUser.avatarMedium?.urlList || rawUser.avatarLarge?.urlList || [];
    const user = {
        uniqueId: text(rawUser.displayId || rawUser.uniqueId, 40),
        nickname: text(rawUser.nickname, 60) || text(rawUser.displayId, 40),
        avatar: image(Array.isArray(avatarList) ? avatarList[0] : ''),
        badges: badgesFrom({}),
    };
    const body = text(chat.content, 300);
    if (!body) return null;
    const durationSeconds = clampInt(data.displayDuration, 0, 24 * 60 * 60, 0);
    return { action: 'pin', item: { kind: 'pin', user, text: body, durationSeconds } };
}

module.exports = {
    CHAT_SETTINGS_DEFAULTS,
    CHAT_RECENT_MAX,
    FADE_MAX_SECONDS,
    MAX_MESSAGES_MAX,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    sanitizeChatSettings,
    badgesFrom,
    chatMessageItem,
    followItem,
    shareItem,
    giftItem,
    isShareSocial,
    pinnedFromRoomPin,
};
