// Lógica pura del reporte de errores del navegador (sin DOM ni red): qué se ignora, cómo se agrupa y cuántos se
// mandan. Los oyentes de eventos y el envío están en errorReporter.js; el servidor limpia y agrupa de nuevo lo que
// llega (ver backend/lib/errorReports.js), así que esto solo evita mandar ruido y ráfagas.

export const MAX_REPORTS_PER_PAGE = 20; // por carga de página: un error en bucle no puede inundar al servidor
export const DEDUPE_MS = 60 * 1000;     // el mismo error, como mucho una vez por minuto
const MAX_MESSAGE = 300;
const MAX_STACK = 2000;

// Errores que no dicen nada del código de este sitio: el navegador oculta el detalle de los scripts de otro origen
// ("Script error."), un aviso de ResizeObserver que es inofensivo y los fallos de red del propio visitante
// (sin conexión, un bloqueador de anuncios).
const NOISE = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/i,
  /\bAbortError\b/i,
];

export function isNoise({ message, source, stack, origin }) {
  const text = String(message ?? '');
  if (!text.trim()) return true;
  if (NOISE.some((pattern) => pattern.test(text))) return true;
  // Extensiones del navegador y scripts de terceros (anuncios, pagos): no es código nuestro.
  const where = `${source || ''}\n${stack || ''}`;
  if (/(?:chrome|moz|safari-web)-extension:\/\//i.test(where)) return true;
  if (source && origin && /^https?:\/\//i.test(source) && !source.startsWith(origin)) return true;
  return false;
}

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? value.slice(0, max) : value;
};

function firstFrame(stack) {
  const line = String(stack || '').split('\n').find((l) => /:\d+/.test(l));
  return line ? line.trim().replace(/[?#][^:)]*/g, '') : '';
}

// Dos errores son "el mismo" si tienen el mismo tipo, mensaje y punto del código donde ocurrieron.
export function fingerprint(raw) {
  return `${raw.kind}|${clip(raw.message, MAX_MESSAGE)}|${firstFrame(raw.stack)}`;
}

// `send(payload, raw)` hace el envío de verdad; aquí solo se decide si se manda. Un error DENTRO del propio reporte
// (o del envío) no genera otro reporte: `busy` corta el bucle.
export function createClientReporter({ send, now = Date.now, max = MAX_REPORTS_PER_PAGE, dedupeMs = DEDUPE_MS, origin = '' }) {
  const seen = new Map(); // huella -> cuándo se mandó por última vez
  let sent = 0;
  let suppressed = 0;
  let busy = false;

  function report(raw) {
    if (busy) return false;
    busy = true;
    try {
      if (!raw || typeof raw !== 'object' || isNoise({ ...raw, origin })) { suppressed++; return false; }
      if (sent >= max) { suppressed++; return false; }
      const key = fingerprint(raw);
      const t = now();
      const last = seen.get(key);
      if (last !== undefined && t - last < dedupeMs) { suppressed++; return false; }
      seen.set(key, t);
      if (seen.size > 100) seen.delete(seen.keys().next().value);
      sent++;
      send({
        kind: raw.kind, message: clip(raw.message, MAX_MESSAGE), stack: raw.stack ? clip(raw.stack, MAX_STACK) : undefined, context: raw.context,
      }, raw);
      return true;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  }

  return { report, stats: () => ({ sent, suppressed }) };
}

function hostOf(value) {
  try { return new URL(value).host || value; } catch { return value; }
}

// Una violación de la política de seguridad de contenido (evento `securitypolicyviolation`) se manda al servidor
// con el mismo formato que usa el navegador cuando la política trae `report-uri` (ver backend/lib/errorReports.js).
// Sirve cuando el sitio se sirve desde otro origen que el servidor (por ejemplo desde Vercel), donde el navegador
// no sabe a dónde reportar por su cuenta.
export function cspViolation(event, documentUri) {
  const directive = event.effectiveDirective || event.violatedDirective || 'una directiva';
  const blocked = event.blockedURI || 'un recurso';
  const enforced = event.disposition === 'enforce';
  return {
    kind: 'csp',
    message: `${directive} ${enforced ? 'bloqueó' : 'habría bloqueado'} ${blocked === 'inline' || blocked === 'eval' ? blocked : hostOf(blocked)}`,
    stack: event.sourceFile ? `at ${event.sourceFile}${event.lineNumber ? `:${event.lineNumber}` : ''}` : undefined,
    body: {
      'csp-report': {
        'effective-directive': directive,
        'blocked-uri': blocked,
        'document-uri': documentUri,
        'source-file': event.sourceFile || '',
        'line-number': event.lineNumber || 0,
        disposition: enforced ? 'enforce' : 'report',
      },
    },
  };
}
