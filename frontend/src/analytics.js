// Analítica propia, sin cookies (ver backend/lib/analytics.js): una visita
// por página que se abre. No manda nada si el navegador pide no ser rastreado,
// ni desde el overlay de OBS (no es una visita).
import { backendUrl } from './auth';

let lastPath = null;
let firstSent = false;

export function trackPageview(path) {
  if (typeof navigator === 'undefined' || path === lastPath) return;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  lastPath = path;
  // El sitio de donde se llegó solo cuenta en la primera página de la visita.
  const external = document.referrer && !document.referrer.startsWith(window.location.origin);
  const referrer = !firstSent && external ? document.referrer : '';
  firstSent = true;
  try {
    fetch(`${backendUrl()}/api/analytics/pageview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, referrer }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* la analítica nunca debe afectar al panel */ }
}
