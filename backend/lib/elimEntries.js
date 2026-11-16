// Edición a mano de las entradas de Eliminación desde el panel: quitar,
// fijar cuántas tiene alguien y combinar dos participantes. Funciones puras
// sobre el arreglo de slots (`elimState.participants`), sin sockets ni
// timers, para poder probarlas solas (ver elim-entries.test.js).
//
// Cada slot es una entrada: { id, username, avatar, source }. `source` es
// 'gift' (llegó por monedas) o 'manual' (la agregó el streamer). Los slots
// guardados antes de que existiera el campo no lo tienen y cuentan como
// regalo.

const MAX_USERNAME = 50;
// Mismo tope que ya tenía la entrada manual (elim_add_manual_entry).
const MAX_ENTRIES_PER_ACTION = 1000;
// Tope de los ajustes de la fase final (ver roundEliminationCount).
const MAX_ROUND_SETTING = 100000;

function normalizeUsername(raw) {
    return typeof raw === 'string' ? raw.trim().replace(/^@+/, '').trim().slice(0, MAX_USERNAME) : '';
}

function clampCount(raw, min, max = MAX_ENTRIES_PER_ACTION) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
}

// El @usuario de TikTok no distingue mayúsculas: "Ana" y "ana" son la misma
// persona. Devuelve el nombre tal como ya está en la lista, o null.
function findParticipantName(pool, name) {
    const wanted = normalizeUsername(name).toLowerCase();
    if (!wanted) return null;
    const slot = pool.find(p => p.username.toLowerCase() === wanted);
    return slot ? slot.username : null;
}

function slotsOf(pool, username) {
    return pool.filter(p => p.username === username);
}

function sourceOf(slot) {
    return slot.source === 'manual' ? 'manual' : 'gift';
}

// Saca del arreglo, en su lugar, los slots que cumplen `predicate`.
function removeWhere(pool, predicate) {
    let removed = 0;
    for (let i = pool.length - 1; i >= 0; i--) {
        if (predicate(pool[i])) { pool.splice(i, 1); removed += 1; }
    }
    return removed;
}

// Mete cada slot nuevo en una posición al azar de la lista (pedido
// explícito): así las 200 entradas de una misma persona quedan repartidas
// por todo el overlay en vez de en un bloque, y se ve que el sorteo es al
// azar. Solo cambia dónde se dibujan: el sorteo ya mezclaba la lista entera
// (ver pickEliminationBatch) y el orden de llegada sigue en el `id`.
function insertSlotsRandomly(pool, slots, random = Math.random) {
    for (const slot of slots) pool.splice(Math.floor(random() * (pool.length + 1)), 0, slot);
}

function pushSlots(pool, { username, avatar, count, source, nextId }) {
    const slots = [];
    for (let i = 0; i < count; i++) slots.push({ id: nextId(), username, avatar, source });
    insertSlotsRandomly(pool, slots);
}

// Cuántas entradas caen en esta ronda. `perRound` es lo normal; con una fase
// final (`finalAt` > 0, pedido explícito: "de 100 en 100 hasta que queden 15
// y de ahí de 1 en 1"), mientras haya más de `finalAt` entradas una ronda
// nunca baja de `finalAt`, y desde ahí caen `finalPerRound` por ronda. Se
// cuenta en entradas (lo que elimina el sorteo), no en jugadores.
function roundEliminationCount(totalSlots, { perRound, finalAt, finalPerRound }) {
    const normal = Math.max(1, Math.round(Number(perRound)) || 1);
    const at = Math.max(0, Math.round(Number(finalAt)) || 0);
    if (!at) return normal;
    if (totalSlots > at) return Math.max(1, Math.min(normal, totalSlots - at));
    return Math.max(1, Math.round(Number(finalPerRound)) || 1);
}

// Deja a `username` con exactamente `count` entradas. Si sube, las nuevas son
// manuales con la misma foto que ya tiene; si baja, se quitan primero las
// más recientes (sean de regalo o manuales); 0 lo saca de la lista.
function setEntries(pool, { username, count, nextId }) {
    const name = findParticipantName(pool, username);
    if (!name) return { ok: false, error: 'Ese usuario no está en la lista.' };
    const target = clampCount(count, 0);
    if (target === null) return { ok: false, error: 'Escribe un número de entradas válido.' };
    const mine = slotsOf(pool, name);
    const current = mine.length;
    if (target > current) {
        pushSlots(pool, { username: name, avatar: mine[0].avatar, count: target - current, source: 'manual', nextId });
    } else if (target < current) {
        const drop = new Set(mine.sort((a, b) => b.id - a.id).slice(0, current - target).map(p => p.id));
        removeWhere(pool, p => drop.has(p.id));
    }
    return { ok: true, username: name, before: current, after: target };
}

// Combina las entradas de `a` y `b`.
// - target 'a' o 'b': las del otro pasan al elegido (con su foto) y el otro
//   sale de la lista. Cada entrada conserva su id (su orden de llegada) y si
//   fue de regalo o manual.
// - target 'custom': las dos salen de la lista y `customUsername` recibe la
//   suma como entradas manuales. Si ese nombre es uno de los dos, cuenta como
//   elegirlo; si ya es OTRO participante, se le suman a él (así nunca queda
//   alguien repetido en la lista).
// `avatarFor(username)` da la foto para un nombre que no está en la lista
// (la de TikTok si mandó algún regalo, si no una por defecto).
function mergeParticipants(pool, { a, b, target, customUsername, avatarFor, nextId }) {
    const nameA = findParticipantName(pool, a);
    const nameB = findParticipantName(pool, b);
    if (!nameA || !nameB) return { ok: false, error: 'Los dos participantes tienen que estar en la lista.' };
    if (nameA === nameB) return { ok: false, error: 'Elige dos participantes distintos.' };

    let keep = target === 'a' ? nameA : target === 'b' ? nameB : null;
    let custom = null;
    if (target === 'custom') {
        custom = normalizeUsername(customUsername);
        if (!custom) return { ok: false, error: 'Escribe el usuario que recibirá las entradas.' };
        const existing = findParticipantName(pool, custom);
        if (existing) { keep = existing; custom = null; }
    } else if (!keep) {
        return { ok: false, error: 'Elige a quién se le quedan las entradas.' };
    }

    const total = slotsOf(pool, nameA).length + slotsOf(pool, nameB).length;
    if (keep) {
        const avatar = slotsOf(pool, keep)[0].avatar;
        for (const slot of pool) {
            if ((slot.username === nameA || slot.username === nameB) && slot.username !== keep) {
                slot.username = keep;
                slot.avatar = avatar;
                slot.source = sourceOf(slot);
            }
        }
        return { ok: true, username: keep, total: slotsOf(pool, keep).length, merged: total };
    }

    removeWhere(pool, p => p.username === nameA || p.username === nameB);
    pushSlots(pool, { username: custom, avatar: avatarFor(custom), count: total, source: 'manual', nextId });
    return { ok: true, username: custom, total, merged: total };
}

// Formato compacto de la lista para mandarla por socket. Antes cada entrada
// viajaba con su propia URL de foto (~400 bytes): con 1000 entradas eran
// ~364 KB por actualización, por el mismo socket que los comentarios del TTS
// (que llegaban tarde detrás de cada ráfaga de regalos). Ahora cada foto va
// una sola vez por jugador: `players` = [{ username, avatar }] y `slots` =
// [[id, índice en players, 1 si es manual]], en el mismo orden de la lista.
// El panel y los overlays la vuelven a armar (ver frontend/src/elimPacking.js).
function packElimParticipants(pool) {
    const players = [];
    const index = new Map();
    const slots = [];
    for (const slot of pool) {
        let i = index.get(slot.username);
        if (i === undefined) {
            i = players.length;
            index.set(slot.username, i);
            players.push({ username: slot.username, avatar: slot.avatar });
        }
        slots.push([slot.id, i, slot.source === 'manual' ? 1 : 0]);
    }
    return { players, slots };
}

module.exports = {
    MAX_ENTRIES_PER_ACTION,
    MAX_ROUND_SETTING,
    normalizeUsername,
    clampCount,
    findParticipantName,
    setEntries,
    mergeParticipants,
    insertSlotsRandomly,
    packElimParticipants,
    roundEliminationCount,
};
