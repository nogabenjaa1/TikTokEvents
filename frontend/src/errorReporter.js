// Manda al servidor los errores que ocurren en el navegador del streamer (y en sus overlays de OBS) para que el
// admin los vea en Sistema > Errores. Los oyentes de eventos y el envío van aquí; qué se ignora y cómo se agrupan
// está en errorReportCore.js. Nunca manda la dirección completa de la página: los overlays llevan su token en la
// query, así que el contexto es solo la ruta o el nombre del overlay.
import { backendUrl, authHeaders, isOverlayMode, getOverlayScreen } from './auth';
import { createClientReporter, cspViolation } from './errorReportCore';

function currentContext() {
  try {
    return isOverlayMode() ? `overlay:${getOverlayScreen()}` : window.location.pathname;
  } catch {
    return '';
  }
}

// Un fallo al reportar (sin conexión, el servidor caído) se traga: reportar nunca debe romper ni ensuciar la página.
function post(path, body) {
  try {
    fetch(`${backendUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  } catch {
    // ignorado a propósito
  }
}

const origin = typeof window === 'undefined' ? '' : window.location.origin;
const errorReporter = createClientReporter({ send: (payload) => post('/api/client-errors', { ...payload, context: currentContext() }), origin });
const cspReporter = createClientReporter({ send: (payload, raw) => post('/api/csp-report', raw.body), origin });

// Para quien ya atrapó el error (por ejemplo AppErrorBoundary).
export function reportClientError(raw) {
  return errorReporter.report({ ...raw, context: currentContext() });
}

let installed = false;

export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // Un recurso que no carga (imagen, script) dispara este evento sin mensaje: eso no es un error del código.
    if (!event.message) return;
    errorReporter.report({
      kind: 'error', message: event.message, source: event.filename,
      stack: event.error?.stack || (event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : undefined),
      context: currentContext(),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    errorReporter.report({
      kind: 'promise', message: reason?.message || String(reason), stack: reason?.stack, context: currentContext(),
    });
  });

  // Cuando la página la sirve el propio servidor, el navegador reporta las violaciones de la política de seguridad
  // por su cuenta (report-uri): reenviarlas aquí las contaría dos veces. Solo hace falta si el sitio y el servidor
  // están en orígenes distintos (frontend en Vercel).
  let sameOrigin = true;
  try { sameOrigin = backendUrl() === window.location.origin; } catch { /* sin configuración: se asume que no hace falta */ }
  if (!sameOrigin) {
    window.addEventListener('securitypolicyviolation', (event) => {
      cspReporter.report(cspViolation(event, `${window.location.origin}${window.location.pathname}`));
    });
  }
}
