import React from 'react';
import { COLORS, Die } from './colorsData';

// Overlay especial para Color Says (?overlay=true&key=...&screen=colors):
// a diferencia del overlay normal (Rey del Trono/Zubastinis/Eliminación,
// vertical), este es horizontal — pensado para una fuente de navegador
// ancha en OBS. Muestra lo mismo que ve el streamer en su panel (título,
// lista de colores y los dados), sincronizado en tiempo real vía
// `dice_state_update` (ver tenant.js / Colorsays.jsx).
export default function DiceOverlay({ diceState, theme = { style: 'default', accent: 'purple' } }) {
  const { diceCount = 4, diceResult = [], rolling = false } = diceState || {};
  const dice = diceResult.length > 0 ? diceResult : Array(diceCount).fill(null);

  return (
    <div className="themed-app grid place-items-center min-h-screen" data-theme-style={theme.style} data-accent={theme.accent}>
      <div className="theme-die-frame w-[960px] h-[260px] px-10 flex items-center gap-10 font-sans overflow-hidden">
        <div className="flex flex-col items-start gap-3 flex-shrink-0">
          <p className="theme-accent-text text-2xl font-black uppercase tracking-[0.2em]">Colores</p>
          <div className="flex flex-col gap-1">
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
