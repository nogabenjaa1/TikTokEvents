import { useState } from 'react';
import { useTheme, THEME_MODES, ThemedShell } from './ThemeContext';
import { ACCENT_PRESETS, accentLabel, accentTokens } from './themeModel';

// Pantalla de Tema: un solo diseño, así que aquí solo se elige el color de
// acento (tres de fábrica o uno propio) y la apariencia del panel. El acento se
// aplica al instante, en el panel y en los overlays de OBS. Pasar el cursor o
// el foco por un color lo prueba en la vista previa sin aplicarlo.
export default function ThemeSwitcher() {
  const { accent, customColor, setAccent, mode, setMode, resolvedMode } = useTheme();
  const [preview, setPreview] = useState(null); // { accent, customColor } | null
  const shown = preview || { accent, customColor };
  const adjusted = accent === 'custom' && accentTokens(customColor, resolvedMode).adjusted;

  return (
    <div className="flex-1 overflow-y-auto w-full">
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10 flex flex-col gap-8">
        <header>
          <h1 className="tkc-page-title">Tema</h1>
          <p className="tkc-hint mt-1.5 max-w-prose">Elige el color de tu cabina. Se aplica al instante en el panel y en los overlays que ve tu audiencia.</p>
        </header>

        <section aria-labelledby="tkc-accent-title" className="flex flex-col gap-3">
          <h2 id="tkc-accent-title" className="tkc-section-title">Color de acento</h2>
          <div role="radiogroup" aria-labelledby="tkc-accent-title" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ACCENT_PRESETS.map(p => {
              const selected = accent === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => { setAccent(p.id); setPreview(null); }}
                  onMouseEnter={() => setPreview({ accent: p.id, customColor })}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => setPreview({ accent: p.id, customColor })}
                  onBlur={() => setPreview(null)}
                  className="tkc-option"
                >
                  <span className="tkc-swatch" style={{ background: p.hex }} aria-hidden />
                  <span className="tkc-option-label">{p.label}</span>
                </button>
              );
            })}
            {/* Personalizado: el <input type="color"> nativo va dentro del
                <label>; tocar la opción abre el selector del sistema. Mientras
                se arrastra solo cambia la vista previa (input); al soltar se
                aplica (change). */}
            <label className="tkc-option cursor-pointer" aria-checked={accent === 'custom'} role="radio">
              <input
                type="color"
                value={customColor}
                onInput={(e) => setPreview({ accent: 'custom', customColor: e.target.value })}
                onChange={(e) => { setAccent('custom', e.target.value); setPreview(null); }}
                onBlur={() => setPreview(null)}
                className="sr-only"
                aria-label="Elegir un color propio"
              />
              <span className="tkc-swatch tkc-swatch-custom" style={{ background: shown.accent === 'custom' ? shown.customColor : customColor }} aria-hidden />
              <span className="tkc-option-label">Personalizado</span>
            </label>
          </div>
          {adjusted && (
            <p className="tkc-hint" role="status">Ajustamos un poco el brillo de este color para que los botones y los textos se lean bien. Tus overlays de OBS usan el color tal como lo elegiste.</p>
          )}
        </section>

        <section aria-label="Vista previa" className="flex flex-col gap-3">
          <h2 className="tkc-section-title">Vista previa <span className="tkc-section-meta">{accentLabel(shown)}</span></h2>
          <ThemedShell fitContent accentOverride={shown.accent} customColorOverride={shown.customColor} className="tkc-theme-preview">
            <PreviewSample />
          </ThemedShell>
        </section>

        <section aria-labelledby="tkc-mode-title" className="flex flex-col gap-3">
          <h2 id="tkc-mode-title" className="tkc-section-title">Apariencia</h2>
          <div role="radiogroup" aria-labelledby="tkc-mode-title" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {THEME_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className="tkc-option tkc-option-stacked"
              >
                <span className="tkc-option-label">{m.label}</span>
                <span className="tkc-hint">{m.hint}</span>
              </button>
            ))}
          </div>
          <p className="tkc-hint">La apariencia solo cambia cómo ves el panel en este navegador. Los overlays de OBS no cambian.</p>
        </section>
      </div>
    </div>
  );
}

// Fragmento de un panel real (un juego listo para iniciar) con los mismos
// componentes que usa la app, para juzgar el acento donde de verdad aparece.
function PreviewSample() {
  return (
    <div className="p-4 sm:p-5 grid gap-4 sm:grid-cols-[9rem_1fr]">
      <nav aria-label="Ejemplo de navegación" className="hidden sm:flex flex-col gap-1">
        <span className="tkc-preview-nav">Inicio</span>
        <span className="tkc-preview-nav tkc-preview-nav-active">Juegos</span>
        <span className="tkc-preview-nav">Overlays de OBS</span>
      </nav>
      <div className="theme-surface p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold text-sm text-white">Rey del Trono</p>
          <span className="theme-chip tkc-label px-2.5 py-1 rounded-full">Listo para iniciar</span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="tkc-label text-gray-400">Regalo objetivo</span>
          <input readOnly tabIndex={-1} value="Rosa" className="theme-input px-3 py-2.5 text-sm text-white outline-none" />
        </label>
        <div className="flex gap-2">
          <span className="theme-btn-primary theme-btn-md flex-1 text-center font-bold">Iniciar</span>
          <span className="theme-btn-secondary theme-btn-md font-bold">Personalizar</span>
        </div>
      </div>
    </div>
  );
}
