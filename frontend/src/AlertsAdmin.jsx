import React, { useState, useEffect, useMemo, useRef } from 'react';
import GiftPicker from './GiftPicker';
import { backendUrl, authHeaders } from './auth';
import { AlertVisual, ANIM_DURATION_MS } from './Overlay';
import OverlayCustomizePanel from './OverlayCustomizePanel';
import { OVERLAY_CUSTOMIZE_LABELS } from './overlayCustomization';

const POSITIONS = [
  { id: 'center', label: 'Centro' },
  { id: 'top', label: 'Arriba' },
  { id: 'bottom', label: 'Abajo' },
  { id: 'left', label: 'Izquierda' },
  { id: 'right', label: 'Derecha' },
];

// Mismas 3 llaves que TEXT_POSITIONS en server.js -- solo importa cuando
// hay un recurso visual (si no, el texto va solo, centrado, ver AlertVisual
// en Overlay.jsx).
const TEXT_POSITIONS = [
  { id: 'above', label: 'Arriba del recurso' },
  { id: 'below', label: 'Abajo del recurso' },
  { id: 'beside', label: 'Al lado del recurso' },
];

// Mismos valores que VALID_TRIGGER_TYPES en server.js. 'gift' pide elegir
// un regalo de la lista (como siempre); 'follow'/'sticker' disparan solo
// con la clave fija que ya conoce el backend (ver processAlertTrigger en
// tenant.js). 'gift_global' es distinto a los otros tres -- pedido
// explícito ("alertas globales y alertas específicas, no deben pisarse
// entre sí"): en vez de un regalo o una clave fija, pide un mínimo de
// monedas, y puede haber VARIAS (una por cada mínimo distinto) -- se
// dispara con cualquier regalo SIN alerta específica propia que alcance
// ese mínimo (el de mayor mínimo que el regalo alcance, si hay más de
// una). Nunca compite con una alerta específica: el backend solo la
// busca cuando el regalo no tiene la suya propia (ver
// findGlobalAlertForCoins en tenant.js).
const TRIGGER_TYPES = [
  { id: 'gift', label: 'Regalo específico', icon: '🎁' },
  { id: 'gift_global', label: 'Alerta general (por monedas)', icon: '🌐' },
  { id: 'follow', label: 'Seguimiento', icon: '👣' },
  { id: 'sticker', label: 'Sticker de club de fans', icon: '🎫' },
];
const TRIGGER_LABELS = Object.fromEntries(TRIGGER_TYPES.map((t) => [t.id, t.label]));
const MIN_COINS_CAP = 999999; // mismo tope que MIN_COINS_CAP en server.js

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

const VISUAL_TYPE_ICON = { image: '🖼️', gif: '🎞️', video: '🎬' };
const MAX_TEXT_LENGTH = 200; // mismo tope que aplica el backend (String.slice)

// Mismo límite que ya aplica el backend (ver server.js) y el propio
// AlertOverlay (ALERT_MAX_DURATION_MS en Overlay.jsx) — el slider de acá
// no deja pasarse, así que nunca se guarda algo que el overlay vaya a
// recortar de todos modos.
const MAX_DURATION_S = 15;

// Deduce el "tipo" de un archivo VISUAL elegido en el <input type="file">
// con el mismo criterio que ALERT_VISUAL_TYPES en server.js — para la
// vista previa en vivo (ver LivePreview más abajo), que corre 100% en el
// cliente antes de subir nada. El audio no necesita esto: siempre es
// "audio", sin distinción de subtipo.
function fileVisualType(file) {
  if (!file) return null;
  if (file.type === 'image/gif') return 'gif';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
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
// Mismos tags que entiende el backend al disparar de verdad (ver
// applyAlertTextTemplate en tenant.js) -- acá se sustituyen con datos de
// EJEMPLO nada más, para que las vistas previas de este panel no muestren
// las llaves literales mientras se edita/revisa una alerta.
function applyPreviewTags(text, gift, coins = '100') {
  if (!text) return text;
  return text
    .replace(/\{username\}/gi, 'usuario_de_prueba')
    .replace(/\{nickname\}/gi, 'Usuario de Prueba')
    .replace(/\{gift\}/gi, gift || 'Regalo')
    .replace(/\{coins\}/gi, String(coins))
    .replace(/\{count\}/gi, '1');
}

// Nombre para mostrar en la lista de abajo -- una alerta general no tiene
// un regalo fijo (su `giftName` real es la clave interna "global:100", no
// algo presentable), así que se arma un texto propio con su mínimo.
function alertDisplayName(alert) {
  if (alert.triggerType === 'gift_global') {
    const n = alert.minCoins ?? 0;
    return `🌐 Alerta general · desde ${n} moneda${n === 1 ? '' : 's'}`;
  }
  if (alert.triggerType && alert.triggerType !== 'gift') return TRIGGER_LABELS[alert.triggerType] || alert.giftName;
  return alert.giftName;
}

function LivePreview({ draftAlert, customize }) {
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
          <AlertVisual alert={draftAlert} phase={phase} embedded customize={customize} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-gray-500 text-sm italic" style={{ transform: `scale(${1 / STAGE_SCALE})` }}>Agrega un recurso o un texto para ver la vista previa</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Una fila de la lista de "Alertas configuradas" — misma pinta para
// específicas y generales, solo cambia qué texto arma alertDisplayName.
function AlertRow({ alert, testFire, previewSaved, startEdit, remove }) {
  return (
    <div className="theme-input flex items-center gap-3 px-3 py-2">
      <span className="text-lg flex-shrink-0 flex items-center gap-0.5">
        {alert.visualType && (VISUAL_TYPE_ICON[alert.visualType] || '📎')}
        {alert.audioUrl && '🎧'}
        {alert.text && '💬'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white truncate">{alertDisplayName(alert)}</p>
        <p className="text-[10px] text-gray-500">{(alert.durationMs / 1000).toFixed(0)}s · {POSITIONS.find((p) => p.id === alert.position)?.label || alert.position}</p>
      </div>
      <button onClick={() => testFire(alert.id)} className="text-[10px] font-bold text-gray-300 hover:text-white flex-shrink-0" title="Probar (dispara la alerta real)">
        🔥
      </button>
      <button onClick={() => previewSaved(alert)} className="text-[10px] font-bold text-gray-300 hover:text-white flex-shrink-0" title="Vista previa">
        👁️
      </button>
      <button onClick={() => startEdit(alert)} className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex-shrink-0" title="Editar">
        ✏️
      </button>
      <button onClick={() => remove(alert.id)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline flex-shrink-0">
        Borrar
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// ALERTAS — panel de administración
// Cada disparador (un regalo puntual, seguimiento, o sticker
// de club de fans) puede tener a lo sumo UNA alerta asignada. Pedido
// explícito: visual (imagen/gif/video, con mute opcional) y audio son DOS
// recursos independientes y opcionales, mas un texto también opcional —
// cualquier combinación vale (imagen sola, audio solo, video mudo + audio
// aparte, solo texto, etc.) mientras venga al menos uno de los tres. Los
// archivos se suben directo a Supabase Storage (ver backend/storage.js) —
// acá solo se arma el formulario y se manda por multipart/form-data; nunca
// pasa por localStorage ni por el socket (subir un archivo grande por
// socket.io sería mucho más frágil que un POST normal con su propio manejo
// de progreso/errores).
// El DISPARO en vivo de la alerta (cuando pasa de verdad, o cuando el
// streamer la prueba desde acá) sí va por socket — ver AlertOverlay en
// Overlay.jsx / alert_triggered y test_alert en tenant.js —, esto de acá
// es solo la configuración.
// ─────────────────────────────────────────────
export default function AlertsAdmin({ giftsList, socket, customization, onCustomizeChange, onApplyToAll }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggerType, setTriggerType] = useState('gift');
  const [selectedGift, setSelectedGift] = useState(null);
  const [minCoins, setMinCoins] = useState('');

  const [visualFile, setVisualFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  // Pedido explicito: poder deshacer un archivo elegido por accidente
  // (antes de guardar) con un botón "✕" -- limpiar solo el estado no
  // alcanza, un <input type="file"> es un elemento no controlado y sigue
  // mostrando el nombre del archivo elegido aunque `visualFile`/`audioFile`
  // vuelvan a null, hace falta resetear el input de verdad con la ref.
  const visualInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const [visualMuted, setVisualMuted] = useState(false);
  // "Quitar" explícito de un recurso YA guardado, sin tener que borrar toda
  // la alerta — solo tiene efecto mientras se está editando (ver save()).
  const [clearVisual, setClearVisual] = useState(false);
  const [clearAudio, setClearAudio] = useState(false);
  const [text, setText] = useState('');
  const [textPosition, setTextPosition] = useState('below');

  const [duration, setDuration] = useState(5);
  const [position, setPosition] = useState('center');
  const [entranceAnim, setEntranceAnim] = useState('fade');
  const [exitAnim, setExitAnim] = useState('fade');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // null = creando una alerta nueva. Si no, es la alerta que se está
  // editando (ver startEdit) -- el disparador queda bloqueado mientras se
  // edita (ver el JSX de abajo) para no terminar con una fila huérfana en
  // la DB si el streamer lo cambiara a mitad de una edición.
  const [editingId, setEditingId] = useState(null);
  const [editingExisting, setEditingExisting] = useState(null);

  const [customizingText, setCustomizingText] = useState(false);

  // URLs de blob de los archivos recién elegidos, para la vista previa en
  // vivo — se crean/revocan en el mismo efecto atado a cada archivo (React
  // garantiza que el cleanup de la vuelta anterior corre ANTES del cuerpo
  // de la vuelta nueva), así nunca se revoca por accidente la URL que se
  // acaba de crear para el archivo actual.
  const [visualFileUrl, setVisualFileUrl] = useState(null);
  useEffect(() => {
    if (!visualFile) { setVisualFileUrl(null); return; }
    const url = URL.createObjectURL(visualFile);
    setVisualFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [visualFile]);

  const [audioFileUrl, setAudioFileUrl] = useState(null);
  useEffect(() => {
    if (!audioFile) { setAudioFileUrl(null); return; }
    const url = URL.createObjectURL(audioFile);
    setAudioFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Qué recurso se va a mandar/mostrar realmente: archivo recién elegido >
  // (si no se pidió quitar) el que ya tenía la alerta en edición > nada.
  const effectiveVisualUrl = visualFileUrl || (!clearVisual && editingExisting?.visualUrl) || null;
  const effectiveVisualType = visualFile ? fileVisualType(visualFile) : ((!clearVisual && editingExisting?.visualType) || null);
  const effectiveAudioUrl = audioFileUrl || (!clearAudio && editingExisting?.audioUrl) || null;

  const draftAlert = useMemo(() => {
    if (!effectiveVisualUrl && !effectiveAudioUrl && !text.trim()) return null;
    return {
      visualUrl: effectiveVisualUrl, visualType: effectiveVisualType, visualMuted,
      audioUrl: effectiveAudioUrl,
      text: applyPreviewTags(
        text.trim(),
        triggerType === 'gift' ? selectedGift?.name : '',
        triggerType === 'gift_global' && minCoins ? minCoins : '100',
      ),
      textPosition,
      durationMs: Math.round(duration * 1000), position, entranceAnim, exitAnim,
    };
  }, [effectiveVisualUrl, effectiveVisualType, effectiveAudioUrl, visualMuted, text, textPosition, duration, position, entranceAnim, exitAnim, triggerType, selectedGift, minCoins]);

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
    const isGlobal = alert.triggerType === 'gift_global';
    setSavedPreview({ ...alert, text: applyPreviewTags(alert.text, isGlobal ? '' : alert.giftName, isGlobal ? (alert.minCoins ?? 100) : '100') });
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

  // Separadas para la lista de abajo (pedido explícito: "alertas globales y
  // alertas específicas" como dos categorías) — las generales ordenadas por
  // mínimo ascendente, para que se lea como una escalera de niveles.
  const specificAlerts = useMemo(() => alerts.filter((a) => a.triggerType !== 'gift_global'), [alerts]);
  const globalAlerts = useMemo(() => (
    alerts.filter((a) => a.triggerType === 'gift_global').sort((a, b) => (a.minCoins ?? 0) - (b.minCoins ?? 0))
  ), [alerts]);

  const alertForTrigger = (triggerKey) => alerts.find((a) => a.giftName.toLowerCase() === triggerKey.toLowerCase());

  // Pedido explícito: después de guardar (nueva alerta o edición), el
  // panel vuelve a quedar en blanco -- así el streamer puede setear la
  // siguiente desde cero sin arrastrar los datos recién ingresados.
  const resetForm = () => {
    setEditingId(null);
    setEditingExisting(null);
    setTriggerType('gift');
    setSelectedGift(null);
    setMinCoins('');
    setVisualFile(null);
    setAudioFile(null);
    setVisualMuted(false);
    setClearVisual(false);
    setClearAudio(false);
    setText('');
    setTextPosition('below');
    setDuration(5);
    setPosition('center');
    setEntranceAnim('fade');
    setExitAnim('fade');
    setError('');
  };

  const startEdit = (alert) => {
    setEditingId(alert.id);
    setEditingExisting(alert);
    setTriggerType(alert.triggerType || 'gift');
    if (!alert.triggerType || alert.triggerType === 'gift') {
      const gift = giftsList.find((g) => g.name.toLowerCase() === alert.giftName.toLowerCase());
      setSelectedGift(gift || { name: alert.giftName, icon: '', coins: 0 });
    } else {
      setSelectedGift(null);
    }
    setMinCoins(alert.triggerType === 'gift_global' && alert.minCoins != null ? String(alert.minCoins) : '');
    setVisualFile(null);
    setAudioFile(null);
    setVisualMuted(!!alert.visualMuted);
    setClearVisual(false);
    setClearAudio(false);
    setText(alert.text || '');
    setTextPosition(alert.textPosition || 'below');
    setDuration((alert.durationMs || 5000) / 1000);
    setPosition(alert.position || 'center');
    setEntranceAnim(alert.entranceAnim || 'fade');
    setExitAnim(alert.exitAnim || 'fade');
    setError('');
  };

  const save = async () => {
    if (triggerType === 'gift' && !selectedGift) return setError('Elige a qué regalo se asigna esta alerta.');
    if (triggerType === 'gift_global') {
      const n = Number(minCoins);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MIN_COINS_CAP) {
        return setError(`Ingresa un mínimo de monedas válido (entre 1 y ${MIN_COINS_CAP}).`);
      }
    }
    if (!effectiveVisualUrl && !effectiveAudioUrl && !text.trim()) {
      return setError('Agrega al menos un recurso visual, un audio o un texto.');
    }
    setError('');
    setSaving(true);
    try {
      const form = new FormData();
      if (editingId) form.append('alertId', editingId);
      if (visualFile) form.append('visual', visualFile);
      if (audioFile) form.append('audio', audioFile);
      if (clearVisual) form.append('clearVisual', 'true');
      if (clearAudio) form.append('clearAudio', 'true');
      form.append('visualMuted', String(visualMuted));
      form.append('triggerType', triggerType);
      if (triggerType === 'gift') form.append('giftName', selectedGift.name);
      if (triggerType === 'gift_global') form.append('minCoins', String(Math.trunc(Number(minCoins))));
      form.append('text', text.trim());
      form.append('textPosition', textPosition);
      form.append('durationMs', String(Math.round(duration * 1000)));
      form.append('position', position);
      form.append('entranceAnim', entranceAnim);
      form.append('exitAnim', exitAnim);
      const res = await fetch(`${backendUrl()}/api/alerts`, { method: 'POST', headers: authHeaders(), body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar la alerta');
      resetForm();
      await fetchAlerts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('¿Borrar esta alerta? Ese disparador dejará de reproducir nada hasta que asignes una nueva.')) return;
    await fetch(`${backendUrl()}/api/alerts/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (editingId === id) resetForm();
    await fetchAlerts();
  };

  // Botón "🔥 Probar" — dispara la alerta real (ver testFireAlert en
  // tenant.js), la misma que verían los espectadores en OBS, más la
  // confirmación en vivo de acá abajo.
  const testFire = (id) => socket?.emit('test_alert', id);

  // Alerta que YA ocupa este disparador, sin contar la que se está editando
  // -- pedido explícito: al editar se puede cambiar TODO, incluido a qué
  // disparador está asignada, así que este chequeo es lo que evita pisar
  // en silencio la alerta de otro regalo/evento (el backend hace el mismo
  // chequeo como última barrera, ver /api/alerts en server.js).
  const conflictForTrigger = (triggerKey) => {
    const found = alertForTrigger(triggerKey);
    return found && found.id !== editingId ? found : null;
  };

  // Mismo chequeo que conflictForTrigger, pero para alertas generales: no
  // hay una clave fija por tipo (puede haber varias 'gift_global', una por
  // cada mínimo), así que el conflicto es por MISMO mínimo, no por
  // triggerType — dos alertas generales con el mismo número de monedas no
  // tendrían forma de distinguirse cuál dispara.
  const conflictForMinCoins = (n) => {
    if (!Number.isFinite(n)) return null;
    const found = alerts.find((a) => a.triggerType === 'gift_global' && Number(a.minCoins) === n);
    return found && found.id !== editingId ? found : null;
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🔔 Alertas</p>

      <div className="theme-surface w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="theme-accent-bg w-3 h-8 rounded-full" />
            <h1 className="theme-heading text-2xl font-semibold tracking-wide">{editingId ? 'EDITANDO ALERTA' : 'NUEVA ALERTA'}</h1>
          </div>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-[10px] font-bold text-gray-400 hover:text-white underline whitespace-nowrap">
              Cancelar edición
            </button>
          )}
        </div>
        {editingId && (
          <p className="text-[10px] text-gray-500 -mt-4 mb-4">
            Puedes cambiar cualquier campo, incluido el disparador — si eliges uno que ya tiene otra alerta asignada, tendrás que resolverlo antes de guardar.
          </p>
        )}

        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">DISPARADOR</label>
          <div className="flex gap-2 flex-wrap">
            {TRIGGER_TYPES.map((t) => (
              <button key={t.id} type="button"
                onClick={() => { setTriggerType(t.id); if (t.id !== 'gift') setSelectedGift(null); if (t.id !== 'gift_global') setMinCoins(''); }}
                className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${triggerType === t.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          {triggerType === 'gift_global' && (
            <p className="text-[10px] text-gray-500 mt-2">
              Se dispara con cualquier regalo que NO tenga su propia alerta específica y cuyo valor en monedas alcance el mínimo de abajo. Nunca compite con una alerta específica: si el regalo tiene la suya, esa gana siempre.
            </p>
          )}
          {triggerType !== 'gift' && triggerType !== 'gift_global' && conflictForTrigger(triggerType) && (
            <p className="text-[10px] text-amber-500 mt-2">Ya existe una alerta para "{TRIGGER_LABELS[triggerType]}" — bórrala o elige otro disparador antes de guardar.</p>
          )}
        </div>

        {triggerType === 'gift_global' && (
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🪙 MÍNIMO DE MONEDAS</label>
            <input
              type="number" min="1" max={MIN_COINS_CAP} step="1"
              value={minCoins}
              onChange={(e) => setMinCoins(e.target.value)}
              placeholder="Ej: 1"
              className="theme-input w-full p-3 outline-none text-sm text-white"
            />
            {minCoins !== '' && conflictForMinCoins(Number(minCoins)) && (
              <p className="text-[10px] text-amber-500 mt-2">Ya existe una alerta general para {minCoins} monedas — bórrala o elige otro mínimo antes de guardar.</p>
            )}
          </div>
        )}

        {triggerType === 'gift' && (
          <div className="mb-4 relative z-20">
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎁 REGALO</label>
            <GiftPicker
              gifts={giftsList.filter((g) => g.coins > 0)}
              selected={selectedGift}
              onSelect={setSelectedGift}
              placeholder="Elige un regalo..."
              emptyText="Aún no hay regalos cargados. Conecta un usuario de TikTok en la barra de arriba una sola vez y quedarán guardados para siempre en tu licencia."
              renderBadge={(gift) => conflictForTrigger(gift.name) && <span className="theme-chip text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex-shrink-0">ya tiene alerta</span>}
            />
          </div>
        )}

        <>
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🖼️ VISUAL (imagen, gif o video — opcional)</label>
              {visualFile ? (
                <div className="theme-input flex items-center justify-between gap-2 p-2 mb-2">
                  <span className="text-[10px] text-gray-400 truncate">📎 {visualFile.name}</span>
                  <button
                    type="button"
                    onClick={() => { setVisualFile(null); if (visualInputRef.current) visualInputRef.current.value = ''; }}
                    className="text-red-400 hover:text-red-300 font-black text-sm flex-shrink-0 leading-none"
                    title="Quitar este archivo" aria-label="Quitar archivo elegido"
                  >✕</button>
                </div>
              ) : effectiveVisualUrl ? (
                <div className="theme-input flex items-center justify-between p-2 mb-2">
                  <span className="text-[10px] text-gray-400">{VISUAL_TYPE_ICON[effectiveVisualType] || '📎'} Ya tiene un archivo guardado</span>
                  <button type="button" onClick={() => setClearVisual(true)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline">Quitar</button>
                </div>
              ) : null}
              <input
                ref={visualInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                onChange={(e) => { setVisualFile(e.target.files?.[0] || null); setClearVisual(false); }}
                className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase"
              />
              <p className="text-[10px] text-gray-500 mt-1">PNG/JPG/WebP, GIF, o video (MP4/WebM) — hasta 15MB.</p>
              {effectiveVisualType === 'video' && (
                <label className="flex items-center gap-2 mt-2 text-[10px] text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={visualMuted} onChange={(e) => setVisualMuted(e.target.checked)} />
                  Mutear el video (útil si vas a poner un audio aparte abajo)
                </label>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎧 AUDIO (opcional, independiente del visual)</label>
              {audioFile ? (
                <div className="theme-input flex items-center justify-between gap-2 p-2 mb-2">
                  <span className="text-[10px] text-gray-400 truncate">🎧 {audioFile.name}</span>
                  <button
                    type="button"
                    onClick={() => { setAudioFile(null); if (audioInputRef.current) audioInputRef.current.value = ''; }}
                    className="text-red-400 hover:text-red-300 font-black text-sm flex-shrink-0 leading-none"
                    title="Quitar este archivo" aria-label="Quitar archivo elegido"
                  >✕</button>
                </div>
              ) : effectiveAudioUrl ? (
                <div className="theme-input flex items-center justify-between p-2 mb-2">
                  <span className="text-[10px] text-gray-400">🎧 Ya tiene un audio guardado</span>
                  <button type="button" onClick={() => setClearAudio(true)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline">Quitar</button>
                </div>
              ) : null}
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp3,audio/ogg"
                onChange={(e) => { setAudioFile(e.target.files?.[0] || null); setClearAudio(false); }}
                className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase"
              />
              <p className="text-[10px] text-gray-500 mt-1">MP3/WAV/OGG — hasta 15MB. Suena junto al visual, sin importar si el video tiene su propio audio o está mudo.</p>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] uppercase tracking-widest text-gray-400 font-semibold">💬 TEXTO (opcional)</label>
                <button type="button" onClick={() => setCustomizingText(true)} className="text-[9px] font-black text-gray-400 hover:text-white underline uppercase tracking-widest whitespace-nowrap">
                  🎨 Personalizar estilo
                </button>
              </div>
              <textarea
                value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))} rows={2}
                placeholder="Ej: ¡Gracias por el {gift}, {username}!"
                className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 text-sm resize-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Tags disponibles: <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{username}'}</code>{' '}
                <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{nickname}'}</code>{' '}
                <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{gift}'}</code>{' '}
                <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{coins}'}</code>{' '}
                <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{count}'}</code>
                {' '}— se reemplazan por los datos reales al dispararse (usuario, su nombre público, el regalo, cuántas monedas costó y cuántas veces seguidas lo mandó).
              </p>
              <p className="text-[10px] text-gray-500 mt-1 text-right">{text.length}/{MAX_TEXT_LENGTH}</p>
              {effectiveVisualUrl && (
                <div className="mt-2">
                  <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">Posición del texto respecto al recurso</label>
                  <div className="flex gap-2 flex-wrap">
                    {TEXT_POSITIONS.map((p) => (
                      <button key={p.id} type="button" onClick={() => setTextPosition(p.id)}
                        className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${textPosition === p.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Vista previa en vivo — pedido explícito: sin botón, se
                actualiza sola con cualquier cambio de acá abajo. */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">👁️ VISTA PREVIA EN VIVO</label>
              <LivePreview draftAlert={draftAlert} customize={customization} />
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

            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'GUARDANDO...' : editingId ? 'GUARDAR CAMBIOS' : 'GUARDAR ALERTA'}
              </button>
              {editingId && (
                <button onClick={resetForm} type="button" className="theme-btn-secondary px-5 py-4 rounded-xl font-bold tracking-wide text-xs uppercase">
                  Cancelar
                </button>
              )}
            </div>
          </>
      </div>

      <div className="theme-surface w-full max-w-md p-6">
        <h2 className="theme-heading text-lg font-semibold mb-1">Alertas específicas</h2>
        <p className="text-[10px] text-gray-500 mb-4">Un regalo, seguimiento o sticker puntual — siempre tienen prioridad sobre las generales de abajo.</p>
        {loading ? (
          <p className="text-gray-500 text-sm italic">Cargando...</p>
        ) : specificAlerts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {specificAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} testFire={testFire} previewSaved={previewSaved} startEdit={startEdit} remove={remove} />
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-xs italic">Todavía no configuraste ninguna alerta específica.</p>
        )}
      </div>

      <div className="theme-surface w-full max-w-md p-6">
        <h2 className="theme-heading text-lg font-semibold mb-1">Alertas generales</h2>
        <p className="text-[10px] text-gray-500 mb-4">Se disparan solo si el regalo no tiene una alerta específica asignada — la de mayor mínimo que el regalo alcance.</p>
        {loading ? (
          <p className="text-gray-500 text-sm italic">Cargando...</p>
        ) : globalAlerts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {globalAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} testFire={testFire} previewSaved={previewSaved} startEdit={startEdit} remove={remove} />
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-xs italic">Todavía no configuraste ninguna alerta general.</p>
        )}
      </div>

      {savedPreview && (
        <>
          <AlertVisual alert={savedPreview} phase={savedPreviewPhase} customize={customization} />
          <button
            onClick={closeSavedPreview}
            className="fixed top-4 right-4 z-[10000] theme-btn-secondary px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            ✕ Cerrar vista previa
          </button>
        </>
      )}

      {customizingText && (
        <OverlayCustomizePanel
          title={OVERLAY_CUSTOMIZE_LABELS.alerts}
          overlayId="alerts"
          entry={customization}
          onChange={onCustomizeChange}
          onApplyToAll={onApplyToAll}
          onClose={() => setCustomizingText(false)}
          hideBackground
        />
      )}
    </div>
  );
}
