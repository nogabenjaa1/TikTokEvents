import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getUsernameOverride } from '../overlayCustomization';
import { computeElimGrid, labelFontSize } from '../elimGrid';
import { RESULT_DISPLAY_CAP } from './helpers';

// Resalta hasta RESULT_DISPLAY_CAP índices al azar del pool mientras
// `active` es true, cambiando cada `intervalMs` — puramente cosmético
// durante la fase de "selección" (pedido explícito: no importa quién
// aparezca ahí, los eliminados de VERDAD los decidió el backend y recién
// se muestran en la fase de "resultado", ver EliminationResultVisual).
function useFlickerHighlight(active, poolLength, intervalMs = 180) {
  const [indexes, setIndexes] = useState([]);
  useEffect(() => {
    if (!active || poolLength <= 0) { setIndexes([]); return; }
    const pick = () => {
      const pool = Array.from({ length: poolLength }, (_, i) => i);
      const count = Math.min(RESULT_DISPLAY_CAP, poolLength);
      const chosen = [];
      for (let i = 0; i < count && pool.length; i++) {
        chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      setIndexes(chosen);
    };
    pick();
    const id = setInterval(pick, intervalMs);
    return () => clearInterval(id);
  }, [active, poolLength, intervalMs]);
  return indexes;
}

// Área de burbujas de Eliminación, compartida por el overlay de juegos
// (380x700) y el overlay cuadrado propio. Mide su espacio REAL y elige la
// burbuja más grande con la que caben todas (ver computeElimGrid): se
// achican hasta volverse puntos y, si ni así caben, desaparecen y queda el
// total de jugadores y entradas (pedido explícito).
// `children`: lo que ocupa el área en vez de las burbujas (ganador,
// resultado de la ronda). `maxSize`: la burbuja más grande en px.
// `summaryScale`: tamaño del resumen cuando las burbujas desaparecen.
export function ElimParticipantsGrid({ state, customize, maxSize = 64, summaryScale = 1, className = '', children }) {
  const ref = useRef(null);
  const participants = state?.participants || [];
  const count = participants.length;
  const [grid, setGrid] = useState(() => computeElimGrid(0, 0, 0, { maxSize }));
  const revealing = state?.mode === 'revealing';
  const flickerIndexes = useFlickerHighlight(revealing, count);

  // Se vuelve a medir con cualquier cambio de layout (aparece/desaparece el
  // insta-win, el premio, un aviso...), no solo con la cantidad.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setGrid(computeElimGrid(el.clientWidth, el.clientHeight, count, { maxSize }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count, maxSize]);

  const nameOverride = getUsernameOverride(customize);
  const players = new Set(participants.map((p) => p.username)).size;

  let content = children;
  if (!children) {
    if (count === 0) {
      content = <p className="text-gray-600 text-sm italic text-center" style={{ zoom: summaryScale }}>Esperando participantes...</p>;
    } else if (grid.hidden) {
      content = (
        <div className="flex flex-col items-center text-center gap-1" style={{ zoom: summaryScale }}>
          <p className={`text-[40px] leading-none font-black tabular-nums ${revealing ? 'text-fuchsia-300 animate-pulse' : 'text-white'}`}>{count.toLocaleString('es-MX')}</p>
          <p className="text-xs font-black uppercase tracking-[0.3em] text-gray-400">entradas</p>
          <p className="text-sm font-bold text-gray-300 mt-1">{players.toLocaleString('es-MX')} {players === 1 ? 'jugador' : 'jugadores'}</p>
        </div>
      );
    } else {
      content = participants.map((p, i) => {
        const isHighlighted = revealing && flickerIndexes.includes(i);
        const fade = revealing ? (isHighlighted ? 'scale-125 z-10' : 'opacity-30 scale-90') : '';
        if (grid.dot) {
          // Punto de color en vez de foto: es contenido (no fondo), así que
          // queda pintado aunque el overlay sea transparente.
          return (
            <span key={p.id} title={p.username} className={`rounded-full transition-all duration-150 ${fade}`}
              style={{ width: grid.size, height: grid.size, background: isHighlighted ? '#FACC15' : 'var(--accent)' }} />
          );
        }
        return (
          <div key={p.id} title={p.username} style={{ width: grid.size }}
            className={`flex flex-col items-center gap-0.5 transition-all duration-150 ${fade}`}>
            <img alt="" src={p.avatar} style={{ width: grid.size, height: grid.size, borderColor: isHighlighted ? undefined : 'var(--accent)' }}
              className={`rounded-full border-2 object-cover flex-shrink-0 ${isHighlighted ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]' : ''}`} />
            {grid.showLabel && (
              <span style={{ fontSize: labelFontSize(grid.size), ...nameOverride.cssVars }} className={`max-w-full truncate ${isHighlighted ? 'text-yellow-300 font-bold' : 'text-gray-300'} ${nameOverride.className}`}>@{p.username}</span>
            )}
          </div>
        );
      });
    }
  }

  return (
    <div ref={ref} style={{ gap: grid.gap }} className={`w-full flex-1 min-h-0 flex flex-wrap justify-center items-center content-center overflow-hidden ${className}`}>
      {content}
    </div>
  );
}
