// Overlay de chat (pestaña Chat de Eventos): reglas puras, sin estado. Arma lo
// que ve el overlay a partir de los eventos crudos de TikTok (mensajes,
// seguidores, regalos, compartidos y mensajes anclados) y limpia los ajustes
// que manda el panel. Todo lo que llega de TikTok se limita en tamaño y tipo
// antes de reenviarse, igual que el feed del Dashboard (lib/tenant/feed.js).

const { splitStickerMarkers } = require('./stickerCatalog');

const CHAT_SETTINGS_DEFAULTS = Object.freeze({
    // Segundos que se queda cada mensaje antes de desvanecerse; 0 = nunca
    // (solo salen cuando llegan más y se pasa de maxMessages).
    fadeSeconds: 30,
    // false (por defecto, pedido explícito, como el chat de TikTok): el primer
    // mensaje sale arriba, cada nuevo debajo del anterior, y al desvanecerse
    // el de arriba los demás suben; si no caben, lo más viejo se desliza hacia
    // arriba fuera del overlay. true: lo más nuevo arriba, empujando hacia abajo.
    newestOnTop: false,
    maxMessages: 12,
    // Tamaño de letra fijo del overlay, en px. 24 (antes 16): pensado para
    // leerse en OBS vertical, donde la fuente se ve achicada en el lienzo.
    fontSize: 24,
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
const FONT_SIZE_MAX = 48;
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

// Insignias que el overlay dibuja con un ícono propio, por el tipo que les da
// TikTok (badgeSceneType, ver mapBadges en tiktok-live-connector): 1 moderador,
// 4 y 7 suscriptor, 8 nivel de gifter, 10 club de fans. El top gifter se
// reconoce por su imagen (ranklist_top_gifter_N), igual que en la librería.
// Una imagen se toma por repetida SOLO si el ícono de ese rol de verdad se va
// a dibujar: si no, se conserva como imagen (nunca desaparece una insignia).
function roleDrawn(badge, url, roles) {
    if (url.includes('/ranklist_top_gifter_')) return Boolean(roles.topGifterRank);
    switch (Number(badge?.badgeSceneType)) {
        case 1: return roles.moderator;
        case 4:
        case 7: return roles.subscriber;
        case 8: return roles.gifterLevel > 0;
        case 10: return roles.fanLevel > 0;
        default: return false;
    }
}

// El nivel de un tipo de insignia (8 gifter, 10 club de fans) desde las
// insignias mismas. La librería toma la PRIMERA insignia de ese tipo, y para
// el mismo grupo pone antes la imagen (sin nivel) que la entrada con el
// nivel: el nivel podía llegar en 0 aunque TikTok sí lo mandara.
function levelFromBadges(raw, sceneType) {
    return raw.reduce((max, badge) => (Number(badge?.badgeSceneType) === sceneType ? Math.max(max, clampInt(badge?.level, 0, 99, 0)) : max), 0);
}

// Las insignias del usuario: las señales que ya resuelve la librería
// (moderador, suscriptor, top gifter, nivel del club de fans y de gifter),
// que el overlay dibuja como íconos, y las imágenes reales de TikTok.
// `others` son las imágenes que no son uno de esos roles ya dibujados (otros
// reconocimientos, o un rol del que no hay datos para su ícono): mostrar todas
// repetía el moderador o el club de fans. `images` (todas) se mantiene por
// compatibilidad.
function badgesFrom(data = {}) {
    const raw = Array.isArray(data.userBadges) ? data.userBadges : [];
    const identity = data.userIdentity || {};
    const topGifterRank = clampInt(data.topGifterRank, 0, 3, 0);
    const roles = {
        moderator: Boolean(data.isModerator || identity.isModeratorOfAnchor),
        subscriber: Boolean(data.isSubscriber || identity.isSubscriberOfAnchor),
        topGifterRank: topGifterRank || null,
        fanLevel: clampInt(data.teamMemberLevel || data.user?.fansClubInfo?.fansLevel || levelFromBadges(raw, 10), 0, 99, 0),
        gifterLevel: clampInt(data.gifterLevel || levelFromBadges(raw, 8), 0, 99, 0),
    };
    const images = [];
    const others = [];
    for (const badge of raw) {
        const url = image(badge?.url);
        if (!url) continue;
        if (!images.includes(url) && images.length < BADGE_IMAGES_MAX) images.push(url);
        if (!roleDrawn(badge, url, roles) && !others.includes(url) && others.length < BADGE_IMAGES_MAX) others.push(url);
    }
    return { images, others, ...roles };
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

const MAX_EMOTES_PER_MESSAGE = 10;
const MAX_TEXT_LENGTH = 300;

// La imagen de un emote tal como llega (comentario parcheado o evento suelto).
function emoteImage(emote) {
    return image(emote?.emoteImageUrl || emote?.image?.urlList?.[0] || emote?.image?.imageUrl || emote?.imageUrl || '');
}

// Los emotes de un mensaje con imagen, en el orden en que aparecen. Para el
// chat cuentan TODOS los que traen imagen (como los muestra TikTok), no solo
// los que cuentan como sticker para las alertas (ver lib/stickerCatalog.js).
function emotesInOrder(emotes) {
    return (Array.isArray(emotes) ? emotes : [])
        .map((emote, order) => ({ url: emoteImage(emote), place: Number(emote?.placeInComment ?? emote?.index), order }))
        .filter((emote) => emote.url)
        .sort((a, b) => (Number.isFinite(a.place) && Number.isFinite(b.place) ? a.place - b.place : a.order - b.order))
        .slice(0, MAX_EMOTES_PER_MESSAGE);
}

// El comentario en partes: texto y emotes donde los puso la persona, como el
// chat de TikTok. TikTok deja un marcador en el lugar de cada emote (ver
// splitStickerMarkers): el primer emote va en el primer marcador, y así. Si
// no trae marcadores se usa la posición que manda (placeInComment). Lo que
// sobre va al final. Nunca visto con un LIVE real: si la posición no cuadra,
// lo peor que pasa es que el emote quede en otro lugar del mismo mensaje.
function commentParts(rawComment, emotes) {
    const raw = String(rawComment ?? '');
    const images = emotesInOrder(emotes);
    const parts = [];
    let textLeft = MAX_TEXT_LENGTH;
    const pushText = (value) => {
        const clean = String(value).replace(/\s+/g, ' ').slice(0, Math.max(0, textLeft));
        if (!clean) return;
        textLeft -= clean.length;
        const last = parts[parts.length - 1];
        if (last?.type === 'text') last.value += clean; else parts.push({ type: 'text', value: clean });
    };
    const pushEmote = (url) => parts.push({ type: 'emote', url });

    const pieces = splitStickerMarkers(raw);
    const markers = pieces.length - 1;
    if (images.length > 0 && markers > 0) {
        pieces.forEach((piece, i) => {
            pushText(piece);
            if (i < markers && i < images.length) pushEmote(images[i].url);
        });
        images.slice(markers).forEach((emote) => pushEmote(emote.url));
    } else if (images.length > 0) {
        let cursor = 0;
        for (const emote of images) {
            const at = Number.isFinite(emote.place) ? Math.min(raw.length, Math.max(cursor, emote.place)) : raw.length;
            pushText(raw.slice(cursor, at));
            pushEmote(emote.url);
            cursor = at;
        }
        pushText(raw.slice(cursor));
    } else {
        pushText(raw);
    }
    // Sin espacios sueltos al principio ni al final del mensaje.
    if (parts[0]?.type === 'text') parts[0].value = parts[0].value.trimStart();
    const last = parts[parts.length - 1];
    if (last?.type === 'text') last.value = last.value.trimEnd();
    return parts.filter((part) => part.type !== 'text' || part.value);
}

// Un mensaje de chat. Va TODO, incluidos comandos (!play) y @menciones
// (pedido explícito: "mostrar todo, como en el chat real"), y sus emotes en
// su lugar. Un emote mandado solo (sin texto) es un mensaje más, como en
// TikTok. `text` es el mensaje sin emotes (para lo que solo lee texto).
function chatMessageItem(data, { rawComment = '', emotes = [] } = {}) {
    const user = userFrom(data);
    if (!user.uniqueId) return null;
    const parts = commentParts(rawComment, emotes);
    if (parts.length === 0) return null;
    const plain = text(parts.filter((part) => part.type === 'text').map((part) => part.value).join(''), MAX_TEXT_LENGTH);
    return { kind: 'chat', user, text: plain, parts };
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
    commentParts,
};
