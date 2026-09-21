// Catálogo de stickers del club de fans de UNA licencia: cada sticker que llega en el
// chat de su directo se guarda (id e imagen) para poder elegirlo al armar una alerta.
//
// A diferencia de los regalos (giftDirectoryCore.js), que son los mismos para todos y
// se pueden bajar de TikTok, los stickers son de cada creador y TikTok no da su lista:
// solo se conocen los que alguien ya envió. Por eso es por licencia, y se llena solo
// durante los directos (el panel se entera al momento con `sticker_seen`).
//
// Parte pura (recibe cómo leer y escribir), para probarla sin base de datos; el
// Tenant la conecta a la base real (ver lib/tenant/stickers.js).
const { cleanStickerId, cleanImageUrl } = require('./stickerCatalog');

// Tope por licencia: un club de fans tiene decenas de stickers, no miles.
const MAX_STICKERS = 300;

// Un sticker recibido o guardado -> { id, imageUrl }, o null si no sirve. Sin id
// numérico no se guarda (no habría forma de reconocerlo después).
function sanitizeSticker(raw) {
    const id = cleanStickerId(raw?.id ?? raw?.emoteId ?? raw?.emote_id);
    if (!id) return null;
    return { id, imageUrl: cleanImageUrl(raw?.imageUrl ?? raw?.image_url ?? '') };
}

function createStickerDirectory({ listRows, upsertRow, log = console }) {
    const cache = new Map();
    // Stickers cuya imagen ya se confirmó en esta ejecución: las direcciones de imagen de
    // TikTok pueden cambiar, así que la primera vez que se ve uno tras arrancar se
    // actualiza; el resto de las veces no se toca la base.
    const refreshed = new Set();
    let loading = null;

    // Lee lo guardado una sola vez (y otra vez si falló).
    function load() {
        if (!loading) {
            loading = Promise.resolve()
                .then(() => listRows())
                .then((rows) => {
                    for (const row of rows || []) {
                        const sticker = sanitizeSticker(row);
                        if (sticker && !cache.has(sticker.id)) cache.set(sticker.id, sticker);
                    }
                })
                .catch((err) => {
                    loading = null;
                    log.error?.(`[Stickers] No se pudo leer el catálogo de stickers: ${err.message}`);
                });
        }
        return loading;
    }

    function save(sticker) {
        Promise.resolve()
            .then(() => upsertRow(sticker))
            .catch((err) => log.error?.(`[Stickers] No se pudo guardar el sticker ${sticker.id}: ${err.message}`));
    }

    // Anota un sticker visto. Devuelve true si era nuevo o trajo una imagen distinta (el
    // panel tiene que enterarse); un fallo al guardar nunca afecta al directo.
    function record(raw) {
        const sticker = sanitizeSticker(raw);
        if (!sticker) return false;
        const previous = cache.get(sticker.id);
        if (!previous) {
            if (cache.size >= MAX_STICKERS) return false;
            cache.set(sticker.id, sticker);
            if (sticker.imageUrl) refreshed.add(sticker.id);
            save(sticker);
            return true;
        }
        if (!sticker.imageUrl || sticker.imageUrl === previous.imageUrl) {
            if (sticker.imageUrl) refreshed.add(sticker.id);
            return false;
        }
        if (previous.imageUrl && refreshed.has(sticker.id)) return false;
        refreshed.add(sticker.id);
        cache.set(sticker.id, sticker);
        save(sticker);
        return true;
    }

    function list() {
        return [...cache.values()];
    }

    return { load, record, list };
}

module.exports = { createStickerDirectory, sanitizeSticker, MAX_STICKERS };
