import React from 'react';
import { COLORS, Die } from './colorsData';
import { resolveBackgroundStyle, getUsernameOverride } from './overlayCustomization';
import { accentStyleVars } from './ThemeContext';

// Overlay especial para Color Says (?overlay=true&key=...&screen=colors):
// a diferencia del overlay normal (Rey del Trono/Zubastinis/Eliminación,
// vertical), este es horizontal — pensado para una fuente de navegador
// ancha en OBS. Muestra lo mismo que ve el streamer en su panel (título,
// lista de colores y los dados), sincronizado en tiempo real vía
// `dice_state_update` (ver tenant.js / Colorsays.jsx).
// `embedded`: mismo criterio que Overlay.jsx — lo usa la vista previa del
// modal de personalización (ver OverlayPreviewBox.jsx), donde forzar
// `min-height: 100vh` (el valor incondicional de `.themed-app`, ver
// index.css) empujaba la tarjeta muy por debajo del recuadro chico del
// modal en vez de quedar anclada arriba. Quitar la clase `min-h-screen`
// sola no alcanza — hay que neutralizar el `min-height` de `.themed-app`
// con un `style` inline.
export default function DiceOverlay({ diceState, theme = { style: 'default', accent: 'purple' }, customize, embedded = false }) {
  const { diceCount = 4, diceResult = [], rolling = false } = diceState || {};
  const dice = diceResult.length > 0 ? diceResult : Array(diceCount).fill(null);
  const titleOverride = getUsernameOverride(customize);

  return (
    <div className={`themed-app grid place-items-center ${embedded ? '' : 'min-h-screen'}`} style={{ ...(embedded ? { minHeight: 0 } : null), ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
      <div className="theme-die-frame w-[960px] h-[260px] px-10 flex items-center gap-10 font-sans overflow-hidden" style={resolveBackgroundStyle(customize)}>
        <div className="flex flex-col items-start gap-3 flex-shrink-0">
          <p className={`theme-accent-text text-2xl font-black uppercase tracking-[0.2em] ${titleOverride.className}`} style={titleOverride.cssVars}>ColorSays</p>
          <div className="flex flex-col gap-1">
            {/* Los nombres de color (rojo/azul/verde/etc.) mantienen su
                color nativo (c.textClass) SIEMPRE — a diferencia del
                título, NO deben reaccionar a la personalización de texto
                (pedido explícito: son la referencia visual del color real
                de cada dado, cambiarlos rompería esa asociación). */}
            {COLORS.map((c, i) => (
              <span key={i} className={`text-xs font-bold ${c.textClass}`}>{c.name}</span>
            ))}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center gap-4 flex-wrap">
          {dice.map((ci, d) => <Die key={d} colorIdx={ci} rolling={rolling} size="w-24 h-24 text-5xl" />)}
        </div>
      </div>
    </div>
  );
}
