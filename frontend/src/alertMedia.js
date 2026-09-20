// Ciclo de vida de los medios de una alerta (audio, video, imagen).
//
// La duración de la alerta manda sobre el recurso: si el audio o el video duran
// más, se cortan cuando la alerta termina; si duran menos, la alerta sigue
// hasta su tiempo. Quitar el elemento de la página no siempre basta para que
// deje de sonar (un <audio> suelto puede seguir hasta su fin natural), así que
// al terminar se detiene a mano y se suelta su fuente.

// Detiene un <audio>/<video> y lo deja sin fuente, sin lanzar nunca.
export function stopMedia(element) {
  if (!element) return;
  try {
    element.pause();
    element.removeAttribute('src');
    element.load();
  } catch { /* elemento ya liberado */ }
}

// Pide al navegador que vaya bajando los archivos de una alerta que todavía
// espera turno, para que cuando le toque no gaste su tiempo cargando: la
// duración cuenta desde que empieza, y un video de varios MB por red lenta se
// comería la mitad. Solo precarga (preload), no reproduce nada. Se guardan las
// referencias un rato para que el navegador no las suelte antes de terminar.
const preloaded = new Map();
const MAX_PRELOADED = 20;

export function preloadAlertMedia(alert, create = defaultCreate) {
  if (!alert) return;
  const jobs = [];
  if (alert.visualUrl && (alert.visualType === 'image' || alert.visualType === 'gif')) jobs.push(['image', alert.visualUrl]);
  if (alert.visualUrl && alert.visualType === 'video') jobs.push(['video', alert.visualUrl]);
  if (alert.audioUrl) jobs.push(['audio', alert.audioUrl]);
  for (const [kind, url] of jobs) {
    if (preloaded.has(url)) continue;
    try {
      const element = create(kind);
      if (!element) continue;
      if (kind !== 'image') element.preload = 'auto';
      element.src = url;
      preloaded.set(url, element);
      if (preloaded.size > MAX_PRELOADED) preloaded.delete(preloaded.keys().next().value);
    } catch { /* sin precarga: se carga al reproducir, como siempre */ }
  }
}

function defaultCreate(kind) {
  if (typeof document === 'undefined') return null;
  if (kind === 'image') return new Image();
  return document.createElement(kind);
}

export function clearPreloaded() {
  preloaded.clear();
}
