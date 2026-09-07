import React, { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';
import { AlertVisual } from './Overlay';

const POSITIONS = [
  { id: 'center', label: 'Centro' },
  { id: 'top', label: 'Arriba' },
  { id: 'bottom', label: 'Abajo' },
  { id: 'left', label: 'Izquierda' },
  { id: 'right', label: 'Derecha' },
];

const MEDIA_TYPE_ICON = { image: '🖼️', gif: '🎞️', video: '🎬', audio: '🎧' };

// Mismo límite que ya aplica el backend (ver server.js) y el propio
// AlertOverlay (ALERT_MAX_DURATION_MS en Overlay.jsx) — el slider de acá
// no deja pasarse, así que nunca se guarda algo que el overlay vaya a
// recortar de todos modos.
const MAX_DURATION_S = 15;

// Deduce el "tipo" de un archivo elegido en el <input type="file"> con el
// mismo criterio que ALERT_MEDIA_TYPES en server.js — para la vista previa
// (ver PreviewOverlay más abajo), que corre 100% en el cliente antes de
// subir nada.
function fileMediaType(file) {
  if (!file) return null;
  if (file.type === 'image/gif') return 'gif';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Vista previa (pedido explícito: ver cómo se va a ver la alerta —
  // imagen, texto, posición y animación — sin depender de que un
  // espectador mande el regalo de verdad). `previewObjectUrl` guarda la
  // URL de blob creada para previsualizar un archivo TODAVÍA sin guardar,
  // para poder revocarla cuando termina y no filtrar memoria.
  const [previewAlert, setPreviewAlert] = useState(null);
  const previewObjectUrl = useRef(null);
  const previewTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(previewTimer.current);
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
  }, []);

  const showPreview = (alertLike) => {
    clearTimeout(previewTimer.current);
    if (previewObjectUrl.current) { URL.revokeObjectURL(previewObjectUrl.current); previewObjectUrl.current = null; }
    setPreviewAlert(alertLike);
    previewTimer.current = setTimeout(() => setPreviewAlert(null), Math.min(15000, Math.max(500, alertLike.durationMs)));
  };

  const previewDraft = () => {
    const mediaType = fileMediaType(file);
    if (!mediaType) return setError('Elige un archivo para poder previsualizarlo.');
    setError('');
    const url = URL.createObjectURL(file);
    previewObjectUrl.current = url;
    showPreview({ mediaUrl: url, mediaType, durationMs: Math.round(duration * 1000), position });
  };

  const previewSaved = (alert) => {
    showPreview({ mediaUrl: alert.mediaUrl, mediaType: alert.mediaType, durationMs: alert.durationMs, position: alert.position });
  };

  const closePreview = () => {
    clearTimeout(previewTimer.current);
    if (previewObjectUrl.current) { URL.revokeObjectURL(previewObjectUrl.current); previewObjectUrl.current = null; }
    setPreviewAlert(null);
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

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">DURACIÓN EN PANTALLA</label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{duration}s</span>
              </div>
              <input type="range" min="1" max={MAX_DURATION_S} step="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              <p className="text-[10px] text-gray-500 mt-1">Máximo {MAX_DURATION_S}s por alerta.</p>
            </div>

            <div className="mb-6">
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

            {error && <p className="text-[11px] font-bold text-red-500 mb-3">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={previewDraft}
                disabled={!file}
                className="theme-btn-secondary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                👁️ VISTA PREVIA
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'SUBIENDO...' : 'GUARDAR ALERTA'}
              </button>
            </div>
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

      {previewAlert && (
        <>
          <AlertVisual alert={previewAlert} />
          <button
            onClick={closePreview}
            className="fixed top-4 right-4 z-[10000] theme-btn-secondary px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            ✕ Cerrar vista previa
          </button>
        </>
      )}
    </div>
  );
}
