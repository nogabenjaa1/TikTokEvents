// Directorio de regalos vistos: cada regalo que TikTok entrega en cualquier
// directo (con su id, nombre, monedas e ícono) se guarda y se suma al catálogo.
//
// La lista de regalos que TikTok da sin sesión viene incompleta (no trae, por
// ejemplo, "Super GG"), pero un regalo que llega en un evento existe sí o sí y
// trae sus datos completos. Con este directorio, lo que reciba cualquier
// streamer queda para todos. Es global (no por licencia) a propósito: son datos
// del regalo, no de ninguna persona, y vienen del servidor, nunca de un cliente.
//
// Esta es la parte pura (recibe cómo leer y escribir), para probarla sin base de
// datos; lib/giftDirectory.js la conecta a la base real.

const MAX_GIFTS = 5000;
const MAX_NAME_LENGTH = 60;
const MAX_COINS = 9_999_999;
const MAX_ICON_LENGTH = 500;

// Un regalo recibido o guardado -> { id, name, coins, icon }, o null si no sirve.
// El id numérico es lo que lo identifica; sin él no se guarda.
function sanitizeGift(raw) {
    const id = Number(raw?.id ?? raw?.giftId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const name = String(raw?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return null;
    const coinsRaw = Math.trunc(Number(raw?.coins ?? raw?.diamondCount));
    const coins = Number.isFinite(coinsRaw) && coinsRaw >= 0 ? Math.min(coinsRaw, MAX_COINS) : 0;
    const iconRaw = raw?.icon ?? raw?.giftPictureUrl;
    const icon = typeof iconRaw === 'string' && /^https:\/\//i.test(iconRaw) && iconRaw.length <= MAX_ICON_LENGTH ? iconRaw : '';
    return { id, name, coins, icon };
}

function createGiftDirectory({ listRows, upsertRow, log = console }) {
    const cache = new Map();
    let loading = null;

    // Lee lo guardado una sola vez (y otra vez si falló).
    function load() {
        if (!loading) {
            loading = Promise.resolve()
                .then(() => listRows())
                .then((rows) => {
                    for (const row of rows || []) {
                        const gift = sanitizeGift({ id: row.gift_id, name: row.name, coins: row.coins, icon: row.icon });
                        if (gift) cache.set(gift.id, gift);
                    }
                })
                .catch((err) => {
                    loading = null;
                    log.error?.(`[Regalos] No se pudo leer el directorio de regalos vistos: ${err.message}`);
                });
        }
        return loading;
    }

    // Anota un regalo visto. Devuelve true si era nuevo o traía algo que faltaba
    // (y se guarda en segundo plano; un fallo al guardar nunca afecta al directo).
    function record(raw) {
        const gift = sanitizeGift(raw);
        if (!gift) return false;
        const previous = cache.get(gift.id);
        if (!previous && cache.size >= MAX_GIFTS) return false;
        const merged = { id: gift.id, name: gift.name, coins: gift.coins, icon: gift.icon || previous?.icon || '' };
        if (previous && previous.name === merged.name && previous.coins === merged.coins && previous.icon === merged.icon) return false;
        cache.set(gift.id, merged);
        Promise.resolve()
            .then(() => upsertRow(merged))
            .catch((err) => log.error?.(`[Regalos] No se pudo guardar el regalo ${merged.id} (${merged.name}): ${err.message}`));
        return true;
    }

    function list() {
        return [...cache.values()];
    }

    return { load, record, list };
}

module.exports = { createGiftDirectory, sanitizeGift, MAX_GIFTS };
