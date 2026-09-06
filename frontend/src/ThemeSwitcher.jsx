import React, { useEffect, useState } from 'react';
import { useTheme, THEME_STYLES, THEME_ACCENTS, ThemedShell, skinName } from './ThemeContext';

// ─────────────────────────────────────────────
// SELECTOR DE SKIN — cada tile ya es la combinación completa (material +
// acento): 2 materiales (Clásico/Cute) x 4 columnas (Morado/Azul/Rosa +
// Personalizado), agrupados en filas por material para que sigan siendo
// escaneables. "Personalizado" no es un color fijo — es un
// <input type="color"> nativo escondido detrás del tile (el círculo de
// muestra SÍ usa el color elegido); arrastrar el selector actualiza la
// vista previa en vivo al toque (evento `input`) y recién confirma el skin
// al soltar (evento `change`), mismo criterio de "probar antes de
// comprometerse" que ya usa el hover en los 3 presets.
//
// Dos necesidades del streamer en vivo que este diseño ataca directo:
//  1. Previsualizar ANTES de comprometerse → hover (o arrastrar el color
//     picker) sobre una tile actualiza la vista previa en vivo (arriba de
//     todo) sin tocar el tema real.
//  2. Volver fácil si no le gustó → chip de "últimos usados" + botón
//     "Volver al anterior" que alterna con el skin previo.
// ─────────────────────────────────────────────
export default function ThemeSwitcher() {
  const { style, accent, customColor, recents, previous, setSkin, revertToPrevious } = useTheme();
  const [previewSkin, setPreviewSkin] = useState(null); // { style, accent, customColor? } | null — solo hover/arrastre, no se aplica
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const current = { style, accent, customColor };
  const effective = previewSkin || current; // lo que muestra la vista previa

  const applySkin = (s, a, cc) => {
    setSkin(s, a, cc);
    setToast({ name: skinName({ style: s, accent: a }) });
    setPreviewSkin(null);
  };

  const isSelected = (s, a) => style === s && accent === a;
  const accentHex = (id) => (id === 'custom' ? customColor : THEME_ACCENTS.find(x => x.id === id)?.swatch) ?? '#7C3AED';

  return (
    <div className="min-h-screen text-white flex flex-col gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto max-w-3xl mx-auto w-full">

      {/* ── Encabezado ── */}
      <div>
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">🎨 TEMA</p>
        <h2 className="theme-heading text-2xl font-black tracking-wide">Elige el skin de tu cabina</h2>
        <p className="text-xs text-gray-500 mt-1">Se aplica al instante, en vivo. Pasa el mouse (o arrastra el color personalizado) sobre un skin para probarlo antes de confirmarlo.</p>
      </div>

      {/* ── 1. Vista previa en vivo — domina la pantalla, no un preview chico al final ── */}
      <div className="theme-surface p-5">
        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">
          Vista previa — <span className="text-gray-300">{skinName(effective)}</span>
        </p>
        <ThemedShell
          className="rounded-2xl overflow-hidden flex justify-center py-5 px-5"
          fitContent
          styleOverride={effective.style}
          accentOverride={effective.accent}
          customColorOverride={effective.customColor}
        >
          <div className="theme-surface-featured w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="theme-accent-bg w-3 h-8 rounded-full" />
              <h1 className="theme-heading text-lg font-semibold tracking-wide">Rey del Trono</h1>
            </div>
            <label className="theme-label block text-xs uppercase tracking-widest font-semibold mb-2">Usuario de TikTok</label>
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
            key={`${r.style}-${r.accent}-${r.customColor}`}
            onClick={() => applySkin(r.style, r.accent, r.customColor)}
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

      {/* ── 3. Grid de skins — un clic elige el combo completo, agrupado por material ── */}
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
              {/* "Personalizado": el <input type="color"> nativo va escondido
                  (sr-only) dentro del <label> — clickear cualquier parte del
                  tile abre el selector del sistema operativo. `onInput`
                  (dispara en cada tick mientras arrastra) solo actualiza la
                  vista previa; `onChange` (dispara al soltar/cerrar el
                  selector) recién confirma el skin de verdad. */}
              {(() => {
                const selected = isSelected(s.id, 'custom');
                const hex = (previewSkin?.style === s.id && previewSkin?.accent === 'custom') ? previewSkin.customColor : customColor;
                return (
                  <label
                    className="rounded-xl p-2.5 text-left border transition-all min-w-0 cursor-pointer"
                    style={{
                      background: selected ? `${hex}22` : 'var(--surface-bg-alt)',
                      borderColor: selected ? hex : 'var(--surface-border-color)',
                      boxShadow: selected ? `0 0 0 1px ${hex}55` : 'none',
                    }}
                  >
                    <input
                      type="color"
                      value={hex}
                      onInput={(e) => setPreviewSkin({ style: s.id, accent: 'custom', customColor: e.target.value })}
                      onChange={(e) => applySkin(s.id, 'custom', e.target.value)}
                      onBlur={() => setPreviewSkin(null)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                        style={{ background: hex }}
                        aria-hidden
                      />
                      <span className="text-[11px] font-bold text-gray-200 truncate">Personalizado</span>
                      {selected && <span className="ml-auto text-[10px] flex-shrink-0" style={{ color: hex }}>✓</span>}
                    </div>
                  </label>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* ── 4. Confirmación no bloqueante ── */}
      <div className="flex items-start gap-3 bg-[var(--surface-bg-alt)] border border-[var(--surface-border-color)] rounded-xl px-4 py-3">
        <span className="text-sm flex-shrink-0">ℹ️</span>
        <p className="text-[11px] text-gray-500 leading-snug">
          No hace falta guardar — cada clic aplica el skin al instante, aquí y también en el overlay de OBS que ve tu audiencia, así el tema que elijas te representa de verdad.
        </p>
      </div>

      {/* ── Toast de confirmación — no bloqueante, se cierra solo ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[var(--surface-bg-alt)] border border-[var(--surface-border-color)] text-gray-100 text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-pop">
          <span className="text-emerald-400">✓</span> Skin "{toast.name}" aplicado
        </div>
      )}
    </div>
  );
}
