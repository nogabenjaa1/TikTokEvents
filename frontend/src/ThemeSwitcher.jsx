import React, { useEffect, useState } from 'react';
import { useTheme, THEME_STYLES, THEME_ACCENTS, ThemedShell, skinName } from './ThemeContext';

// ─────────────────────────────────────────────
// SELECTOR DE SKIN — rediseño completo (ago. 2026) sobre la estructura
// validada en wireframes-selector-de-skin.html (Intent /wireframe).
// Reemplaza el viejo flujo de 2 pasos (elegir "Estilo" y después "Acento"
// por separado) por un único gesto: cada tile YA es la combinación
// completa (material + acento) — 16 skins nombrados, agrupados en 4 filas
// por material para que sigan siendo escaneables.
//
// Tres necesidades del streamer en vivo que este diseño ataca directo:
//  1. Previsualizar ANTES de comprometerse → hover sobre una tile actualiza
//     la vista previa en vivo (arriba de todo) sin tocar el tema real.
//  2. Sentir que elige un "skin" de cabina/arcade, no llena un formulario →
//     un solo clic por combo, con nombre propio ("Clay Rosa").
//  3. Volver fácil si no le gustó → chip de "últimos usados" + botón
//     "Volver al anterior" que alterna con el skin previo.
// ─────────────────────────────────────────────
export default function ThemeSwitcher() {
  const { style, accent, recents, previous, setSkin, revertToPrevious } = useTheme();
  const [previewSkin, setPreviewSkin] = useState(null); // { style, accent } | null — solo hover, no se aplica
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const current = { style, accent };
  const effective = previewSkin || current; // lo que muestra la vista previa

  const applySkin = (s, a) => {
    setSkin(s, a);
    const name = skinName({ style: s, accent: a });
    // El material Kawaii tiene su propio tono de confirmación — tierno,
    // pensado para esa audiencia — sin tocar la voz general del resto.
    setToast(s === 'kawaii' ? { kawaii: true, name } : { kawaii: false, name });
    setPreviewSkin(null);
  };

  const isSelected = (s, a) => style === s && accent === a;
  const accentHex = (id) => THEME_ACCENTS.find(x => x.id === id)?.swatch ?? '#7C3AED';

  return (
    <div className="min-h-screen text-white flex flex-col gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto max-w-3xl mx-auto w-full">

      {/* ── Encabezado ── */}
      <div>
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">🎨 TEMA</p>
        <h2 className="theme-heading text-2xl font-black tracking-wide">Elegí el skin de tu cabina</h2>
        <p className="text-xs text-gray-500 mt-1">Se aplica al instante, en vivo. Pasá el mouse sobre un skin para probarlo antes de confirmarlo.</p>
      </div>

      {/* ── 1. Vista previa en vivo — domina la pantalla, no un preview chico al final ── */}
      <div className="theme-surface p-5">
        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">
          {effective.style === 'kawaii' ? 'Así de tierno' : 'Vista previa'} — <span className="text-gray-300">{skinName(effective)}</span>
        </p>
        <ThemedShell
          className="rounded-2xl overflow-hidden flex justify-center py-5 px-5"
          fitContent
          styleOverride={effective.style}
          accentOverride={effective.accent}
        >
          <div className="theme-surface-featured w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="theme-accent-bg w-3 h-8 rounded-full" />
              <h1 className="theme-heading text-lg font-semibold tracking-wide">Rey del Trono</h1>
            </div>
            <label className="theme-label block text-xs uppercase tracking-widest font-semibold mb-2">Username de TikTok</label>
            <input readOnly value="streamer_oficial" className="theme-input w-full p-3 outline-none text-sm font-bold text-white mb-4" />
            <button className="theme-btn-primary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs shadow-lg">
              Empezar
            </button>
          </div>
        </ThemedShell>
      </div>

      {/* ── 2. Últimos usados — revertir en un toque ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 font-semibold flex-shrink-0">Últimos usados:</span>
        <button
          className="theme-chip px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5"
          style={{ background: accentHex(accent), color: '#fff' }}
        >
          <span aria-hidden>✓</span> {skinName(current)}
        </button>
        {recents.map(r => (
          <button
            key={`${r.style}-${r.accent}`}
            onClick={() => applySkin(r.style, r.accent)}
            onMouseEnter={() => setPreviewSkin(r)}
            onMouseLeave={() => setPreviewSkin(null)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
            style={{ borderColor: 'var(--surface-border-color)', color: '#9CA3AF', background: 'var(--surface-bg-alt)' }}
          >
            {skinName(r)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={revertToPrevious}
          disabled={!previous}
          className="text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors flex items-center gap-1.5"
        >
          ↩ Volver al anterior
        </button>
      </div>

      {/* ── 3. Grid de 16 skins — un clic elige el combo completo, agrupado por material ── */}
      <div className="flex flex-col gap-4">
        {THEME_STYLES.map(s => (
          <div key={s.id} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-24 flex-shrink-0 sm:pt-2.5">
              <p className="text-sm font-bold text-gray-200 leading-tight">{s.shortLabel}</p>
              <p className="text-[10px] text-gray-600 leading-snug">{s.hint}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 flex-1">
              {THEME_ACCENTS.map(a => {
                const selected = isSelected(s.id, a.id);
                const hex = a.swatch;
                return (
                  <button
                    key={a.id}
                    onClick={() => applySkin(s.id, a.id)}
                    onMouseEnter={() => setPreviewSkin({ style: s.id, accent: a.id })}
                    onMouseLeave={() => setPreviewSkin(null)}
                    className="rounded-xl p-2.5 text-left border transition-all min-w-0"
                    style={{
                      background: selected ? `${hex}22` : 'var(--surface-bg-alt)',
                      borderColor: selected ? hex : 'var(--surface-border-color)',
                      boxShadow: selected ? `0 0 0 1px ${hex}55` : 'none',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                        style={{ background: hex }}
                        aria-hidden
                      />
                      <span className="text-[11px] font-bold text-gray-200 truncate">{a.label}</span>
                      {selected && <span className="ml-auto text-[10px] flex-shrink-0" style={{ color: hex }}>✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── 4. Confirmación no bloqueante ── */}
      <div className="flex items-start gap-3 bg-[#0D081A] border border-[#2D1B4E] rounded-xl px-4 py-3">
        <span className="text-sm flex-shrink-0">ℹ️</span>
        <p className="text-[11px] text-gray-500 leading-snug">
          No hace falta guardar — cada clic aplica el skin al instante, acá y también en el overlay de OBS que ve tu audiencia, así el tema que elijas te representa de verdad.
        </p>
      </div>

      {/* ── Toast de confirmación — no bloqueante, se cierra solo ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#130E24] border border-[#2D1B4E] text-gray-100 text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-pop">
          {toast.kawaii ? (
            <>🎀 ¡"{toast.name}" aplicado! Te quedó tiernísimo</>
          ) : (
            <><span className="text-emerald-400">✓</span> Skin "{toast.name}" aplicado</>
          )}
        </div>
      )}
    </div>
  );
}
