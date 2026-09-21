// Cuándo un overlay que falló al dibujarse puede recargarse solo. Un overlay
// roto es peor que uno vacío (se ve en el directo), y recargar casi siempre lo
// arregla; pero si el error es fijo, recargar sin freno lo dejaría en un bucle.
// Por eso se cuentan las recargas de la última ventana: pasado el tope se queda
// quieto hasta que pase el minuto.

export const OVERLAY_RELOAD_DELAY_MS = 5000;
// Si no hay dónde recordar las recargas no se puede contar, así que se espera más.
export const OVERLAY_RELOAD_DELAY_UNCOUNTED_MS = 30000;
export const OVERLAY_MAX_RELOADS = 3;
export const OVERLAY_RELOAD_WINDOW_MS = 60 * 1000;

function parseState(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// `raw`: lo que se guardó la vez anterior (texto JSON) o null.
// Devuelve { allowed, state }: `state` es el texto a guardar.
export function nextReloadState(raw, now = Date.now()) {
  const previous = parseState(raw);
  const valid = previous && Number.isFinite(previous.count) && Number.isFinite(previous.since) && now >= previous.since;
  const current = valid && now - previous.since <= OVERLAY_RELOAD_WINDOW_MS ? previous : { count: 0, since: now };
  if (current.count >= OVERLAY_MAX_RELOADS) return { allowed: false, state: JSON.stringify(current) };
  return { allowed: true, state: JSON.stringify({ count: current.count + 1, since: current.since }) };
}
