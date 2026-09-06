import React from 'react';
import { RAINBOW_GRADIENT } from './overlayCustomization';

const BG_OPTIONS = [
  { id: 'transparent', label: 'Transparente', hint: 'Sin color de fondo' },
  { id: 'solid', label: 'Color sólido del tema', hint: 'El color principal del tema/skin que ya elegiste' },
  { id: 'gradient', label: 'Degradado personalizado', hint: 'Define tus propios dos colores' },
];

const NAME_OPTIONS = [
  { id: 'default', label: 'Predeterminado', hint: 'El color que ya trae este overlay' },
  { id: 'rainbow', label: 'Arcoíris' },
  { id: 'custom', label: 'Personalizado' },
];

function OptionRow({ active, onSelect, label, hint, children }) {
  return (
    <label
      className={['flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-colors', active ? 'theme-nav-btn-active' : 'border-transparent'].join(' ')}
      style={active ? undefined : { borderColor: 'var(--surface-border-color)' }}
    >
      <input type="radio" checked={active} onChange={onSelect} className="flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-white">{label}</span>
        {hint && <span className="block text-[10px] text-gray-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// Modal de personalización de un overlay individual — fondo (transparente /
// color sólido del tema / degradado propio) y color del nombre de usuario
// (predeterminado / arcoíris / personalizado). Se abre desde el botón
// "🎨 Personalizar" de cada tarjeta en OverlayLink.jsx. Cada cambio se
// aplica al instante (mismo criterio "en vivo" que el resto del panel, sin
// botón de guardar) — el padre (App.jsx) es quien persiste en localStorage
// y reemite por socket.
export default function OverlayCustomizePanel({ title, entry, onChange, onApplyToAll, onClose }) {
  const bg = entry?.background || { type: 'solid' };
  const uc = entry?.usernameColor || { type: 'default' };

  const setBg = (patch) => onChange({ ...entry, background: { ...bg, ...patch } });
  const setUc = (patch) => onChange({ ...entry, usernameColor: { ...uc, ...patch } });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="theme-surface w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="theme-heading text-base font-bold leading-tight">🎨 Personalizar<br /><span className="text-sm font-semibold text-gray-400">{title}</span></h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none flex-shrink-0">✕</button>
        </div>

        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Fondo del overlay</p>
        <div className="flex flex-col gap-2">
          {BG_OPTIONS.map((opt) => (
            <OptionRow key={opt.id} active={bg.type === opt.id} onSelect={() => setBg({ type: opt.id })} label={opt.label} hint={opt.hint} />
          ))}
        </div>

        {bg.type === 'gradient' && (
          <div className="flex items-center gap-6 mt-3 mb-1 px-1">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Color inicial
              <input type="color" value={bg.from || '#7C3AED'} onChange={(e) => setBg({ from: e.target.value })} className="w-9 h-9 rounded cursor-pointer border-0 bg-transparent p-0" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Color final
              <input type="color" value={bg.to || '#3B82F6'} onChange={(e) => setBg({ to: e.target.value })} className="w-9 h-9 rounded cursor-pointer border-0 bg-transparent p-0" />
            </label>
          </div>
        )}

        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2 mt-5">Color del nombre de usuario</p>
        <div className="flex flex-col gap-2">
          {NAME_OPTIONS.map((opt) => (
            <OptionRow key={opt.id} active={uc.type === opt.id} onSelect={() => setUc({ type: opt.id })} label={opt.label} hint={opt.hint}>
              {opt.id === 'rainbow' && (
                <span className="text-base font-black flex-shrink-0" style={{ background: RAINBOW_GRADIENT, backgroundSize: '400% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>@abc</span>
              )}
            </OptionRow>
          ))}
        </div>

        {uc.type === 'custom' && (
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-3 mb-1 px-1">
            Color
            <input type="color" value={uc.color || '#FFFFFF'} onChange={(e) => setUc({ color: e.target.value })} className="w-9 h-9 rounded cursor-pointer border-0 bg-transparent p-0" />
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={onApplyToAll} className="theme-btn-secondary flex-1 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest">
            Aplicar a todos los overlays
          </button>
          <button onClick={onClose} className="theme-btn-primary flex-1 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
