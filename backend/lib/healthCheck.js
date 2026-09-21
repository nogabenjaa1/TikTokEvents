// Comprobación de salud "profunda" (GET /health/deep): además de que el proceso
// responde, verifica que la base de datos contesta. Va aparte de /health a
// propósito: Render usa /health para decidir si REINICIA el servicio, y un
// bache de la base de datos no debe tumbar a todos los streamers en directo.
// /health/deep es para un monitor externo (UptimeRobot, etc.) que avise cuando
// la base se cae. Guarda el resultado unos segundos para que varios monitores no
// martilleen la base, y comparte la comprobación en curso si llegan a la vez.

function createHealthChecker({ ping, timeoutMs = 2000, cacheMs = 5000, now = Date.now }) {
    let cached = null;
    let inflight = null;

    async function run() {
        const started = now();
        let timer;
        try {
            await Promise.race([
                ping(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
            ]);
            return { ok: true, db: { ok: true, latencyMs: now() - started }, checkedAt: now() };
        } catch (err) {
            // El detalle real (que puede traer el nombre del servidor) queda en el
            // registro; a quien pregunta solo se le dice qué pasó, en general.
            console.error('[Salud] La base de datos no respondió:', err.message);
            return {
                ok: false,
                db: { ok: false, latencyMs: now() - started, reason: err.message === 'timeout' ? 'tiempo de espera agotado' : 'sin conexión' },
                checkedAt: now(),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async function check() {
        if (cached && now() - cached.checkedAt < cacheMs) return cached;
        if (!inflight) {
            inflight = run().then((result) => { cached = result; return result; }).finally(() => { inflight = null; });
        }
        return inflight;
    }

    return { check };
}

module.exports = { createHealthChecker };
