// Qué canciones pedidas por !play siguen "pendientes" para el overlay, comparando nuestra lista contra lo que dice
// Spotify (GET /me/player/queue). Son funciones puras: reciben la lista y la lectura de Spotify, devuelven la lista nueva.
//
// Por qué no basta con "si Spotify no la muestra, se saca": la lectura de la cola tarda en reflejar lo que se acaba de
// agregar y, con muchas canciones en cola, solo trae las primeras (unas 20). Sacarla en cuanto una lectura no la traía
// hacía que el pedido apareciera un momento en el overlay, desapareciera a los pocos segundos y siguiera en la cola real
// de Spotify, así que los espectadores volvían a pedir la misma canción. La regla ahora: una canción que Spotify ACEPTÓ
// (el POST a la cola respondió bien) sigue en la lista hasta que haya pruebas de que ya se tocó o de que la cola dejó
// de existir.

// Spotify no devuelve más de unas 20 canciones por lectura: con tantas, las que faltan pueden estar más adelante.
const QUEUE_READ_LIMIT = 20;
// Lecturas seguidas sin verla, después de haberla visto en la cola o sonando: ya se tocó (o la quitaron). Se espera a
// la segunda por si una lectura suelta viene incompleta.
const MISSES_BEFORE_DROP = 2;
// Cuánto se espera a una canción aceptada que Spotify todavía no muestra ni en la cola ni sonando.
const UNSEEN_TTL_MS = 15 * 60 * 1000;
// Lecturas seguidas sin nada sonando ni en cola: la sesión de reproducción terminó y la cola ya no existe.
const EMPTY_READS_BEFORE_CLEAR = 3;

// Una misma canción puede llegar con dos direcciones: Spotify a veces reemplaza la pedida por otra versión disponible
// en el país de la cuenta y deja la original en `linked_from`.
const uriKeys = (track) => [track?.uri, track?.linked_from?.uri].filter(Boolean);

// La entrada de un pedido recién aceptado por Spotify. `seen` pasa a true la primera vez que Spotify la muestra.
function createSpotifyRequest({ id, track, username, now = Date.now() }) {
    return {
        id,
        uri: track.uri,
        title: track.name,
        artist: (track.artists || []).map((a) => a.name).join(', '),
        albumArt: track.album?.images?.[track.album.images.length - 1]?.url || '',
        requestedBy: username,
        playing: false,
        addedAt: now,
        seen: false,
        misses: 0,
    };
}

// Lo que sale hacia el overlay y el panel: sin los campos internos de seguimiento.
const publicSpotifyRequest = ({ id, uri, title, artist, albumArt, requestedBy, playing }) => (
    { id, uri, title, artist, albumArt, requestedBy, playing: !!playing }
);

// `requests`: nuestra lista, del pedido más viejo al más nuevo (en la cola de Spotify sale primero lo que se pidió
// primero). `live`: la respuesta de GET /me/player/queue. `emptyReads`: cuántas lecturas seguidas vinieron vacías.
// Devuelve { requests, emptyReads, dropped, currentRequest }: la lista nueva (sin tocar la anterior), las que salieron
// con su motivo (para el registro) y el pedido que suena ahora mismo, si es uno de los nuestros.
function reconcileSpotifyRequests(requests, live, { now = Date.now(), emptyReads = 0 } = {}) {
    const list = Array.isArray(requests) ? requests : [];
    // Una respuesta que no se puede leer no dice nada de la cola: la lista queda como estaba.
    if (!live || typeof live !== 'object') {
        return { requests: list.map((request) => ({ ...request })), emptyReads, dropped: [], currentRequest: null };
    }

    const current = live.currently_playing || null;
    const upcoming = Array.isArray(live.queue) ? live.queue : [];

    const nothingThere = !current && upcoming.length === 0;
    const nextEmptyReads = nothingThere ? emptyReads + 1 : 0;
    if (nextEmptyReads >= EMPTY_READS_BEFORE_CLEAR) {
        return {
            requests: [], emptyReads: nextEmptyReads, currentRequest: null,
            dropped: list.map((request) => ({ request, reason: 'ya no hay nada sonando ni en la cola de Spotify' })),
        };
    }
    // Una lectura vacía es ambigua (Spotify también la devuelve unos segundos al cambiar de dispositivo): hasta que se
    // repita varias veces seguidas no dice nada de ninguna canción en particular.
    if (nothingThere) {
        return {
            requests: list.map((request) => ({ ...request, addedAt: Number.isFinite(request.addedAt) ? request.addedAt : now })),
            emptyReads: nextEmptyReads, dropped: [], currentRequest: null,
        };
    }

    const currentKeys = new Set(uriKeys(current));
    // Cuántas veces aparece cada canción en la cola real: la misma puede estar pedida varias veces.
    const available = new Map();
    for (const track of upcoming) {
        for (const key of new Set(uriKeys(track))) available.set(key, (available.get(key) || 0) + 1);
    }
    const truncated = upcoming.length >= QUEUE_READ_LIMIT;

    const kept = [];
    const dropped = [];
    let currentRequest = null;

    for (const request of list) {
        const addedAt = Number.isFinite(request.addedAt) ? request.addedAt : now; // una cola restaurada de antes no la trae

        if (!currentRequest && currentKeys.has(request.uri)) {
            currentRequest = { ...request, addedAt, seen: true, misses: 0, playing: true };
            kept.push(currentRequest);
            continue;
        }

        const left = available.get(request.uri) || 0;
        if (left > 0) {
            available.set(request.uri, left - 1);
            kept.push({ ...request, addedAt, seen: true, misses: 0, playing: false });
            continue;
        }

        // Spotify no la muestra en esta lectura.
        if (request.seen) {
            const misses = (request.misses || 0) + 1;
            // `playing` no se toca: una canción que acaba de terminar no debe reaparecer un momento entre las siguientes.
            if (misses < MISSES_BEFORE_DROP) kept.push({ ...request, addedAt, misses });
            else dropped.push({ request, reason: 'ya se tocó o la quitaron de la cola de Spotify' });
            continue;
        }
        if (truncated || now - addedAt < UNSEEN_TTL_MS) kept.push({ ...request, addedAt, seen: false, misses: 0 });
        else dropped.push({ request, reason: 'Spotify nunca la mostró en su cola' });
    }

    return { requests: kept, emptyReads: nextEmptyReads, dropped, currentRequest };
}

module.exports = {
    createSpotifyRequest, publicSpotifyRequest, reconcileSpotifyRequests,
    QUEUE_READ_LIMIT, MISSES_BEFORE_DROP, UNSEEN_TTL_MS, EMPTY_READS_BEFORE_CLEAR,
};
