// Freno a las conexiones de socket NUEVAS por IP. Cada intento de conexión,
// aunque traiga una clave falsa, cuesta una consulta a la base de datos; sin
// límite, una sola máquina puede inundarla. Solo cuenta las conexiones que
// empiezan (no las peticiones de una conexión ya abierta), así que un panel u
// overlay normal, que abre una sola, jamás se acerca al tope.

function createHandshakeLimiter({ windowMs = 60 * 1000, max = 300, maxTracked = 20000, now = Date.now } = {}) {
    const hits = new Map(); // ip -> { count, resetAt }

    function sweep(at = now()) {
        for (const [ip, entry] of hits) {
            if (entry.resetAt <= at) hits.delete(ip);
        }
    }

    function allow(ip) {
        const at = now();
        let entry = hits.get(ip);
        if (!entry || entry.resetAt <= at) {
            entry = { count: 0, resetAt: at + windowMs };
            hits.set(ip, entry);
        }
        entry.count++;
        // Una lista que crece sin límite sería otra forma de tumbar el servidor.
        if (hits.size > maxTracked) sweep(at);
        return entry.count <= max;
    }

    return { allow, sweep, size: () => hits.size };
}

// La IP del cliente detrás de UN proxy de confianza (Render): la última entrada
// de X-Forwarded-For, igual que `app.set('trust proxy', 1)` de Express. Las
// anteriores las puede escribir el propio cliente para hacerse pasar por otro.
function clientIp(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
    return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket?.remoteAddress || 'unknown');
}

// Una conexión de Socket.IO empieza sin `sid`; todo lo que sigue (los sondeos
// de una conexión ya abierta, el salto a WebSocket) lo lleva.
function isNewSession(req) {
    if (req.method === 'OPTIONS') return false; // la consulta previa de CORS no es una conexión
    try {
        return !new URL(req.url, 'http://localhost').searchParams.has('sid');
    } catch {
        return true;
    }
}

module.exports = { createHandshakeLimiter, clientIp, isNewSession };
