import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  RAINBOW_GRADIENT, VALID_MESSAGE_ANIMATIONS, MESSAGE_ANIMATION_LABELS, bordersEnabled,
  LABEL_SCALE_LABELS, OVERLAY_FONTS, ensureOverlayFont,
  OVERLAY_STYLE_PRESETS, applyOverlayPreset, matchOverlayPreset, resetOverlayVisual, backgroundNeedsLightInk,
} from './overlayCustomization';
import OverlayPreviewBox from './OverlayPreviewBox';
import { NATURAL_SIZE, PREVIEW_BACKDROPS } from './overlayPreview';

// Personalizar un overlay (rediseño, pedido explícito: "configurar cada
// overlay para que se vea bien es innecesariamente complicado").
// - Primero, un ESTILO listo (Clásico, Sobre tu escena, Neón, Arcade, Fiesta):
//   una elección deja fondo, bordes, colores de texto y fuente combinados y
//   legibles. Después se puede ajustar cualquier cosa; el estilo pasa a
//   "Personalizado" y los cambios se conservan (ver OVERLAY_STYLE_PRESETS).
// - Los ajustes a mano van en pestañas (Fondo, Texto, Fuente y, en el Chat,
//   Mensajes) en vez de todos a la vez.
// - Cada control dice qué pinta EN ESTE overlay (en Versus el "color de
//   nombres" es el del marcador, en la tira de regalos el del apodo...), y no
//   aparece donde no hace nada.
// - Vista previa con el overlay real a escala, sobre un fondo de referencia
//   (oscuro, claro o cuadrícula) para juzgar el modo transparente.
// - Se guarda solo (App.jsx lo persiste y lo manda por socket al overlay de
//   OBS); el pie dice si se guardó o si falta conexión. Un estilo, restablecer
//   o "aplicar a todos" se pueden deshacer.

// Qué pinta cada control de texto en cada overlay. `names: null` = ese
// overlay no tiene nombres de usuario (su título sigue el control de títulos).
const TEXT_ROLES = {
  games: { names: { title: 'Nombres de usuario', hint: 'El @ de quien participa' }, labels: { title: 'Títulos y etiquetas', hint: '"Roba el lugar con", "Tiempo"...' } },
  colors: { names: null, labels: { title: 'Título y textos', hint: 'El título "ColorSays" y lo demás' } },
  taptap: { names: { title: 'Nombres de usuario', hint: 'Cada fila del ranking' }, labels: { title: 'Título y textos', hint: 'El encabezado del ranking' } },
  gifter: { names: { title: 'Nombres de usuario', hint: 'Cada fila del ranking' }, labels: { title: 'Título y textos', hint: 'El encabezado del ranking' } },
  extensible: { names: null, labels: { title: 'Título y textos', hint: 'El título y las etiquetas del contador' } },
  musicqueue: { names: { title: 'Quién pidió cada canción', hint: 'El @ debajo de cada canción' }, labels: { title: 'Título y textos', hint: 'El encabezado de la cola' } },
  goal: { names: null, labels: { title: 'Título y textos', hint: 'El título de la meta y el progreso' } },
  chat: { names: { title: 'Nombres en el chat', hint: 'Quién escribe cada mensaje' }, labels: { title: 'Textos fijos', hint: '"Chat en vivo" y el contador' } },
  ticker: { names: { title: 'Apodo de cada regalo', hint: 'El texto que corre en la tira' }, labels: { title: 'Textos fijos', hint: 'El aviso cuando no hay regalos' } },
  versus: { names: { title: 'Marcador', hint: 'Las monedas de cada lado' }, labels: { title: 'Títulos y acción', hint: '"Héroes", "Villanos" y la acción' } },
  alerts: { names: { title: 'Texto de la alerta', hint: 'El mensaje que escribes en cada alerta' }, labels: null },
};

const BG_OPTIONS = [
  { id: 'solid', label: 'Del tema', title: 'El color de tu tema' },
  { id: 'transparent', label: 'Transparente', title: 'Sin fondo: el overlay y todas sus cajas quedan transparentes' },
  { id: 'gradient', label: 'Degradado', title: 'Tus dos colores' },
  { id: 'rainbow', label: 'Arcoíris', title: 'Degradado en movimiento' },
];

const COLOR_OPTIONS = [
  { id: 'default', label: 'Original' },
  { id: 'theme', label: 'Del tema' },
  { id: 'custom', label: 'Un color' },
  { id: 'gradient', label: 'Degradado' },
  { id: 'rainbow', label: 'Arcoíris' },
];

const NAME_SIZES = [
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Grande' },
  { id: 'xlarge', label: 'Extra grande' },
];
const LABEL_SIZES = Object.entries(LABEL_SCALE_LABELS).map(([id, label]) => ({ id, label }));

const BACKDROP_KEY = 'tkc_preview_backdrop';
function loadBackdrop() {
  try { const v = localStorage.getItem(BACKDROP_KEY); return PREVIEW_BACKDROPS[v] ? v : 'dark'; } catch { return 'dark'; }
}

// Pantalla angosta: la vista previa queda fija arriba y más baja.
function useNarrow() {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

// Fila de botones de una sola elección (como pestañas chicas).
function Segmented({ options, value, onChange, label, renderSwatch }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={[
              'tkc-seg h-8 px-2.5 rounded-lg border text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5',
              active ? 'theme-nav-btn-active theme-accent-text' : 'text-gray-500',
            ].join(' ')}
            style={active ? undefined : { borderColor: 'var(--surface-border-color)' }}
          >
            {renderSwatch?.(opt.id)}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-gray-400">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 cursor-pointer" />
      {label}
    </label>
  );
}

// Muestra chiquita del color/degradado de cada opción de texto.
function TextSwatch({ type, color, from, to }) {
  const base = 'w-3 h-3 rounded-full flex-shrink-0 border border-black/10';
  if (type === 'default') return <span className={base} style={{ background: 'var(--ink, currentColor)' }} />;
  if (type === 'theme') return <span className={base} style={{ background: 'var(--accent)' }} />;
  if (type === 'custom') return <span className={base} style={{ background: color || '#FFFFFF' }} />;
  if (type === 'gradient') return <span className={base} style={{ background: `linear-gradient(90deg, ${from || '#7C3AED'}, ${to || '#3B82F6'})` }} />;
  return <span className={base} style={{ backgroundImage: RAINBOW_GRADIENT }} />;
}

// Color + tamaño de un tipo de texto (nombres o títulos), con su rol.
function TextStyleControl({ role, value, onPatch, sizes }) {
  const v = value || { type: 'default' };
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h4 className="text-sm font-black text-white leading-tight">{role.title}</h4>
        <p className="tkc-hint">{role.hint}</p>
      </div>
      <Segmented
        label={`Color: ${role.title}`} options={COLOR_OPTIONS} value={v.type || 'default'}
        onChange={(type) => onPatch({ type })}
        renderSwatch={(type) => <TextSwatch type={type} color={v.color} from={v.from} to={v.to} />}
      />
      {v.type === 'custom' && <ColorInput label="Color" value={v.color || '#FFFFFF'} onChange={(color) => onPatch({ color })} />}
      {v.type === 'gradient' && (
        <div className="flex flex-wrap gap-4">
          <ColorInput label="Inicio" value={v.from || '#7C3AED'} onChange={(from) => onPatch({ from })} />
          <ColorInput label="Final" value={v.to || '#3B82F6'} onChange={(to) => onPatch({ to })} />
        </div>
      )}
      <Segmented label={`Tamaño: ${role.title}`} options={sizes} value={v.fontSize || 'normal'} onChange={(fontSize) => onPatch({ fontSize })} />
    </section>
  );
}

// Miniatura de un estilo: su fondo, un "Aa" con el color de los nombres y una
// barra con el de los títulos, en su fuente. Se pinta con estilos en línea y
// sin clases de color del tema (que forzarían la tinta del panel).
function presetSample(values) {
  const bg = values.background;
  const lightInk = backgroundNeedsLightInk(values);
  const ink = lightInk ? '#F8F5FF' : 'var(--ink, #2E2136)';
  const paint = (t, fallback) => {
    if (t.type === 'custom') return { color: t.color };
    if (t.type === 'theme') return { color: 'var(--accent)' };
    if (t.type === 'rainbow') return { backgroundImage: RAINBOW_GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };
    return { color: fallback };
  };
  // Transparente: cuadrícula oscura, como una escena real detrás (sobre la
  // clara, el texto blanco del estilo no se distinguía en la muestra).
  const background = bg.type === 'transparent' ? 'repeating-conic-gradient(#3B3450 0% 25%, #2A2438 0% 50%) 50% / 12px 12px'
    : bg.type === 'gradient' ? `linear-gradient(135deg, ${bg.from}, ${bg.to})`
      : bg.type === 'rainbow' ? RAINBOW_GRADIENT : 'var(--surface-bg)';
  return {
    frame: { background, fontFamily: OVERLAY_FONTS[values.font]?.family || undefined, border: values.borders ? '1px solid var(--surface-border-color)' : '1px solid transparent' },
    name: paint(values.usernameColor, lightInk ? '#F8F5FF' : '#000000'),
    label: paint(values.labelText, ink),
    shadow: bg.type === 'transparent' ? { textShadow: '0 1px 3px rgba(0,0,0,0.55)' } : {},
  };
}

function PresetPicker({ activeId, onPick }) {
  return (
    <div role="radiogroup" aria-label="Estilo" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {OVERLAY_STYLE_PRESETS.map((p) => {
        const sample = presetSample(p.values);
        const active = activeId === p.id;
        return (
          <button
            key={p.id} type="button" role="radio" aria-checked={active} onClick={() => onPick(p.id)}
            className={['tkc-preset text-left rounded-xl border p-1.5 flex flex-col gap-1.5', active ? 'theme-nav-btn-active' : ''].join(' ')}
            style={active ? undefined : { borderColor: 'var(--surface-border-color)' }}
          >
            <span className="tkc-ovl-fill relative h-12 rounded-lg overflow-hidden flex items-center justify-between gap-1 px-2.5" style={sample.frame} aria-hidden="true">
              <span className="text-lg font-black leading-none" style={{ ...sample.name, ...sample.shadow }}>Aa</span>
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ ...sample.label, ...sample.shadow }}>Top 1</span>
            </span>
            <span className="px-1 pb-0.5">
              <span className={`block text-xs font-black leading-tight ${active ? 'theme-accent-text' : 'text-white'}`}>{p.label}</span>
              <span className="tkc-hint block truncate">{p.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const TABS = [
  { id: 'background', label: 'Fondo' },
  { id: 'text', label: 'Texto' },
  { id: 'font', label: 'Fuente' },
  { id: 'messages', label: 'Mensajes', only: 'chat' },
];

export default function OverlayCustomizePanel({ title, overlayId, entry, onChange, onApplyToAll, onClose, liveState, hideBackground, connected = true }) {
  const bg = entry?.background || { type: 'solid' };
  const uc = entry?.usernameColor || { type: 'default' };
  const lt = entry?.labelText || { type: 'default' };
  const bordersOn = bordersEnabled(entry);
  const font = entry?.font || 'sora';
  const roles = TEXT_ROLES[overlayId] || TEXT_ROLES.games;
  const activePreset = matchOverlayPreset(entry);
  const narrow = useNarrow();
  const size = NATURAL_SIZE[overlayId];

  const tabs = TABS.filter((t) => (!t.only || t.only === overlayId) && !(hideBackground && t.id === 'background'));
  const [tab, setTab] = useState(tabs[0].id);
  const [backdrop, setBackdropState] = useState(loadBackdrop);
  const setBackdrop = (id) => { setBackdropState(id); try { localStorage.setItem(BACKDROP_KEY, id); } catch { /* sin storage */ } };

  // Deshacer: el aspecto que había antes de un estilo, restablecer o "aplicar
  // a todos". Un ajuste a mano lo descarta (deshacer ya no sería lo esperado).
  const [undo, setUndo] = useState(null);
  const change = (next) => { setUndo(null); onChange(next); };
  const bigChange = (next, label) => { setUndo({ entry, label }); onChange(next); };

  const setBg = (patch) => change({ ...entry, background: { ...bg, ...patch } });
  const setUc = (patch) => change({ ...entry, usernameColor: { ...uc, ...patch } });
  const setLt = (patch) => change({ ...entry, labelText: { ...lt, ...patch } });

  // "Guardando..." un momento después de cada cambio (App.jsx lo manda al
  // servidor con 300ms de espera) y luego "Guardado".
  const [saving, setSaving] = useState(false);
  // Por contenido, no por objeto: cuando el servidor devuelve el mismo mapa
  // llega un objeto nuevo igual al anterior, y eso no es un cambio.
  const signature = JSON.stringify(entry);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    setSaving(true);
    const t = setTimeout(() => setSaving(false), 700);
    return () => clearTimeout(t);
  }, [signature]);

  // Las muestras de fuente se pintan con su propia letra: se descargan al
  // abrir el panel (solo aquí; un overlay pide únicamente la que usa).
  useEffect(() => { Object.keys(OVERLAY_FONTS).forEach(ensureOverlayFont); }, []);
  // Al abrir, el foco entra al diálogo (para el teclado y los lectores de
  // pantalla); al cerrar, vuelve a donde estaba (el botón que lo abrió).
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true });
    return () => { if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true }); };
  }, []);
  // Esc cierra, como cualquier ventana emergente.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyToAll = () => {
    if (!window.confirm('¿Usar este mismo aspecto (fondo, bordes, colores de texto y fuente) en todos tus overlays? El volumen de las Alertas y la animación del Chat no cambian.')) return;
    onApplyToAll();
  };

  const status = !connected
    ? { tone: 'warning', text: 'Sin conexión con el servidor: el cambio se guarda aquí y se envía a OBS al reconectar.' }
    : saving
      ? { tone: 'muted', text: 'Guardando…' }
      : { tone: 'success', text: 'Guardado. OBS lo muestra al instante.' };

  const preview = overlayId !== 'alerts' && (
    <div
      // En pantalla angosta queda fija arriba y baja (un 22% del alto, hasta
      // 180px): así se ven los cambios sin perder la mayor parte de la pantalla.
      className={['flex flex-col gap-2 md:border-r md:overflow-y-auto', narrow ? 'sticky top-0 z-10 border-b px-4 py-3' : 'p-4 sm:p-5'].join(' ')}
      style={{ borderColor: 'var(--surface-border-color)', ...(narrow ? { background: 'var(--surface-bg)' } : {}) }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="tkc-label text-gray-500">Vista previa{size ? ` · ${size.w}×${size.h}` : ''}</p>
        <div role="radiogroup" aria-label="Fondo de la vista previa" className="flex gap-1">
          {Object.entries(PREVIEW_BACKDROPS).map(([id, b]) => (
            <button
              key={id} type="button" role="radio" aria-checked={backdrop === id} title={`Ver sobre un fondo ${b.label.toLowerCase()}`}
              aria-label={`Fondo ${b.label.toLowerCase()}`} onClick={() => setBackdrop(id)}
              className={['w-6 h-6 rounded-md border-2', backdrop === id ? '' : 'opacity-70'].join(' ')}
              style={{ ...b.style, borderColor: backdrop === id ? 'var(--accent)' : 'var(--surface-border-color)' }}
            />
          ))}
        </div>
      </div>
      <OverlayPreviewBox overlayId={overlayId} entry={entry} liveState={liveState} backdrop={backdrop} maxHeight={narrow ? Math.min(180, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.22)) : 440} />
      {!narrow && <p className="tkc-hint">Con datos de prueba, a escala. Cambia el fondo de referencia para ver cómo queda sobre tu escena.</p>}
    </div>
  );

  // Se monta en #tkc-modal-root (ver App.jsx) para quedar encima del botón
  // flotante; si no existe (pruebas aisladas), en su lugar de siempre.
  const modalRoot = typeof document !== 'undefined' ? document.getElementById('tkc-modal-root') : null;
  const modal = (
    <div className="tkc-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={`Personalizar: ${title}`} ref={dialogRef} tabIndex={-1}
        className="theme-surface outline-none w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
          <div className="min-w-0">
            <p className="theme-accent-text tkc-eyebrow">Personalizar</p>
            <h2 className="theme-heading text-base font-black truncate">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-500 hover:text-gray-300 text-xl leading-none flex-shrink-0 w-9 h-9 rounded-lg">✕</button>
        </header>

        <div className={`flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:grid ${overlayId === 'alerts' ? '' : 'md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'}`}>
          {preview}

          <div className="p-4 sm:p-5 flex flex-col gap-5 md:overflow-y-auto">
            {!hideBackground && (
              <section className="flex flex-col gap-2" aria-labelledby="ovl-style-title">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="ovl-style-title" className="tkc-label theme-label">Estilo</h3>
                  <span className="tkc-hint">{activePreset ? 'Puedes ajustarlo abajo' : 'Personalizado: tus ajustes se conservan'}</span>
                </div>
                <PresetPicker activeId={activePreset} onPick={(id) => bigChange(applyOverlayPreset(entry, id), `aplicar el estilo ${OVERLAY_STYLE_PRESETS.find((p) => p.id === id)?.label}`)} />
              </section>
            )}

            <section className="flex flex-col gap-3" aria-label="Ajustes a mano">
              <div role="tablist" aria-label="Ajustes" className="flex gap-1 p-1 rounded-xl theme-input">
                {tabs.map((t) => (
                  <button
                    key={t.id} type="button" role="tab" aria-selected={tab === t.id} id={`ovl-tab-${t.id}`} aria-controls={`ovl-panel-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={['tkc-seg flex-1 h-8 rounded-lg text-[11px] font-black uppercase tracking-wider', tab === t.id ? 'theme-nav-btn-active theme-accent-text border' : 'text-gray-500'].join(' ')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div role="tabpanel" id={`ovl-panel-${tab}`} aria-labelledby={`ovl-tab-${tab}`} className="flex flex-col gap-4 tkc-msg-enter" key={tab}>
                {tab === 'background' && (
                  <>
                    <Segmented
                      label="Fondo" options={BG_OPTIONS} value={bg.type} onChange={(type) => setBg({ type })}
                      renderSwatch={(type) => {
                        if (type === 'transparent') return <span className="w-3 h-3 rounded-sm flex-shrink-0 border border-dashed border-current opacity-60" />;
                        if (type === 'solid') return <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border-color)' }} />;
                        if (type === 'gradient') return <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: `linear-gradient(135deg, ${bg.from || '#7C3AED'}, ${bg.to || '#3B82F6'})` }} />;
                        return <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundImage: RAINBOW_GRADIENT }} />;
                      }}
                    />
                    {bg.type === 'gradient' && (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4">
                          <ColorInput label="Inicio" value={bg.from || '#7C3AED'} onChange={(from) => setBg({ from })} />
                          <ColorInput label="Final" value={bg.to || '#3B82F6'} onChange={(to) => setBg({ to })} />
                        </div>
                        <p className="tkc-hint">
                          {backgroundNeedsLightInk(entry)
                            ? 'Fondo oscuro: los textos del overlay pasan solos a claro para leerse bien.'
                            : 'Fondo claro: los textos del overlay se quedan oscuros para leerse bien.'}
                        </p>
                      </div>
                    )}
                    {bg.type === 'transparent' && <p className="tkc-hint">Todas las cajas de adentro también quedan sin fondo; el texto lleva una sombra suave para leerse sobre tu escena. Prueba el fondo claro de la vista previa.</p>}
                    {bg.type === 'rainbow' && <p className="tkc-hint">Se mueve solo, en bucle. Para que los nombres se lean, evita ponerlos también en arcoíris.</p>}
                    <button
                      type="button" role="switch" aria-checked={bordersOn}
                      onClick={() => change({ ...entry, borders: !bordersOn })}
                      className="flex items-center justify-between gap-3 py-1 text-left"
                    >
                      <span>
                        <span className="block text-sm font-black text-white">Bordes y separadores</span>
                        <span className="tkc-hint block">El marco del overlay y las líneas entre filas</span>
                      </span>
                      <span className="tkc-switch" data-on={bordersOn ? 'true' : 'false'} aria-hidden="true" />
                    </button>
                  </>
                )}

                {tab === 'text' && (
                  <>
                    {roles.names && <TextStyleControl role={roles.names} value={uc} onPatch={setUc} sizes={NAME_SIZES} />}
                    {roles.labels && <TextStyleControl role={roles.labels} value={lt} onPatch={setLt} sizes={LABEL_SIZES} />}
                  </>
                )}

                {tab === 'font' && (
                  <div role="radiogroup" aria-label="Fuente del overlay" className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {Object.entries(OVERLAY_FONTS).map(([id, f]) => {
                      const active = font === id;
                      return (
                        <button
                          key={id} type="button" role="radio" aria-checked={active}
                          onClick={() => change({ ...entry, font: id })}
                          className={['tkc-seg rounded-lg border px-2.5 py-2 text-left', active ? 'theme-nav-btn-active' : ''].join(' ')}
                          style={active ? undefined : { borderColor: 'var(--surface-border-color)' }}
                        >
                          <span className={`block text-lg leading-none font-bold ${active ? 'theme-accent-text' : 'text-white'}`} style={f.family ? { fontFamily: f.family } : undefined}>Aa 123</span>
                          <span className="tkc-hint block mt-1 truncate">{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {tab === 'messages' && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-black text-white">Cómo entra cada mensaje nuevo</p>
                    <Segmented
                      label="Animación de los mensajes"
                      options={VALID_MESSAGE_ANIMATIONS.map((id) => ({ id, label: MESSAGE_ANIMATION_LABELS[id] }))}
                      value={entry?.messageAnimation || 'fade'}
                      onChange={(id) => change({ ...entry, messageAnimation: id })}
                    />
                    <p className="tkc-hint">Cuánto dura cada mensaje, el orden y el tamaño de letra se eligen en TikTokEvents → Chat.</p>
                  </div>
                )}
              </div>
            </section>

            <details className="tkc-more rounded-xl theme-input px-3 py-2">
              <summary className="cursor-pointer tkc-label text-gray-400 py-1">Más opciones</summary>
              <div className="flex flex-col sm:flex-row gap-2 pt-2 pb-1">
                {/* Las Alertas no tienen fondo propio: llevar su aspecto a los
                    demás les pondría un fondo que nunca se ve en ellas. */}
                {!hideBackground && (
                  <button type="button" onClick={applyToAll} className="theme-btn-secondary theme-btn-sm flex-1 font-black uppercase tracking-widest">
                    Usar este aspecto en todos
                  </button>
                )}
                <button type="button" onClick={() => bigChange(resetOverlayVisual(entry), 'restablecer')} className="theme-btn-secondary theme-btn-sm flex-1 font-black uppercase tracking-widest">
                  Restablecer este overlay
                </button>
              </div>
            </details>
          </div>
        </div>

        <footer className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 sm:px-5 py-3 border-t" style={{ borderColor: 'var(--surface-border-color)' }}>
          <p role="status" aria-live="polite" className={`flex-1 text-xs font-bold ${status.tone === 'warning' ? 'text-amber-600' : status.tone === 'success' ? 'text-emerald-600' : 'text-gray-500'}`}>
            {status.text}
          </p>
          <div className="flex gap-2">
            {undo && (
              <button type="button" onClick={() => { onChange(undo.entry); setUndo(null); }} title={`Volver a como estaba antes de ${undo.label}`} className="theme-btn-secondary theme-btn-md font-black uppercase tracking-widest tkc-pop">
                Deshacer
              </button>
            )}
            <button type="button" onClick={onClose} className="theme-btn-primary theme-btn-md flex-1 sm:flex-none sm:min-w-[8rem] font-black uppercase tracking-widest">
              Listo
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
  return modalRoot ? createPortal(modal, modalRoot) : modal;
}
