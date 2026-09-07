import React, { useState, useEffect, useMemo, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';
import { AlertVisual, ANIM_DURATION_MS } from './Overlay';

const POSITIONS = [
  { id: 'center', label: 'Centro' },
  { id: 'top', label: 'Arriba' },
  { id: 'bottom', label: 'Abajo' },
  { id: 'left', label: 'Izquierda' },
  { id: 'right', label: 'Derecha' },
];

// Mismas listas que ENTRANCE_ANIMS/EXIT_ANIMS en server.js — 'bounce' es
// exclusivo de entrada (ver comentario ahí). 'none' = sin animación,
// aparece/desaparece de golpe.
const ANIMATION_IN_OPTIONS = [
  { id: 'none', label: 'Ninguna' },
  { id: 'fade', label: 'Fundido' },
  { id: 'slide-up', label: 'Desde abajo' },
  { id: 'slide-down', label: 'Desde arriba' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'bounce', label: 'Rebote' },
];
const ANIMATION_OUT_OPTIONS = [
  { id: 'none', label: 'Ninguna' },
  { id: 'fade', label: 'Fundido' },
  { id: 'slide-up', label: 'Hacia arriba' },
  { id: 'slide-down', label: 'Hacia abajo' },
  { id: 'zoom', label: 'Zoom' },
];

const MEDIA_TYPE_ICON = { image: '🖼️', gif: '🎞️', video: '🎬', audio: '🎧' };

// Mismo límite que ya aplica el backend (ver server.js) y el propio
// AlertOverlay (ALERT_MAX_DURATION_MS en Overlay.jsx) — el slider de acá
// no deja pasarse, así que nunca se guarda algo que el overlay vaya a
// recortar de todos modos.
const MAX_DURATION_S = 15;

// Deduce el "tipo" de un archivo elegido en el <input type="file"> con el
// mismo criterio que ALERT_MEDIA_TYPES en server.js — para la vista previa
// en vivo (ver LivePreview más abajo), que corre 100% en el cliente antes
// de subir nada.
function fileMediaType(file) {
  if (!file) return null;
  if (file.type === 'image/gif') return 'gif';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

// Tamaño "de escenario" con el que se arma la vista previa en vivo — no es
// el tamaño real de nada, solo una superficie oscura chica que simula la
// escena del streamer, mismo criterio de escalado que OverlayPreviewBox.jsx
// (outer div recortado al tamaño final, inner div a tamaño natural con
// `transform: scale()`).
const STAGE_W = 960;
const STAGE_H = 540;
const STAGE_SCALE = 0.32;

// Vista previa en vivo: se actualiza SOLA en cuanto cambia el archivo, la
// duración, la posición o las animaciones — pedido explícito de que no
// haga falta un botón de "Preview" para verla. Corre en bucle (entering ->
// visible -> exiting -> una pausa corta -> de nuevo) mientras el panel
// esté abierto, así el streamer puede quedarse mirando el ciclo completo
// de entrada/salida las veces que haga falta mientras prueba distintas
// combinaciones. `cycle` es lo que fuerza cada vuelta nueva del bucle: no
// se puede reusar `draftAlert` como dependencia para reiniciar el timer
// del final del ciclo porque esa MISMA referencia no cambia entre una
// vuelta y la siguiente.
function LivePreview({ draftAlert }) {
  const [phase, setPhase] = useState('entering');
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!draftAlert) return;
    setPhase('entering');
    const duration = Math.min(MAX_DURATION_S * 1000, Math.max(500, draftAlert.durationMs || 5000));
    const LOOP_PAUSE_MS = 600;
    const timers = [
      setTimeout(() => setPhase('visible'), ANIM_DURATION_MS),
      setTimeout(() => setPhase('exiting'), Math.max(ANIM_DURATION_MS, duration - ANIM_DURATION_MS)),
      setTimeout(() => setCycle((c) => c + 1), duration + LOOP_PAUSE_MS),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAlert, cycle]);

  return (
    <div className="rounded-xl overflow-hidden mx-auto" style={{ width: STAGE_W * STAGE_SCALE, height: STAGE_H * STAGE_SCALE, background: 'repeating-conic-gradient(#1a1625 0% 25%, #150f22 0% 50%) 0 0/24px 24px' }}>
      <div className="relative" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${STAGE_SCALE})`, transformOrigin: 'top left' }}>
        {draftAlert ? (
          <AlertVisual alert={draftAlert} phase={phase} embedded />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-gray-500 text-sm italic" style={{ transform: `scale(${1 / STAGE_SCALE})` }}>Elige un archivo para ver la vista previa</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ALERTAS DE REGALOS — panel de administración
// Cada regalo puede tener a lo sumo UNA alerta asignada (imagen/gif/video/
// audio). El archivo se sube directo a Supabase Storage (ver
// backend/storage.js) — acá solo se arma el formulario y se manda por
// multipart/form-data; nunca pasa por localStorage ni por el socket
// (subir un archivo grande por socket.io sería mucho más frágil que un
// POST normal con su propio manejo de progreso/errores).
// El DISPARO en vivo de la alerta (cuando llega el regalo de verdad) sí va
// por socket — ver AlertOverlay en Overlay.jsx / alert_triggered en
// tenant.js —, esto de acá es solo la configuración.
// ─────────────────────────────────────────────
export default function AlertsAdmin({ giftsList }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGift, setSelectedGift] = useState(null);
  const [isDropOpen, setIsDropOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(5);
  const [position, setPosition] = useState('center');
  const [entranceAnim, setEntranceAnim] = useState('fade');
  const [exitAnim, setExitAnim] = useState('fade');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // URL de blob del archivo elegido, para la vista previa en vivo — se
  // crea/revoca en el mismo efecto atado a `file` (React garantiza que el
  // cleanup de la vuelta anterior corre ANTES del cuerpo de la vuelta
  // nueva), así nunca se revoca por accidente la URL que se acaba de crear
  // para el archivo actual. Bug real que tenía la versión anterior de este
  // archivo (botón "Vista previa" con el ícono roto del navegador): el
  // `previewObjectUrl.current` se pisaba y revocaba desde dos lugares
  // distintos en el orden equivocado, así que la imagen que se llegaba a
  // mostrar ya apuntaba a un blob recién revocado.
  const [fileUrl, setFileUrl] = useState(null);
  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const draftAlert = useMemo(() => {
    const mediaType = fileMediaType(file);
    if (!fileUrl || !mediaType) return null;
    return { mediaUrl: fileUrl, mediaType, durationMs: Math.round(duration * 1000), position, entranceAnim, exitAnim };
  }, [fileUrl, file, duration, position, entranceAnim, exitAnim]);

  // Vista previa de una alerta YA GUARDADA (botón "👁️" de la lista de
  // abajo) — a diferencia de la de arriba (en vivo, en bucle, del
  // borrador), esta es UNA sola pasada de principio a fin sobre la alerta
  // real tal como está guardada, útil para confirmarla sin tener que
  // volver a elegir el archivo.
  const [savedPreview, setSavedPreview] = useState(null);
  const [savedPreviewPhase, setSavedPreviewPhase] = useState('entering');
  const savedPreviewTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedPreviewTimer.current), []);

  const previewSaved = (alert) => {
    clearTimeout(savedPreviewTimer.current);
    setSavedPreviewPhase('entering');
    setSavedPreview(alert);
    const dur = Math.min(MAX_DURATION_S * 1000, Math.max(500, alert.durationMs || 5000));
    const timers = [
      setTimeout(() => setSavedPreviewPhase('visible'), ANIM_DURATION_MS),
      setTimeout(() => setSavedPreviewPhase('exiting'), Math.max(ANIM_DURATION_MS, dur - ANIM_DURATION_MS)),
      setTimeout(() => setSavedPreview(null), dur),
    ];
    savedPreviewTimer.current = timers[timers.length - 1];
    // Los timers intermedios no necesitan limpiarse por separado: si se
    // cierra a mano o se abre otra vista previa, `savedPreview` pasa a
    // null/cambia antes de que importen sus fases intermedias.
  };

  const closeSavedPreview = () => {
    clearTimeout(savedPreviewTimer.current);
    setSavedPreview(null);
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/alerts`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setAlerts(data.alerts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAlerts(); }, []);

  const alertForGift = (giftName) => alerts.find((a) => a.giftName.toLowerCase() === giftName.toLowerCase());

  const save = async () => {
    if (!selectedGift) return setError('Elige a qué regalo se asigna esta alerta.');
    if (!file) return setError('Elige un archivo (imagen, gif, video o audio).');
    setError('');
    setSaving(true);
    try {
      const form = new FormData();
      form.append('media', file);
      form.append('giftName', selectedGift.name);
      form.append('durationMs', String(Math.round(duration * 1000)));
      form.append('position', position);
      form.append('entranceAnim', entranceAnim);
      form.append('exitAnim', exitAnim);
      const res = await fetch(`${backendUrl()}/api/alerts`, { method: 'POST', headers: authHeaders(), body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar la alerta');
      setFile(null);
      await fetchAlerts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('¿Borrar esta alerta? El regalo dejará de disparar nada hasta que asignes una nueva.')) return;
    await fetch(`${backendUrl()}/api/alerts/${id}`, { method: 'DELETE', headers: authHeaders() });
    await fetchAlerts();
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🔔 Alertas de regalos</p>

      <div className="theme-surface w-full max-w-md p-6 relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">NUEVA ALERTA</h1>
        </div>

        {giftsList.length === 0 ? (
          <p className="text-[11px] text-gray-500 leading-snug">
            Conecta un usuario de TikTok en la barra de arriba para cargar la lista de regalos disponibles.
          </p>
        ) : (
          <>
            <div className="mb-4 relative z-20">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎁 REGALO</label>
              <div
                onClick={() => setIsDropOpen(!isDropOpen)}
                className="theme-input w-full p-3 cursor-pointer flex items-center justify-between hover:border-[var(--accent)]"
              >
                {selectedGift ? (
                  <div className="flex items-center gap-3">
                    <img src={selectedGift.icon} className="w-6 h-6" />
                    <span className="text-sm">{selectedGift.name}</span>
                    {alertForGift(selectedGift.name) && <span className="theme-chip text-[9px] px-1.5 py-0.5 rounded">ya tiene alerta</span>}
                  </div>
                ) : (
                  <span className="text-gray-500 text-sm">Elige un regalo...</span>
                )}
              </div>
              {isDropOpen && (
                <div className="theme-surface absolute top-full left-0 w-full mt-1 overflow-y-auto max-h-48">
                  {giftsList.filter((g) => g.coins > 0).map((gift, i) => (
                    <div key={`al-${gift.id}-${i}`}
                      onClick={() => { setSelectedGift(gift); setIsDropOpen(false); }}
                      className="p-2 hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] cursor-pointer flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img src={gift.icon} className="w-6 h-6" />
                        <span className="text-sm">{gift.name}</span>
                      </div>
                      {alertForGift(gift.name) && <span className="theme-chip text-[9px] px-1.5 py-0.5 rounded">ya tiene alerta</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">📁 ARCHIVO</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase"
              />
              <p className="text-[10px] text-gray-500 mt-1">Imagen, GIF, video (MP4/WebM) o audio (MP3/WAV) — hasta 15MB.</p>
            </div>

            {/* Vista previa en vivo — pedido explícito: sin botón, se
                actualiza sola con cualquier cambio de acá abajo. */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">👁️ VISTA PREVIA EN VIVO</label>
              <LivePreview draftAlert={draftAlert} />
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">DURACIÓN EN PANTALLA</label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{duration}s</span>
              </div>
              <input type="range" min="1" max={MAX_DURATION_S} step="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              <p className="text-[10px] text-gray-500 mt-1">Máximo {MAX_DURATION_S}s por alerta.</p>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">POSICIÓN EN PANTALLA</label>
              <div className="flex gap-2 flex-wrap">
                {POSITIONS.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPosition(p.id)}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${position === p.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">✨ ANIMACIÓN DE ENTRADA</label>
              <div className="flex gap-2 flex-wrap">
                {ANIMATION_IN_OPTIONS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setEntranceAnim(a.id)}
                    className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${entranceAnim === a.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">✨ ANIMACIÓN DE SALIDA</label>
              <div className="flex gap-2 flex-wrap">
                {ANIMATION_OUT_OPTIONS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setExitAnim(a.id)}
                    className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${exitAnim === a.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-[11px] font-bold text-red-500 mb-3">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="theme-btn-primary w-full py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'SUBIENDO...' : 'GUARDAR ALERTA'}
            </button>
          </>
        )}
      </div>

      <div className="theme-surface w-full max-w-md p-6">
        <h2 className="theme-heading text-lg font-semibold mb-4">Alertas configuradas</h2>
        {loading ? (
          <p className="text-gray-500 text-sm italic">Cargando...</p>
        ) : alerts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="theme-input flex items-center gap-3 px-3 py-2">
                <span className="text-lg flex-shrink-0">{MEDIA_TYPE_ICON[alert.mediaType] || '📎'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{alert.giftName}</p>
                  <p className="text-[10px] text-gray-500">{(alert.durationMs / 1000).toFixed(0)}s · {POSITIONS.find((p) => p.id === alert.position)?.label || alert.position}</p>
                </div>
                <button onClick={() => previewSaved(alert)} className="text-[10px] font-bold text-gray-300 hover:text-white flex-shrink-0" title="Vista previa">
                  👁️
                </button>
                <button onClick={() => remove(alert.id)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline flex-shrink-0">
                  Borrar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-xs italic">Todavía no configuraste ninguna alerta.</p>
        )}
      </div>

      {savedPreview && (
        <>
          <AlertVisual alert={savedPreview} phase={savedPreviewPhase} />
          <button
            onClick={closeSavedPreview}
            className="fixed top-4 right-4 z-[10000] theme-btn-secondary px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            ✕ Cerrar vista previa
          </button>
        </>
      )}
    </div>
  );
}
