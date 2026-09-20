import React, { useState, useEffect, useMemo, useRef } from 'react';
import GiftPicker from './GiftPicker';
import { SkeletonRows } from './PanelHelp';
import iconFollow from './assets/alert-follow.png';
import iconGlobal from './assets/alert-global.png';
import iconSticker from './assets/alert-sticker.png';
import { backendUrl, authHeaders } from './auth';
import { AlertVisual } from './Overlay';
import { alertTiming } from './alertQueue';
import OverlayCustomizePanel from './OverlayCustomizePanel';
import AlertMonitorSettings from './AlertMonitorSettings';
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
// Vertical 1080x1920: es la resolución real de una transmisión de TikTok, así
// que la miniatura muestra las proporciones y tamaños reales.
const STAGE_W = 1080;
const STAGE_H = 1920;
const STAGE_SCALE = 0.22;

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
    return `Alerta general · desde ${n} moneda${n === 1 ? '' : 's'}`;
  }
  if (alert.triggerType && alert.triggerType !== 'gift') return TRIGGER_LABELS[alert.triggerType] || alert.giftName;
  return alert.giftName || 'Regalo pendiente de seleccionar';
}

function LivePreview({ draftAlert, customize }) {
  const [phase, setPhase] = useState('entering');
  const [cycle, setCycle] = useState(0);
  // La alerta se monta al empezar cada vuelta y se DESMONTA al terminar su
  // duración: así el audio y el video se cortan ahí (antes la vista previa dejaba
  // el mismo elemento montado y el sonido seguía hasta el final del archivo).
  const [playing, setPlaying] = useState(true);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    if (!draftAlert) return;
    setPhase('entering');
    setPlaying(true);
    const { duration, animation } = alertTiming(draftAlert);
    const LOOP_PAUSE_MS = 600;
    const timers = [
      setTimeout(() => setPhase('visible'), animation),
      setTimeout(() => setPhase('exiting'), duration - animation),
      setTimeout(() => setPlaying(false), duration),
      setTimeout(() => setCycle((c) => c + 1), duration + LOOP_PAUSE_MS),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAlert, cycle]);

  return (
    <div className="flex flex-col items-center gap-2">
    <div className="rounded-xl overflow-hidden mx-auto flex-shrink-0" style={{ width: STAGE_W * STAGE_SCALE, height: STAGE_H * STAGE_SCALE, background: 'repeating-conic-gradient(#1a1625 0% 25%, #150f22 0% 50%) 0 0/24px 24px' }}>
      <div className="relative" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${STAGE_SCALE})`, transformOrigin: 'top left' }}>
        {draftAlert ? (
          playing && <AlertVisual key={cycle} alert={draftAlert} phase={phase} embedded customize={customize} previewMuted={!soundOn} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-gray-500 text-sm italic text-center" style={{ width: STAGE_W * STAGE_SCALE - 24, transform: `scale(${1 / STAGE_SCALE})` }}>Agrega un recurso o un texto para ver la vista previa</p>
          </div>
        )}
      </div>
    </div>
    {/* La vista previa repite en bucle, y con audio suena en cada vuelta: se puede silenciar sin tocar la alerta. */}
    <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
      <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
      Sonido de la vista previa
    </label>
    </div>
  );
}

// Una fila de la lista de "Alertas configuradas" — misma pinta para
// específicas y generales, solo cambia qué texto arma alertDisplayName.
// Un ícono por TIPO de alerta (en vez de los de imagen/sonido/texto): la
// imagen del propio regalo para las de regalo específico, y uno fijo para
// seguimiento, alerta general y sticker del club de fans.
const TRIGGER_ICONS = {
  follow: { src: iconFollow, label: 'Seguimiento' },
  gift_global: { src: iconGlobal, label: 'Alerta general' },
  sticker: { src: iconSticker, label: 'Sticker de club de fans' },
};

function AlertTypeIcon({ alert, giftIcon }) {
  const fixed = TRIGGER_ICONS[alert.triggerType];
  const src = fixed ? fixed.src : giftIcon;
  if (!src) return <span className="w-9 h-9 flex items-center justify-center text-2xl flex-shrink-0" role="img" aria-label="Regalo">🎁</span>;
  return <img src={src} alt={fixed ? fixed.label : 'Regalo'} className="w-9 h-9 object-contain flex-shrink-0" />;
}

function AlertRow({ alert, giftIcon, testFire, previewSaved, startEdit, remove }) {
  const name = alertDisplayName(alert);
  return (
    <div className="theme-input flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <AlertTypeIcon alert={alert} giftIcon={giftIcon} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{name}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {(alert.durationMs / 1000).toFixed(0)}s · {POSITIONS.find((p) => p.id === alert.position)?.label || alert.position}
            {(alert.visualType || alert.audioUrl || alert.text) ? ` · ${alert.visualType ? (VISUAL_TYPE_ICON[alert.visualType] || '📎') : ''}${alert.audioUrl ? '🎧' : ''}${alert.text ? '💬' : ''}` : ''}
            {alert.text ? ` · "${alert.text}"` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button onClick={() => testFire(alert.id)} className="theme-btn-secondary px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide" title="Dispara la alerta real en tu stream" aria-label={`Probar la alerta ${name}`}>
          🔥 Probar
        </button>
        <button onClick={() => previewSaved(alert)} className="theme-btn-secondary px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide" title="Verla aquí, sin disparar nada" aria-label={`Vista previa de la alerta ${name}`}>
          👁️ Ver
        </button>
        <button onClick={() => startEdit(alert)} className="theme-btn-primary px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide" aria-label={`Editar la alerta ${name}`}>
          ✏️ Editar
        </button>
        <button onClick={() => remove(alert.id)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline px-1" aria-label={`Borrar la alerta ${name}`}>
          Borrar
        </button>
      </div>
    </div>
  );
}

// Tarjeta numerada del formulario: divide la creación de una alerta en
// pasos cortos en vez de una sola columna larga de campos sueltos.
function FormSection({ step, title, hint, children }) {
  return (
    <section className="theme-surface w-full max-w-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <span className="theme-accent-bg text-sm font-black w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">{step}</span>
        <div>
          <h2 className="theme-heading text-lg font-semibold leading-tight">{title}</h2>
          {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
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
export default function AlertsAdmin({ giftsList, socket, customization, onCustomizeChange, onApplyToAll, monitor }) {
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
  // Color de texto propio de ESTA alerta ('' = sigue el estilo general).
  const [textColor, setTextColor] = useState('');

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
  // 'list' = lista de alertas guardadas (vista por defecto); 'form' = crear
  // o editar una. Pedido explícito: el formulario no se muestra hasta que el
  // streamer toca "Nueva alerta" o "Editar".
  const [view, setView] = useState('list');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef(null);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const showNotice = (message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  };
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
      textPosition, textColor: textColor || null,
      durationMs: Math.round(duration * 1000), position, entranceAnim, exitAnim,
    };
  }, [effectiveVisualUrl, effectiveVisualType, effectiveAudioUrl, visualMuted, text, textPosition, textColor, duration, position, entranceAnim, exitAnim, triggerType, selectedGift, minCoins]);

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
    const { duration: dur, animation } = alertTiming(alert);
    const timers = [
      setTimeout(() => setSavedPreviewPhase('visible'), animation),
      setTimeout(() => setSavedPreviewPhase('exiting'), dur - animation),
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

  // Imagen del regalo de cada alerta específica (catálogo de la conexión LIVE actual).
  const giftIconFor = (alert) => {
    if (alert.triggerType && alert.triggerType !== 'gift') return null;
    const g = giftsList.find((x) => x.name.toLowerCase() === String(alert.giftName).toLowerCase());
    return g?.icon || null;
  };

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
    setTextColor('');
    setDuration(5);
    setPosition('center');
    setEntranceAnim('fade');
    setExitAnim('fade');
    setError('');
  };

  const openNew = () => {
    resetForm();
    setNotice('');
    setView('form');
  };

  const closeForm = () => {
    resetForm();
    setView('list');
  };

  const startEdit = (alert) => {
    setNotice('');
    setView('form');
    setEditingId(alert.id);
    setEditingExisting(alert);
    setTriggerType(alert.triggerType || 'gift');
    if (!alert.triggerType || alert.triggerType === 'gift') {
      const gift = giftsList.find((g) => g.name.toLowerCase() === alert.giftName.toLowerCase());
      setSelectedGift(gift || (alert.giftName ? { name: alert.giftName, icon: '', coins: 0 } : null));
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
    setTextColor(alert.textColor || '');
    setDuration((alert.durationMs || 5000) / 1000);
    setPosition(alert.position || 'center');
    setEntranceAnim(alert.entranceAnim || 'fade');
    setExitAnim(alert.exitAnim || 'fade');
    setError('');
  };

  const save = async () => {
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
      if (triggerType === 'gift') form.append('giftName', selectedGift?.name || '');
      // El id evita que la alerta no dispare cuando el nombre del regalo en
      // vivo no coincide con el del catálogo.
      if (triggerType === 'gift' && selectedGift?.id != null) form.append('giftId', String(selectedGift.id));
      if (triggerType === 'gift_global') form.append('minCoins', String(Math.trunc(Number(minCoins))));
      form.append('text', text.trim());
      form.append('textPosition', textPosition);
      form.append('textColor', textColor);
      form.append('durationMs', String(Math.round(duration * 1000)));
      form.append('position', position);
      form.append('entranceAnim', entranceAnim);
      form.append('exitAnim', exitAnim);
      const res = await fetch(`${backendUrl()}/api/alerts`, { method: 'POST', headers: authHeaders(), body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar la alerta');
      const wasEditing = !!editingId;
      resetForm();
      setView('list');
      showNotice(wasEditing ? 'Cambios guardados.' : 'Alerta creada.');
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
    showNotice('Alerta borrada.');
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

  const totalAlerts = alerts.length;

  // Al pasar de lista a formulario (o al revés) arranca desde arriba.
  const rootRef = useRef(null);
  useEffect(() => {
    rootRef.current?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [view]);

  // ── Vista 1: LISTA ─────────────────────────────────────────
  const listView = (
    <>
      <div className="w-full max-w-2xl flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">🔔 Alertas</p>
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">Mis alertas</h1>
          <p className="text-xs text-gray-500 mt-1 max-w-md">Lo que aparece (y suena) en tu stream cuando alguien te manda un regalo, te sigue o usa un sticker.</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button type="button" onClick={openNew} className="theme-btn-primary px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">
            ＋ Nueva alerta
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="w-full max-w-2xl rounded-xl px-4 py-3 text-xs font-bold text-green-300 bg-green-500/10 border border-green-500/30">
          ✅ {notice}
        </div>
      )}

      {loading ? (
        <div className="theme-surface w-full max-w-2xl p-6">
          <SkeletonRows count={3} label="Cargando tus alertas..." />
        </div>
      ) : totalAlerts === 0 ? (
        <div className="theme-surface w-full max-w-2xl p-8 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <h2 className="theme-heading text-lg font-semibold mb-2">Aún no tienes alertas</h2>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">Crea tu primera alerta en tres pasos rápidos. No necesitas estar en vivo para armarla.</p>
          <ol className="text-left text-xs text-gray-400 max-w-sm mx-auto mb-6 flex flex-col gap-2">
            <li className="flex gap-3"><span className="theme-chip w-5 h-5 rounded-full flex items-center justify-center font-black flex-shrink-0">1</span> Elige qué la activa: un regalo, un seguidor nuevo o un sticker.</li>
            <li className="flex gap-3"><span className="theme-chip w-5 h-5 rounded-full flex items-center justify-center font-black flex-shrink-0">2</span> Sube una imagen, GIF o video, un audio y/o escribe un texto.</li>
            <li className="flex gap-3"><span className="theme-chip w-5 h-5 rounded-full flex items-center justify-center font-black flex-shrink-0">3</span> Mira la vista previa, ajusta y guarda.</li>
          </ol>
          <button type="button" onClick={openNew} className="theme-btn-primary px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg">
            ＋ Crear mi primera alerta
          </button>
        </div>
      ) : (
        <>
          <section className="theme-surface w-full max-w-2xl p-5" aria-label="Ajustes generales de las alertas">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="theme-heading text-lg font-semibold">Ajustes generales</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">Afectan a TODAS tus alertas a la vez. Para algo propio de una alerta (como su color), edítala.</p>
              </div>
              <button type="button" onClick={() => setCustomizingText(true)} className="theme-btn-secondary px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex-shrink-0" title="Color, degradado y tamaño del texto de todas las alertas">
                🎨 Personalizar
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="theme-label text-[10px] uppercase tracking-widest font-semibold">🔊 Volumen general</span>
              <span className="theme-chip font-bold px-2 rounded text-xs">{Math.round((customization?.volume ?? 1) * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05"
              value={customization?.volume ?? 1}
              onChange={(e) => onCustomizeChange({ ...customization, volume: Number(e.target.value) })}
              aria-label="Volumen general de todas las alertas"
              className="w-full"
            />
            <p className="text-[11px] text-gray-500 mt-1">Sube o baja el sonido de TODAS tus alertas a la vez (su audio y el audio de sus videos), sin editarlas una por una.</p>
            {monitor && <AlertMonitorSettings {...monitor} />}
          </section>

          <section className="theme-surface w-full max-w-2xl p-6">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="theme-heading text-lg font-semibold">Alertas específicas</h2>
              <span className="theme-chip text-[10px] font-bold px-2 py-0.5 rounded-full">{specificAlerts.length}</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-4">Un regalo, seguimiento o sticker puntual. Siempre tienen prioridad sobre las generales.</p>
            {specificAlerts.length > 0 ? (
              <div className="flex flex-col gap-2">
                {specificAlerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} giftIcon={giftIconFor(alert)} testFire={testFire} previewSaved={previewSaved} startEdit={startEdit} remove={remove} />
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-xs italic">Todavía no tienes alertas específicas.</p>
            )}
          </section>

          <section className="theme-surface w-full max-w-2xl p-6">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="theme-heading text-lg font-semibold">Alertas generales</h2>
              <span className="theme-chip text-[10px] font-bold px-2 py-0.5 rounded-full">{globalAlerts.length}</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-4">Se disparan con cualquier regalo que no tenga una alerta específica, según su valor en monedas.</p>
            {globalAlerts.length > 0 ? (
              <div className="flex flex-col gap-2">
                {globalAlerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} giftIcon={giftIconFor(alert)} testFire={testFire} previewSaved={previewSaved} startEdit={startEdit} remove={remove} />
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-xs italic">Todavía no tienes alertas generales.</p>
            )}
          </section>
        </>
      )}
    </>
  );

  // ── Vista 2: FORMULARIO (nueva / edición) ──────────────────
  const formView = (
    <>
      <div className="w-full max-w-2xl">
        <button type="button" onClick={closeForm} className="text-[11px] font-bold text-gray-400 hover:text-white mb-3 inline-flex items-center gap-1">
          ← Volver a mis alertas
        </button>
        <div className="flex items-center gap-3">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <div>
            <h1 className="theme-heading text-2xl font-semibold tracking-wide">{editingId ? 'Editar alerta' : 'Nueva alerta'}</h1>
            <p className="text-xs text-gray-500">
              {editingId
                ? 'Cambia lo que quieras, incluido el disparador. Si eliges uno que ya tiene otra alerta, tendrás que resolverlo antes de guardar.'
                : 'Completa los pasos y mira cómo queda en la vista previa antes de guardar.'}
            </p>
          </div>
        </div>
      </div>

      <FormSection step="1" title="¿Cuándo se dispara?" hint="Elige qué evento activa esta alerta.">
        <div className="flex gap-2 flex-wrap">
          {TRIGGER_TYPES.map((t) => (
            <button key={t.id} type="button"
              onClick={() => { setTriggerType(t.id); if (t.id !== 'gift') setSelectedGift(null); if (t.id !== 'gift_global') setMinCoins(''); }}
              aria-pressed={triggerType === t.id}
              className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${triggerType === t.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {triggerType === 'gift_global' && (
          <p className="text-[11px] text-gray-500 mt-3">
            Se dispara con cualquier regalo que NO tenga su propia alerta específica y cuyo valor en monedas alcance el mínimo de abajo. Nunca compite con una alerta específica: si el regalo tiene la suya, esa gana siempre.
          </p>
        )}
        {triggerType !== 'gift' && triggerType !== 'gift_global' && conflictForTrigger(triggerType) && (
          <p className="text-[11px] text-amber-500 mt-3">Ya existe una alerta para "{TRIGGER_LABELS[triggerType]}" — bórrala o elige otro disparador antes de guardar.</p>
        )}

        {triggerType === 'gift_global' && (
          <div className="mt-4">
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🪙 MÍNIMO DE MONEDAS</label>
            <input
              type="number" min="1" max={MIN_COINS_CAP} step="1"
              value={minCoins}
              onChange={(e) => setMinCoins(e.target.value)}
              placeholder="Ej: 1"
              className="theme-input w-full p-3 outline-none text-sm text-white"
            />
            {minCoins !== '' && conflictForMinCoins(Number(minCoins)) && (
              <p className="text-[11px] text-amber-500 mt-2">Ya existe una alerta general para {minCoins} monedas — bórrala o elige otro mínimo antes de guardar.</p>
            )}
          </div>
        )}

        {triggerType === 'gift' && (
          <div className="mt-4 relative z-20">
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎁 REGALO</label>
            <GiftPicker
              gifts={giftsList.filter((g) => g.coins > 0)}
              selected={selectedGift}
              onSelect={setSelectedGift}
              placeholder="Elige un regalo..."
              emptyText="Conecta TikTok LIVE para cargar los regalos. Puedes guardar esta alerta ahora y asignarle un regalo después."
              renderBadge={(gift) => conflictForTrigger(gift.name) && <span className="theme-chip text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex-shrink-0">ya tiene alerta</span>}
            />
            {!selectedGift && <p className="text-xs text-gray-400 mt-2">Puedes guardar la alerta sin regalo y editarla para asignarlo cuando estés conectado a TikTok LIVE.</p>}
          </div>
        )}
      </FormSection>

      <FormSection step="2" title="¿Qué se muestra?" hint="Usa uno, dos o los tres. Con que haya al menos uno, ya vale.">
        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🖼️ VISUAL (imagen, gif o video)</label>
          {visualFile ? (
            <div className="theme-input flex items-center justify-between gap-2 p-2 mb-2">
              <span className="text-[11px] text-gray-400 truncate">📎 {visualFile.name}</span>
              <button
                type="button"
                onClick={() => { setVisualFile(null); if (visualInputRef.current) visualInputRef.current.value = ''; }}
                className="text-red-400 hover:text-red-300 font-black text-sm flex-shrink-0 leading-none"
                title="Quitar este archivo" aria-label="Quitar archivo elegido"
              >✕</button>
            </div>
          ) : effectiveVisualUrl ? (
            <div className="theme-input flex items-center justify-between p-2 mb-2">
              <span className="text-[11px] text-gray-400">{VISUAL_TYPE_ICON[effectiveVisualType] || '📎'} Ya tiene un archivo guardado</span>
              <button type="button" onClick={() => setClearVisual(true)} className="text-[11px] font-bold text-red-400 hover:text-red-300 underline">Quitar</button>
            </div>
          ) : null}
          <input
            ref={visualInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            onChange={(e) => { setVisualFile(e.target.files?.[0] || null); setClearVisual(false); }}
            className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase"
          />
          <p className="text-[11px] text-gray-500 mt-1">PNG/JPG/WebP, GIF, o video (MP4/WebM) — hasta 15MB.</p>
          {effectiveVisualType === 'video' && (
            <label className="flex items-center gap-2 mt-2 text-[11px] text-gray-400 cursor-pointer">
              <input type="checkbox" checked={visualMuted} onChange={(e) => setVisualMuted(e.target.checked)} />
              Mutear el video (útil si vas a poner un audio aparte abajo)
            </label>
          )}
        </div>

        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎧 AUDIO</label>
          {audioFile ? (
            <div className="theme-input flex items-center justify-between gap-2 p-2 mb-2">
              <span className="text-[11px] text-gray-400 truncate">🎧 {audioFile.name}</span>
              <button
                type="button"
                onClick={() => { setAudioFile(null); if (audioInputRef.current) audioInputRef.current.value = ''; }}
                className="text-red-400 hover:text-red-300 font-black text-sm flex-shrink-0 leading-none"
                title="Quitar este archivo" aria-label="Quitar archivo elegido"
              >✕</button>
            </div>
          ) : effectiveAudioUrl ? (
            <div className="theme-input flex items-center justify-between p-2 mb-2">
              <span className="text-[11px] text-gray-400">🎧 Ya tiene un audio guardado</span>
              <button type="button" onClick={() => setClearAudio(true)} className="text-[11px] font-bold text-red-400 hover:text-red-300 underline">Quitar</button>
            </div>
          ) : null}
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp3,audio/ogg"
            onChange={(e) => { setAudioFile(e.target.files?.[0] || null); setClearAudio(false); }}
            className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase"
          />
          <p className="text-[11px] text-gray-500 mt-1">MP3/WAV/OGG — hasta 15MB. Suena junto al visual, sin importar si el video tiene su propio audio o está mudo.</p>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">💬 TEXTO</label>
          <textarea
            value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))} rows={2}
            placeholder="Ej: ¡Gracias por el {gift}, {username}!"
            className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 text-sm resize-none"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Puedes usar estos datos, que se reemplazan al dispararse:{' '}
            <code className="theme-chip px-1 py-0.5 rounded text-[10px]">{'{username}'}</code>{' '}
            <code className="theme-chip px-1 py-0.5 rounded text-[10px]">{'{nickname}'}</code>{' '}
            <code className="theme-chip px-1 py-0.5 rounded text-[10px]">{'{gift}'}</code>{' '}
            <code className="theme-chip px-1 py-0.5 rounded text-[10px]">{'{coins}'}</code>{' '}
            <code className="theme-chip px-1 py-0.5 rounded text-[10px]">{'{count}'}</code>
            {' '}(usuario, su nombre público, el regalo, sus monedas y cuántas veces seguidas lo mandó).
          </p>
          <p className="text-[10px] text-gray-500 mt-1 text-right">{text.length}/{MAX_TEXT_LENGTH}</p>
          <div className="mt-2">
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">🎨 COLOR DEL TEXTO DE ESTA ALERTA</label>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                <input type="radio" name="alert-text-color" checked={!textColor} onChange={() => setTextColor('')} />
                Usar el estilo general
              </label>
              <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                <input type="radio" name="alert-text-color" checked={!!textColor} onChange={() => setTextColor(textColor || '#FFFFFF')} />
                Color propio
              </label>
              {textColor && (
                <input
                  type="color" value={textColor} onChange={(e) => setTextColor(e.target.value.toUpperCase())}
                  aria-label="Elegir el color del texto de esta alerta"
                  className="w-9 h-9 rounded cursor-pointer border-0 bg-transparent p-0"
                />
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Este color es solo de esta alerta. El tamaño, el degradado y el estilo general de todas se cambian con "🎨 Personalizar" en los ajustes generales de la lista.</p>
          </div>
          {effectiveVisualUrl && (
            <div className="mt-2">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">Posición del texto respecto al recurso</label>
              <div className="flex gap-2 flex-wrap">
                {TEXT_POSITIONS.map((p) => (
                  <button key={p.id} type="button" onClick={() => setTextPosition(p.id)} aria-pressed={textPosition === p.id}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${textPosition === p.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </FormSection>

      <FormSection step="3" title="¿Cómo aparece?" hint="La vista previa se actualiza sola con cada cambio.">
        <div className="mb-5">
          <LivePreview draftAlert={draftAlert} customize={customization} />
        </div>

        <div className="mb-5">
          <div className="flex justify-between items-center mb-1">
            <label className="theme-label text-[10px] uppercase tracking-widest font-semibold" htmlFor="alert-duration">DURACIÓN EN PANTALLA</label>
            <span className="theme-chip font-bold px-2 rounded text-xs">{duration}s</span>
          </div>
          <input id="alert-duration" type="range" min="1" max={MAX_DURATION_S} step="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full" />
          <p className="text-[11px] text-gray-500 mt-1">Máximo {MAX_DURATION_S}s por alerta.</p>
        </div>

        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">POSICIÓN EN PANTALLA</label>
          <div className="flex gap-2 flex-wrap">
            {POSITIONS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPosition(p.id)} aria-pressed={position === p.id}
                className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${position === p.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">✨ ANIMACIÓN DE ENTRADA</label>
            <div className="flex gap-2 flex-wrap">
              {ANIMATION_IN_OPTIONS.map((a) => (
                <button key={a.id} type="button" onClick={() => setEntranceAnim(a.id)} aria-pressed={entranceAnim === a.id}
                  className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${entranceAnim === a.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">✨ ANIMACIÓN DE SALIDA</label>
            <div className="flex gap-2 flex-wrap">
              {ANIMATION_OUT_OPTIONS.map((a) => (
                <button key={a.id} type="button" onClick={() => setExitAnim(a.id)} aria-pressed={exitAnim === a.id}
                  className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${exitAnim === a.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </FormSection>

      {/* Barra de acciones siempre a la vista: en un formulario largo el
          botón de guardar no debe quedar perdido hasta el final. */}
      <div className="sticky bottom-0 z-30 w-full max-w-2xl pb-2">
        <div className="theme-surface p-3">
          {error && <p role="alert" className="text-[11px] font-bold text-red-500 mb-2 px-1">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="theme-btn-primary flex-1 py-3 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'GUARDANDO...' : editingId ? 'GUARDAR CAMBIOS' : 'GUARDAR ALERTA'}
            </button>
            <button onClick={closeForm} type="button" className="theme-btn-secondary px-5 py-3 rounded-xl font-bold tracking-wide text-xs uppercase">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div ref={rootRef} className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      {view === 'form' ? formView : listView}

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
