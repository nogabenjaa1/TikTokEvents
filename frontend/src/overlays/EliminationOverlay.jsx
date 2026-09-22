import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { elimSnapshot, elimSounds } from '../eventSoundRules';
import { getUsernameOverride, resolveBackgroundStyle, rowBorder } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { RESULT_DISPLAY_CAP, playOverlaySounds } from './helpers';
import { EliminationResultVisual, OfflineCard, PhaseProgressBar, PrizeStrip, TimeWarningBadge } from './shared';

// Calcula el avatar más grande que hace que TODOS los participantes entren
// en el área REAL medida del contenedor (ancho/alto en px), en vez de
// tamaños fijos por rango de cantidad. Así nunca se recorta ninguna burbuja
// ni la tarjeta necesita estirarse, sin importar cuánto espacio quede libre
// según qué otros bloques (insta-win, premio, aviso de eliminado) estén
// visibles en ese momento.
function computeElimBoxSize(containerWidth, containerHeight, count) {
  if (count <= 0 || containerWidth <= 0 || containerHeight <= 0) return { size: 64, gap: 6 };
  for (let size = 64; size >= 6; size -= 2) {
    const gap = size >= 18 ? 6 : 3; // con burbujas muy chicas, menos separación para aprovechar más el espacio
    const textSpace = size >= 18 ? 14 : 0; // debajo de cierto tamaño ya no se muestra el username
    const cellW = size + gap;
    const cellH = size + textSpace + gap;
    const cols = Math.max(1, Math.floor((containerWidth + gap) / cellW));
    const rows = Math.ceil(count / cols);
    if (rows * cellH <= containerHeight) return { size, gap };
  }
  return { size: 6, gap: 3 };
}

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

export function EliminationOverlay({ state, prize, customize }) {
  const gridRef = useRef(null);
  const [boxSize, setBoxSize] = useState(64);
  const [gridGap, setGridGap] = useState(6);

  // Sonidos: arranca el sorteo ('revealing'), se resuelve la ronda
  // ('revealing' -> 'result', el momento real en que el backend ya sacó a
  // los eliminados), y el mismo sonido de ganador que King/Zub.
  const prevElimRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    const sounds = elimSounds(prevElimRef.current, state);
    prevElimRef.current = elimSnapshot(state);
    playOverlaySounds(sounds);
    // Solo cuando cambia el modo o el ganador: el resto del estado llega a cada rato y no debe repetir el sonido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mode, state?.winner]);

  const participants = (state && state.participants) || [];
  const instaWinGiftName = state?.instaWinGiftName;
  const elimMode = state?.mode;
  // Puramente cosmético — ver comentario de useFlickerHighlight. Los
  // eliminados de VERDAD llegan en state.lastEliminatedList recién en la
  // fase de "resultado", no dependen de esto para nada.
  const flickerIndexes = useFlickerHighlight(state?.mode === 'revealing', participants.length);

  // Mide el área real disponible para la grilla de participantes y
  // recalcula el tamaño de burbuja más grande que hace que todos entren —
  // se re-ejecuta con cualquier cambio de layout (aparece/desaparece el
  // insta-win, el premio, el aviso de eliminado, etc), no solo la cantidad.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = () => {
      const { size, gap } = computeElimBoxSize(el.clientWidth, el.clientHeight, participants.length);
      setBoxSize(size);
      setGridGap(gap);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [participants.length, instaWinGiftName, prize, elimMode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard customize={customize} />;

  const timerTitle = state.mode === 'rejoin' ? 'REINGRESO' : 'TIEMPO PARA UNIRSE';
  const showLabel = boxSize >= 18;

  return (
    // Altura FIJA (no min-h): con muchos participantes las burbujas se
    // achican vía elimSizeFor en vez de estirar la tarjeta — si el overlay
    // cambia de tamaño se rompe el recorte/captura ya encuadrado en OBS.
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'rejoin' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ REINGRESO ⚠️</div>}
      {/* impeccable-disable-next-line ai-color-palette: el morado es el color de marca del sitio (acento #7C3AED); franja de estado del sorteo en curso */}
      {state.mode === 'revealing' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🎯 ¿QUIÉN SERÁ? 🎯</div>}
      {state.paused && state.mode !== 'finished' && state.mode !== 'revealing' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      {/* En Eliminación el equivalente al snipe es la ventana de re-join:
          se muestra desde el arranque para que sepan cuánto tiempo van a
          tener para volver a entrar después de cada eliminación. */}
      <div className="mt-6 w-full">
        <TimeWarningBadge label="Reingreso" seconds={state.rejoinTime} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <div className="flex items-center gap-2 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold">💀 ELIMINACIÓN — ÚNETE CON:</p>
          {/* Pedido explícito: el público tiene que saber en qué modo están
              jugando — Locked Mode significa que nadie nuevo entra ya
              arrancada la dinámica. */}
          {state.lockedMode && (
            <span className="bg-slate-800 border border-slate-500/60 text-slate-300 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0">🔒 Locked</span>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
          <div className="flex items-center gap-2">
            {state.targetGiftIcon && <img src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-xl font-black text-white">{state.targetGiftName}</span>
          </div>
          <span className="text-yellow-400 text-lg font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl shadow-inner">{state.targetGiftCoins} 🪙</span>
        </div>

        {state.instaWinGiftName && state.instaWinGiftName.length > 0 && (
          <div className="mt-3 flex items-center justify-between bg-yellow-900/30 border border-yellow-600/50 px-4 py-2 rounded-xl w-full">
            <div className="flex items-center gap-2">
              <img src={state.instaWinGiftIcon} className="w-6 h-6" />
              <div className="text-left leading-tight">
                <span className="block text-[8px] uppercase tracking-widest text-yellow-500 font-bold">O INSTA-WIN:</span>
                <span className="text-sm font-bold text-yellow-100">{state.instaWinGiftName}</span>
              </div>
            </div>
            <span className="text-yellow-400 text-sm font-black bg-yellow-500/20 px-2 py-1 rounded-lg">{state.instaWinGiftCoins} 🪙</span>
          </div>
        )}

        <PrizeStrip prize={prize} />
      </div>

      <div ref={gridRef} style={{ gap: gridGap }} className="w-full flex-1 flex flex-wrap justify-center items-center content-center my-2 overflow-hidden">
        {state.mode === 'finished' ? (
          state.winner && (
            <div className="flex flex-col items-center animate-pop">
              <div className="relative">
                {/* impeccable-disable-next-line bounce-easing: el rebote de la corona del ganador es parte de la identidad del show (decisión del dueño) */}
                <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-yellow-500" />
                <img src={state.winner.avatar} className="w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
            </div>
          )
        ) : state.mode === 'result' ? (
          <EliminationResultVisual list={state.lastEliminatedList} />
        ) : participants.length > 0 ? (
          participants.map((p, i) => {
            const isHighlighted = state.mode === 'revealing' && flickerIndexes.includes(i);
            return (
              <div key={p.id} title={p.username} style={{ width: boxSize }}
                className={`flex flex-col items-center gap-0.5 transition-all duration-150 ${state.mode === 'revealing' ? (isHighlighted ? 'scale-125 z-10' : 'opacity-30 scale-90') : ''}`}>
                <img src={p.avatar} style={{ width: boxSize, height: boxSize, borderColor: isHighlighted ? undefined : 'var(--accent)' }}
                  className={`rounded-full border-2 object-cover flex-shrink-0 ${isHighlighted ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]' : ''}`} />
                {showLabel && (
                  <span style={{ fontSize: Math.max(4, Math.round(boxSize * 0.22)), ...getUsernameOverride(customize).cssVars }} className={`max-w-full truncate ${isHighlighted ? 'text-yellow-300 font-bold' : 'text-gray-300'} ${getUsernameOverride(customize).className}`}>@{p.username}</span>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-gray-600 text-sm italic text-center">Esperando participantes...</p>
        )}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="flex flex-col items-center gap-2 py-2">
            {state.winner ? (
              <>
                <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse">¡GANADOR!</div>
                <p className={`text-lg font-black text-yellow-400 ${getUsernameOverride(customize).className}`} style={getUsernameOverride(customize).cssVars}>@{state.winner.username}</p>
              </>
            ) : (
              <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
            )}
          </div>
        ) : state.mode === 'revealing' ? (
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={resolveBackgroundStyle(customize, 'var(--surface-bg-alt)')}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎲 SORTEANDO...</p>
            <PhaseProgressBar active={state.mode === 'revealing'} durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
          </div>
        ) : state.mode === 'result' ? (
          <div className="border border-red-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={resolveBackgroundStyle(customize, 'var(--surface-bg-alt)')}>
            <p className="text-lg font-black text-red-300 uppercase tracking-widest">💀 Eliminados</p>
            <PhaseProgressBar active={state.mode === 'result'} durationMs={state.revealResultMs} colorClass="bg-red-400" />
          </div>
        ) : (
          // Más chico que en King/Zub a propósito: le deja más espacio a la
          // grilla de participantes, que puede tener muchos más elementos.
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">{state.paused ? 'PAUSADO' : timerTitle}</p>
            <p className={`text-[52px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
