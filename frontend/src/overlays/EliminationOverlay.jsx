import { getUsernameOverride, resolveBackgroundStyle, rowBorder, overlayRootProps, labelProps, labelScaleStyle } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { useElimSounds } from './helpers';
import { ElimParticipantsGrid } from './ElimParticipantsGrid';
import { EliminationResultVisual, OfflineCard, PhaseProgressBar, PrizeStrip, TimeWarningBadge } from './shared';

// Eliminación dentro del overlay de juegos (380x700). Las burbujas y su
// tamaño los resuelve ElimParticipantsGrid (compartido con el overlay
// cuadrado de Eliminación, ver EliminationSquareOverlay.jsx).
export function EliminationOverlay({ state, prize, customize }) {
  useElimSounds(state);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard customize={customize} />;

  const timerTitle = state.mode === 'rejoin' ? 'REINGRESO' : 'TIEMPO PARA UNIRSE';

  return (
    // Altura FIJA (no min-h): con muchos participantes las burbujas se
    // achican (ver ElimParticipantsGrid) en vez de estirar la tarjeta — si el overlay
    // cambia de tamaño se rompe el recorte/captura ya encuadrado en OBS.
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" {...overlayRootProps(customize, resolveBackgroundStyle(customize))}>
      {state.mode === 'rejoin' && <div style={labelScaleStyle(customize)} className="tkc-ovl-fill absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ REINGRESO ⚠️</div>}
      {/* impeccable-disable-next-line ai-color-palette: el morado es el color de marca del sitio (acento #7C3AED); franja de estado del sorteo en curso */}
      {state.mode === 'revealing' && <div style={labelScaleStyle(customize)} className="tkc-ovl-fill absolute top-0 left-0 w-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🎯 ¿QUIÉN SERÁ? 🎯</div>}
      {state.paused && state.mode !== 'finished' && state.mode !== 'revealing' && <div style={labelScaleStyle(customize)} className="tkc-ovl-fill absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      {/* En Eliminación el equivalente al snipe es la ventana de re-join:
          se muestra desde el arranque para que sepan cuánto tiempo van a
          tener para volver a entrar después de cada eliminación. */}
      <div className="mt-6 w-full">
        <TimeWarningBadge label="Reingreso" seconds={state.rejoinTime} customize={customize} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <div className="flex items-center gap-2 mb-3">
          {/* Offstream: sin regalo para unirse, las entradas las da el streamer. */}
          <p {...labelProps(customize, 'theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold')}>{state.offstream ? '💀 ELIMINACIÓN' : '💀 ELIMINACIÓN — ÚNETE CON:'}</p>
          {/* Pedido explícito: el público tiene que saber en qué modo están
              jugando — Locked Mode significa que nadie nuevo entra ya
              arrancada la dinámica. */}
          {state.lockedMode && (
            <span className="tkc-ovl-fill bg-slate-800 border border-slate-500/60 text-slate-300 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0">🔒 Locked</span>
          )}
        </div>
        {!state.offstream && (
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
          <div className="flex items-center gap-2">
            {state.targetGiftIcon && <img alt="" src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-xl font-black text-white">{state.targetGiftName}</span>
          </div>
          <span className="tkc-ovl-fill text-yellow-400 text-lg font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl shadow-inner">{state.targetGiftCoins} 🪙</span>
        </div>
        )}

        {state.instaWinGiftName && state.instaWinGiftName.length > 0 && (
          <div className="tkc-ovl-fill mt-3 flex items-center justify-between bg-yellow-900/30 border border-yellow-600/50 px-4 py-2 rounded-xl w-full">
            <div className="flex items-center gap-2">
              <img alt="" src={state.instaWinGiftIcon} className="w-6 h-6" />
              <div className="text-left leading-tight">
                <span {...labelProps(customize, 'block text-[8px] uppercase tracking-widest text-yellow-500 font-bold')}>O INSTA-WIN:</span>
                <span className="text-sm font-bold text-yellow-100">{state.instaWinGiftName}</span>
              </div>
            </div>
            <span className="tkc-ovl-fill text-yellow-400 text-sm font-black bg-yellow-500/20 px-2 py-1 rounded-lg">{state.instaWinGiftCoins} 🪙</span>
          </div>
        )}

        <PrizeStrip prize={prize} customize={customize} />
      </div>

      <ElimParticipantsGrid state={state} customize={customize} maxSize={64} className="my-2">
        {state.mode === 'finished' ? (
          state.winner ? (
            <div className="flex flex-col items-center animate-pop">
              <div className="relative">
                {/* impeccable-disable-next-line bounce-easing: el rebote de la corona del ganador es parte de la identidad del show (decisión del dueño) */}
                <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-yellow-500" />
                <img alt="" src={state.winner.avatar} className="w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
            </div>
          ) : <span />
        ) : state.mode === 'result' ? (
          <EliminationResultVisual list={state.lastEliminatedList} customize={customize} />
        ) : null}
      </ElimParticipantsGrid>

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
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse" style={labelScaleStyle(customize)}>🎲 SORTEANDO...</p>
            <PhaseProgressBar active={state.mode === 'revealing'} durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
          </div>
        ) : state.mode === 'result' ? (
          <div className="border border-red-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={resolveBackgroundStyle(customize, 'var(--surface-bg-alt)')}>
            <p className="text-lg font-black text-red-300 uppercase tracking-widest" style={labelScaleStyle(customize)}>💀 Eliminados</p>
            <PhaseProgressBar active={state.mode === 'result'} durationMs={state.revealResultMs} colorClass="bg-red-400" />
          </div>
        ) : (
          // Más chico que en King/Zub a propósito: le deja más espacio a la
          // grilla de participantes, que puede tener muchos más elementos.
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
            <p {...labelProps(customize, 'text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5')}>{state.paused ? 'PAUSADO' : timerTitle}</p>
            <p className={`text-[52px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
