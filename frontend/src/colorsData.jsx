import React from 'react';

// Compartido entre Colorsays.jsx (el juego) y DiceOverlay.jsx (el overlay
// especial de OBS para Colores) — una sola fuente de verdad para la lista
// de colores y el componente del dado.
export const COLORS = [
  { name: 'Rojo',     emoji: '🔴', bgClass: 'bg-red-950',    borderClass: 'border-red-500',    textClass: 'text-red-400'    },
  { name: 'Verde',    emoji: '🟢', bgClass: 'bg-green-950',  borderClass: 'border-green-500',  textClass: 'text-green-400'  },
  { name: 'Azul',     emoji: '🔵', bgClass: 'bg-blue-950',   borderClass: 'border-blue-500',   textClass: 'text-blue-400'   },
  { name: 'Amarillo', emoji: '🟡', bgClass: 'bg-yellow-950', borderClass: 'border-yellow-500', textClass: 'text-yellow-400' },
  { name: 'Naranja',  emoji: '🟠', bgClass: 'bg-orange-950', borderClass: 'border-orange-500', textClass: 'text-orange-400' },
  { name: 'Morado',   emoji: '🟣', bgClass: 'bg-purple-950', borderClass: 'border-purple-500', textClass: 'text-purple-400' },
];

// El dado en sí sigue el tema elegido (forma/sombra/vidrio/relieve), pero
// NUNCA el color resultante una vez asentado: ese color es del juego
// (COLORS[i].bgClass/borderClass), no del tema — theme-die-shape solo le
// pone el radio/sombra/blur del estilo activo encima, sin tocar el color.
export function Die({ colorIdx, rolling, size = 'w-20 h-20 text-4xl' }) {
  const c = colorIdx !== null && colorIdx !== undefined ? COLORS[colorIdx] : null;
  return (
    <div className={[size, 'flex items-center justify-center flex-shrink-0 transition-all duration-300',
        rolling ? 'animate-[dieRoll_0.1s_ease-in-out_infinite_alternate] theme-die-rolling'
                : (c ? `${c.bgClass} ${c.borderClass} border-2 theme-die-shape` : 'theme-surface'),
      ].join(' ')}>
      {rolling ? '❓' : (c ? c.emoji : '⬜')}
    </div>
  );
}
