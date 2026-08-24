import React from 'react';
import { useTheme, THEME_STYLES, THEME_ACCENTS } from './ThemeContext';

// Panel de selección de tema: estilo (forma/material) + acento (color),
// combinables entre sí. Vive en el sidebar como cualquier otro módulo, no
// afecta al Overlay de OBS (ver ThemeContext.jsx).
export default function ThemeSwitcher() {
  const { style, accent, setStyle, setAccent } = useTheme();

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-8 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="text-[10px] theme-accent-text uppercase tracking-[0.3em] font-black">🎨 Tema</p>

      <div className="w-full max-w-lg theme-surface p-6">
        <h2 className="theme-heading text-lg font-semibold tracking-wide mb-4">Estilo</h2>
        <div className="grid grid-cols-2 gap-3">
          {THEME_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={[
                'text-left p-4 rounded-2xl transition-all border-2',
                style === s.id ? 'border-[var(--accent)]' : 'border-transparent hover:border-[color-mix(in_srgb,var(--accent)_35%,transparent)]',
              ].join(' ')}
              style={{ background: 'var(--surface-bg-alt)' }}
            >
              <p className="font-bold text-sm mb-1">
                {s.label} {style === s.id && <span className="theme-accent-text">✓</span>}
              </p>
              <p className="text-[11px] text-gray-500 leading-snug">{s.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-lg theme-surface p-6">
        <h2 className="theme-heading text-lg font-semibold tracking-wide mb-4">Color de acento</h2>
        <div className="flex gap-4 flex-wrap">
          {THEME_ACCENTS.map(a => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id)}
              className="flex flex-col items-center gap-2 group"
              title={a.label}
            >
              <span
                className="w-12 h-12 rounded-full border-2 transition-all flex items-center justify-center"
                style={{
                  background: a.swatch,
                  borderColor: accent === a.id ? '#fff' : 'transparent',
                  boxShadow: accent === a.id ? `0 0 0 3px ${a.swatch}55` : 'none',
                }}
              >
                {accent === a.id && <span className="text-white text-lg leading-none">✓</span>}
              </span>
              <span className="text-[10px] font-bold text-gray-400 group-hover:text-gray-200">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-lg theme-surface-featured p-6 flex flex-col items-center gap-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Vista previa</p>
        <button className="theme-btn-primary px-8 py-3 rounded-xl font-black tracking-widest uppercase text-xs shadow-lg">
          Botón de ejemplo
        </button>
        <div className="theme-input px-4 py-2 text-sm text-gray-300 w-full text-center">Campo de ejemplo</div>
      </div>
    </div>
  );
}
