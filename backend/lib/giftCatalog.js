// Catálogo de regalos de un LIVE, armado a partir de varias fuentes. Ninguna
// es completa por sí sola:
//   - la lista genérica de TikTok (gift/list sin sala) no trae los regalos
//     nuevos ni los regionales;
//   - la lista de la sala (con room_id) es más fiel, pero puede fallar;
//   - los regalos que ya llegaron en este directo son los que sin duda existen.
// Se unen las tres y se quita lo repetido. Funciones puras, sin red.

// Un regalo crudo de la API de TikTok (`diamond_count`, `image.url_list`...) o
// uno ya normalizado ({ id, name, coins, icon }) -> { id, name, coins, icon }.
// Devuelve null si no tiene nombre (sin nombre no se puede elegir ni asignar).
function normalizeGift(gift) {
    if (!gift || typeof gift !== 'object') return null;
    const name = String(gift.name ?? '').trim();
    if (!name) return null;
    const icon = typeof gift.icon === 'string'
        ? gift.icon
        : gift.image?.url_list?.[0] || gift.icon?.url_list?.[0] || gift.image?.urlList?.[0] || gift.giftPictureUrl || '';
    const coins = Number(gift.coins ?? gift.diamond_count ?? gift.diamondCount ?? 0);
    const id = gift.id ?? gift.giftId ?? null;
    return { id, name, coins: Number.isFinite(coins) ? coins : 0, icon: typeof icon === 'string' ? icon : '' };
}

// Los nombres se comparan sin mayúsculas, acentos ni espacios de más: una
// alerta guarda el nombre tal como lo mostró el selector y el evento en vivo
// puede traerlo con otra capitalización.
function giftNameKey(name) {
    return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Une varias listas. Si un regalo está en más de una, se queda el que tiene
// icono y monedas; el orden es por monedas y luego por nombre.
function mergeGiftCatalogs(...lists) {
    const byKey = new Map();
    for (const list of lists) {
        for (const raw of Array.isArray(list) ? list : []) {
            const gift = normalizeGift(raw);
            if (!gift) continue;
            const key = giftNameKey(gift.name);
            const current = byKey.get(key);
            if (!current) { byKey.set(key, gift); continue; }
            byKey.set(key, {
                id: current.id ?? gift.id,
                name: current.name,
                coins: current.coins || gift.coins,
                icon: current.icon || gift.icon,
            });
        }
    }
    return [...byKey.values()].sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name));
}

module.exports = { normalizeGift, giftNameKey, mergeGiftCatalogs };
