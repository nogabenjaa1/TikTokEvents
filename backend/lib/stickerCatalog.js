// Stickers del club de fans: qué trae cada mensaje de TikTok, cómo se limpia el
// texto que lee el TTS, cómo se evita el spam y qué alertas dispara un comentario.
// Todo puro (sin conexión, socket ni base de datos) para poder probarlo solo.
//
// TikTok NO entrega la lista de stickers de un creador (ni la librería ni su API
// pública la traen): lo único que existe son los stickers que llegan en el chat.
// Por eso el catálogo se arma con lo que va apareciendo en el directo (ver
// stickerDirectoryCore.js) y no se puede "descargar" al conectarse como los regalos.

// Los ids de sticker de TikTok son números largos (19 cifras hoy), guardados como texto.
const ID_PATTERN = /^\d{1,25}$/;
const MAX_IMAGE_URL_LENGTH = 500;
// Lo que TikTok puede dejar en el lugar de un sticker sin que se vea: caracteres de uso privado,
// el de "objeto" y el de reemplazo, y los de ancho cero. Se arma con los códigos para que el
// archivo no dependa de caracteres invisibles escritos a mano.
const INVISIBLE_CHARS = new RegExp("[" + [[0xE000, 0xF8FF], [0xFFFC, 0xFFFD], [0x200B, 0x200D], [0xFEFF, 0xFEFF]]
    .map(([from, to]) => String.fromCodePoint(from) + (from === to ? '' : '-' + String.fromCodePoint(to))).join('') + ']', 'g');
// Cuántos stickers DISTINTOS de un mismo comentario pueden disparar su alerta. El mismo
// sticker repetido cuenta una sola vez (ver extractStickers); esto solo acota
// el caso raro de un comentario lleno de stickers distintos.
const MAX_STICKER_ALERTS_PER_COMMENT = 3;
// Y cuántos stickers de un comentario se miran para buscarles alerta (un comentario no puede
// traer más que unos pocos; esto solo acota el trabajo).
const MAX_STICKERS_LOOKED_AT = 20;
// Un mismo usuario con el mismo sticker dentro de esta ventana cuenta como un solo
// aviso: TikTok puede entregar la misma acción como comentario Y como evento de
// sticker, y así no suena dos veces.
const STICKER_REPEAT_WINDOW_MS = 1500;
// Lo máximo que las alertas de un comentario esperan a que el TTS termine de leerlo. Un
// mensaje puede esperar en la cola de voz hasta 30 s (lo normal; el panel deja subirlo a
// 120) y luego leerse unos segundos: pasado este tiempo la alerta sale igual, para que
// una pestaña congelada o un aviso perdido no la dejen esperando para siempre.
const STICKER_TTS_WAIT_MAX_MS = 60000;

// Los valores reales del club de fans en el protobuf (tiktok-live-proto/v3):
// EmoteType.EMOTE_TYPE_FANS, EmoteScene.FANS_CLUB y RewardCondition.REWARD_CONDITION_FANS_CLUB
// valen 2. Se aceptan también como texto por si alguna versión los entrega por nombre.
function isFansValue(value) {
    return value === 2 || value === '2' || (typeof value === 'string' && /fans/i.test(value));
}

function isFanClubEmote(emote) {
    return !!emote && (isFansValue(emote.emoteType) || isFansValue(emote.emoteScene) || isFansValue(emote.rewardCondition));
}

// El id numérico de un sticker (o '' si no sirve) y una imagen por https (o '').
function cleanStickerId(value) {
    const text = String(value ?? '');
    return ID_PATTERN.test(text) ? text : '';
}

function cleanImageUrl(value) {
    return typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= MAX_IMAGE_URL_LENGTH ? value : '';
}

// Un emote de TikTok -> { id, imageUrl }. Llega en dos formas: dentro de un comentario
// (`emoteId` + `emoteImageUrl`, ya simplificado por la librería) y en el evento de
// sticker (`emoteId` + `image.urlList`, tal cual el protobuf). `id` queda vacío si no
// trae uno válido: ese sticker todavía puede disparar la alerta de "cualquier sticker".
function stickerFromEmote(emote) {
    const url = emote?.emoteImageUrl || emote?.image?.urlList?.[0] || emote?.image?.imageUrl || emote?.imageUrl || '';
    return { id: cleanStickerId(emote?.emoteId ?? emote?.id), imageUrl: cleanImageUrl(url) };
}

// Los stickers (emotes) de una lista, sin repetir: el mismo sticker varias veces en un
// comentario es UN solo sticker (pedido explícito, contra el spam). Cuenta como sticker
// cualquier emote con id numérico (los emotes propios de cada creador, que TikTok llama
// "custom sticker") y también uno marcado del club de fans aunque no traiga id. Cada uno
// lleva `club`: si TikTok lo marca como del club de fans. Esa marca es lo que hace que un
// sticker dispare la alerta general de "cualquier sticker del club de fans" y salga en la
// actividad del Dashboard; para elegirlo en una alerta propia no hace falta, porque no se
// puede confirmar sin un LIVE real que TikTok marque siempre así los emotes de un canal.
function extractStickers(emotes) {
    if (!Array.isArray(emotes)) return [];
    const byKey = new Map();
    for (const emote of emotes) {
        const club = isFanClubEmote(emote);
        const sticker = stickerFromEmote(emote);
        if (!club && !sticker.id) continue;
        const key = sticker.id || '?';
        const previous = byKey.get(key);
        if (!previous) {
            byKey.set(key, { ...sticker, club });
        } else {
            if (!previous.imageUrl && sticker.imageUrl) previous.imageUrl = sticker.imageUrl;
            if (club) previous.club = true;
        }
    }
    return [...byKey.values()];
}

// El texto de un comentario con stickers, sin lo que TikTok deja en el lugar de cada
// uno (un marcador entre corchetes o un carácter invisible): es lo único que puede leer
// el TTS. Sin stickers el texto se usa tal cual, así que nada cambia para el resto del chat.
function readableCommentText(text) {
    return String(text ?? '')
        .replace(/\[[^[\]\n]{1,60}\]/g, ' ')
        .replace(INVISIBLE_CHARS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// La clave con la que se guarda la alerta de un sticker (en la misma columna que el
// nombre de un regalo): `sticker` = cualquiera del club de fans (la de siempre) y
// `sticker:<id>` = ese sticker en particular.
function stickerAlertKey(stickerId) {
    return stickerId ? `sticker:${stickerId}` : 'sticker';
}

// El id de sticker de una clave de alerta (o '' si es la general o no es de sticker).
function stickerIdFromKey(key) {
    const match = /^sticker:(\d{1,25})$/i.exec(String(key || ''));
    return match ? match[1] : '';
}

// Qué alertas dispara un comentario con estos stickers: la propia de cada sticker (hasta
// MAX_STICKER_ALERTS_PER_COMMENT en total) y, UNA sola vez, la de "cualquier sticker del club
// de fans" si alguno de los stickers del club no tiene la suya -- igual que un regalo con
// alerta propia no dispara además la general. Un sticker que no es del club solo dispara la suya.
function pickStickerAlerts(stickers, { findSpecific, generic }) {
    const picked = [];
    let unmatched = null;
    for (const sticker of (stickers || []).slice(0, MAX_STICKERS_LOOKED_AT)) {
        const alert = sticker.id ? findSpecific(sticker.id) : null;
        if (alert) {
            if (picked.length < MAX_STICKER_ALERTS_PER_COMMENT) picked.push({ alert, sticker });
        } else if (sticker.club && !unmatched) {
            unmatched = sticker;
        }
    }
    if (unmatched && generic && picked.length < MAX_STICKER_ALERTS_PER_COMMENT) picked.push({ alert: generic, sticker: unmatched });
    return picked;
}

// Recuerda cuándo un usuario mandó cada sticker por última vez. `allow` dice si este
// aviso cuenta (y lo anota): falso si el mismo usuario mandó el mismo sticker hace menos
// de la ventana. Acotado en tamaño: un directo largo no lo hace crecer sin fin.
function createStickerRepeatGuard({ windowMs = STICKER_REPEAT_WINDOW_MS, maxEntries = 500 } = {}) {
    const last = new Map();
    return {
        allow(userKey, stickerId, now = Date.now()) {
            const key = `${userKey}|${stickerId || '?'}`;
            const previous = last.get(key);
            if (previous !== undefined && now - previous < windowMs) return false;
            last.delete(key);
            last.set(key, now); // el orden del Map es el de la última vez: lo más viejo queda primero
            if (last.size > maxEntries) {
                for (const [oldKey, at] of last) {
                    if (last.size <= maxEntries && now - at < windowMs) break;
                    last.delete(oldKey);
                }
            }
            return true;
        },
    };
}

module.exports = {
    MAX_STICKER_ALERTS_PER_COMMENT,
    STICKER_REPEAT_WINDOW_MS,
    STICKER_TTS_WAIT_MAX_MS,
    isFanClubEmote,
    cleanStickerId,
    cleanImageUrl,
    stickerFromEmote,
    extractStickers,
    readableCommentText,
    stickerAlertKey,
    stickerIdFromKey,
    pickStickerAlerts,
    createStickerRepeatGuard,
};
