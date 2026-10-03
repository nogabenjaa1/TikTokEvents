import { useEffect } from 'react';
import {
  RAINBOW_GRADIENT, VALID_MESSAGE_ANIMATIONS, MESSAGE_ANIMATION_LABELS, bordersEnabled,
  LABEL_SCALE_LABELS, OVERLAY_FONTS, ensureOverlayFont,
} from './overlayCustomization';
import OverlayPreviewBox from './OverlayPreviewBox';

// Modal de personalización de un overlay (rediseño compacto, pedido
// explícito): la vista previa queda fija a un lado mientras se ajusta todo lo
// demás, y cada grupo de opciones es una fila de botones en vez de una lista
// alta de opciones con radio. Además de fondo, bordes, color/tamaño del
// nombre de usuario y animación del chat, ahora se personalizan los TEXTOS
// FIJOS del overlay (títulos, etiquetas, la acción de Versus) y la FUENTE de
// todo el overlay. Cada cambio se aplica al instante; App.jsx persiste y lo
// manda por socket al overlay de OBS.

const BG_OPTIONS = [
  { id: 'transparent', label: 'Transparente', title: 'Sin fondo: el overlay y todas sus cajas quedan transparentes' },
  { id: 'solid', label: 'Del tema', title: 'El color de tu tema' },
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

function Section({ title, hint, children }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-widest text-gray-500 font-black">{title}</h3>
        {hint && <span className="text-[10px] text-gray-500 text-right">{hint}</span>}
      </div>
      {children}
    </section>
  );
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
              'h-8 px-2.5 rounded-lg border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors',
              active ? 'theme-nav-btn-active theme-accent-text' : 'text-gray-500 hover:text-gray-300',
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
    <label className="flex items-center gap-2 text-[11px] text-gray-400">
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

// El mismo control sirve para el nombre de usuario y para los textos fijos.
function TextStyleControl({ value, onPatch, sizes, label }) {
  const v = value || { type: 'default' };
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label={`Color: ${label}`} options={COLOR_OPTIONS} value={v.type || 'default'}
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
      <Segmented label={`Tamaño: ${label}`} options={sizes} value={v.fontSize || 'normal'} onChange={(fontSize) => onPatch({ fontSize })} />
    </div>
  );
}

export default function OverlayCustomizePanel({ title, overlayId, entry, onChange, onApplyToAll, onClose, liveState, hideBackground }) {
  const bg = entry?.background || { type: 'solid' };
  const uc = entry?.usernameColor || { type: 'default' };
  const lt = entry?.labelText || { type: 'default' };
  const bordersOn = bordersEnabled(entry);
  const font = entry?.font || 'sora';

  const setBg = (patch) => onChange({ ...entry, background: { ...bg, ...patch } });
  const setUc = (patch) => onChange({ ...entry, usernameColor: { ...uc, ...patch } });
  const setLt = (patch) => onChange({ ...entry, labelText: { ...lt, ...patch } });

  // Las muestras de fuente se pintan con su propia letra: se descargan al
  // abrir el panel (solo aquí; un overlay pide únicamente la que usa).
  useEffect(() => { Object.keys(OVERLAY_FONTS).forEach(ensureOverlayFont); }, []);
  // Esc cierra, como cualquier ventana emergente.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tkc-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={`Personalizar: ${title}`}
        className="theme-surface w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
          <div className="min-w-0">
            <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">Personalizar</p>
            <h2 className="theme-heading text-sm font-bold truncate">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-500 hover:text-gray-300 text-xl leading-none flex-shrink-0 px-1">✕</button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Vista previa con espectadores de prueba: se ve cada cambio sin
              estar en vivo. En pantallas anchas queda fija a la izquierda.
              Alertas tiene su propia vista previa (en AlertsAdmin.jsx). */}
          {overlayId !== 'alerts' && (
            <div className="p-5 md:border-r md:overflow-y-auto flex flex-col gap-2" style={{ borderColor: 'var(--surface-border-color)' }}>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Vista previa</p>
              <OverlayPreviewBox overlayId={overlayId} entry={entry} liveState={liveState} />
              <p className="text-[10px] text-gray-500 leading-snug">Con datos de prueba. Los cambios llegan al instante al overlay de OBS.</p>
            </div>
          )}

          <div className={`p-5 flex flex-col gap-5 md:overflow-y-auto ${overlayId === 'alerts' ? 'md:col-span-2' : ''}`}>
            {/* Las Alertas nunca tienen fondo ni marco propio. */}
            {!hideBackground && (
              <Section title="Fondo y bordes">
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
                  <div className="flex flex-wrap gap-4">
                    <ColorInput label="Inicio" value={bg.from || '#7C3AED'} onChange={(from) => setBg({ from })} />
                    <ColorInput label="Final" value={bg.to || '#3B82F6'} onChange={(to) => setBg({ to })} />
                  </div>
                )}
                {bg.type === 'transparent' && <p className="text-[10px] text-gray-500 leading-snug">Todas las cajas de adentro también quedan sin fondo; el texto lleva una sombra suave para leerse sobre tu escena.</p>}
                <button
                  type="button" role="switch" aria-checked={bordersOn}
                  onClick={() => onChange({ ...entry, borders: !bordersOn })}
                  className="flex items-center justify-between gap-3 py-1 text-left"
                >
                  <span className="text-xs font-bold text-white">Mostrar bordes y separadores</span>
                  <span className="tkc-switch" data-on={bordersOn ? 'true' : 'false'} aria-hidden="true" />
                </button>
              </Section>
            )}

            <Section title="Nombres de usuario" hint="El @ de cada espectador">
              <TextStyleControl value={uc} onPatch={setUc} sizes={NAME_SIZES} label="nombres de usuario" />
            </Section>

            {/* Las alertas no tienen textos fijos propios (su texto es el que
                escribe el streamer en cada alerta). */}
            {overlayId !== 'alerts' && (
              <Section title="Textos fijos" hint="Títulos, etiquetas, acciones">
                <TextStyleControl value={lt} onPatch={setLt} sizes={LABEL_SIZES} label="textos fijos" />
              </Section>
            )}

            <Section title="Fuente" hint="Todo el overlay">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {Object.entries(OVERLAY_FONTS).map(([id, f]) => {
                  const active = font === id;
                  return (
                    <button
                      key={id} type="button" aria-pressed={active}
                      onClick={() => onChange({ ...entry, font: id })}
                      className={['rounded-lg border px-2.5 py-2 text-left transition-colors', active ? 'theme-nav-btn-active' : 'hover:opacity-90'].join(' ')}
                      style={active ? undefined : { borderColor: 'var(--surface-border-color)' }}
                    >
                      <span className={`block text-lg leading-none font-bold ${active ? 'theme-accent-text' : 'text-white'}`} style={f.family ? { fontFamily: f.family } : undefined}>Aa 123</span>
                      <span className="block text-[10px] text-gray-500 mt-1 truncate">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Solo el Chat pinta una lista que crece mensaje a mensaje. */}
            {overlayId === 'chat' && (
              <Section title="Entrada de cada mensaje">
                <Segmented
                  label="Animación de los mensajes"
                  options={VALID_MESSAGE_ANIMATIONS.map((id) => ({ id, label: MESSAGE_ANIMATION_LABELS[id] }))}
                  value={entry?.messageAnimation || 'fade'}
                  onChange={(id) => onChange({ ...entry, messageAnimation: id })}
                />
              </Section>
            )}
          </div>
        </div>

        <footer className="flex flex-col-reverse sm:flex-row gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--surface-border-color)' }}>
          <button type="button" onClick={onApplyToAll} className="theme-btn-secondary theme-btn-md flex-1 font-black uppercase tracking-widest">
            Aplicar a todos los overlays
          </button>
          <button type="button" onClick={onClose} className="theme-btn-primary theme-btn-md flex-1 font-black uppercase tracking-widest">
            Listo
          </button>
        </footer>
      </div>
    </div>
  );
}
