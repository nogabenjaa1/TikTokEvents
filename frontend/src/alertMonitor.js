// ¿Debe sonar la alerta también en el panel (esta pestaña del navegador)?
//
// Con el overlay abierto en OBS o TikTok Studio, la alerta ya suena ahí, y esa
// salida es la que sale al directo. Si además sonara la pestaña del panel, y el
// audio de la computadora también entra al directo, se oiría doble.
//   auto    (por defecto) el panel suena SOLO si no hay un overlay de alertas
//           conectado: sin OBS se oye en el navegador; con OBS, no se repite.
//   always  el panel siempre suena (para quien no capta el audio del navegador).
//   never   el panel nunca suena.
export const MONITOR_MODES = [
  { id: 'auto', label: 'Automático', hint: 'Suena aquí solo si no tienes el overlay de alertas abierto en OBS o TikTok Studio' },
  { id: 'always', label: 'Siempre', hint: 'Suena aquí aunque el overlay también esté abierto' },
  { id: 'never', label: 'Nunca', hint: 'No suena en este navegador' },
];
export const DEFAULT_MONITOR_MODE = 'auto';
const STORAGE_KEY = 'tkc_alert_monitor';
const SINK_KEY = 'tkc_alert_monitor_sink';

// Dispositivo de salida del sonido del panel (setSinkId): { id, label }. Vacío =
// el predeterminado del sistema.
export function loadMonitorSink(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const parsed = JSON.parse(storage?.getItem(SINK_KEY) || 'null');
    return parsed && typeof parsed.id === 'string' ? { id: parsed.id, label: String(parsed.label || '') } : { id: '', label: '' };
  } catch {
    return { id: '', label: '' };
  }
}

export function saveMonitorSink(sink, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(SINK_KEY, JSON.stringify({ id: String(sink?.id || ''), label: String(sink?.label || '') })); } catch { /* sin almacenamiento */ }
}

// Manda el sonido de un <audio>/<video> al dispositivo elegido. Si el navegador
// no lo soporta, o el dispositivo ya no existe, se queda en el predeterminado.
export function routeToSink(element, sinkId) {
  if (!element || !sinkId || typeof element.setSinkId !== 'function') return;
  element.setSinkId(sinkId).catch(() => { /* dispositivo no disponible: predeterminado */ });
}

export function shouldMonitorInPanel(mode, overlayConnected) {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return !overlayConnected;
}

export function loadMonitorMode(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return MONITOR_MODES.some((m) => m.id === saved) ? saved : DEFAULT_MONITOR_MODE;
  } catch {
    return DEFAULT_MONITOR_MODE;
  }
}

export function saveMonitorMode(mode, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!MONITOR_MODES.some((m) => m.id === mode)) return;
  try { storage?.setItem(STORAGE_KEY, mode); } catch { /* sin almacenamiento: dura solo esta sesión */ }
}
