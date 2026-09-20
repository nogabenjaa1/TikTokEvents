// Ajustes del sonido en ESTE navegador (el panel).
//
// El panel reproduce todo el sonido (alertas, objetivo completado, efectos de
// los juegos) y el overlay de OBS es solo visual; ver overlayAudio.js. Como el
// directo capta el audio de la computadora, sale una sola vez. Aquí se guarda,
// por navegador: si el sonido está activado y por qué dispositivo sale.
const ENABLED_KEY = 'tkc_sound_enabled';
// Versión anterior (Automático / Siempre / Nunca): solo se lee para no perder
// que alguien lo había apagado.
const LEGACY_MODE_KEY = 'tkc_alert_monitor';
const SINK_KEY = 'tkc_alert_monitor_sink';

// Activado salvo que el streamer lo apague. Migra el "Nunca" de la versión anterior.
export function loadSoundEnabled(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const saved = storage?.getItem(ENABLED_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
    return storage?.getItem(LEGACY_MODE_KEY) !== 'never';
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* sin almacenamiento: dura solo esta sesión */ }
}

// Dispositivo de salida del sonido (setSinkId): { id, label }. Vacío = el
// predeterminado del sistema.
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
