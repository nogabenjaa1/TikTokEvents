import { getUsernameOverride, resolveBackgroundStyle, rowBorder, overlayRootProps, labelProps, labelScaleStyle } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { useElimSounds } from './helpers';
import { ElimParticipantsGrid } from './ElimParticipantsGrid';
import { EliminationResultVisual, PhaseProgressBar, PrizeStrip, TimeWarningBadge } from './shared';

// Overlay propio de Eliminación (?screen=elim), cuadrado y grande (pedido
// explícito): lo mismo que muestra Eliminación en el overlay de juegos
// (regalo para unirse, Insta-Win, premio, reingreso, Locked, reloj, sorteo,
// resultado y ganador), con mucho más espacio para las burbujas. Tamaño fijo
// para que el recorte en OBS no cambie.
const SIZE = 1080;

export function EliminationSquareOverlay({ state, prize, customize }) {
  useElimSounds(state);

  if (!state || (!state.isActive && state.mode !== 'finished')) {
    return (
      <div className="theme-die-frame flex flex-col items-center justify-center gap-6 font-sans overflow-hidden" {...overlayRootProps(customize, { width: SIZE, height: SIZE, ...resolveBackgroundStyle(customize) })}>
        <div className="tkc-ovl-fill w-48 h-48 rounded-full border-4 border-dashed flex items-center justify-center animate-pulse" style={{ borderColor: 'var(--surface-border-color)', background: 'color-mix(in oklch, var(--surface-bg-alt) 50%, transparent)' }}>
          <span className="text-[80px] opacity-40">💀</span>
        </div>
        <h2 {...labelProps(customize, 'text-[40px] font-black text-gray-500 tracking-widest uppercase text-center')}>Eliminación</h2>
        <p {...labelProps(customize, 'text-base text-gray-600 font-bold text-center uppercase tracking-[0.3em]')}>Esperando al streamer...</p>
      </div>
    );
  }

  const participants = state.participants || [];
  const players = new Set(participants.map((p) => p.username)).size;
  const nameOverride = getUsernameOverride(customize);
  const timerTitle = state.mode === 'rejoin' ? 'REINGRESO' : 'TIEMPO PARA UNIRSE';
  const banner = state.mode === 'rejoin'
    ? { text: '⚠️ REINGRESO ⚠️', className: 'from-red-600 to-red-800 animate-pulse' }
    : state.mode === 'revealing'
      ? { text: '🎯 ¿QUIÉN SERÁ? 🎯', className: 'from-purple-600 to-fuchsia-700 animate-pulse' }
      : state.paused && state.mode !== 'finished'
        ? { text: '⏸ PAUSADO ⏸', className: 'from-gray-600 to-gray-800' }
        : null;
  const boxStyle = { ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) };

  return (
    <div className="theme-die-frame relative flex flex-col gap-6 px-12 pb-10 pt-16 font-sans overflow-hidden" {...overlayRootProps(customize, { width: SIZE, height: SIZE, ...resolveBackgroundStyle(customize) })}>
      {banner && (
        // impeccable-disable-next-line ai-color-palette: mismas franjas de estado que el overlay de juegos
        <div style={labelScaleStyle(customize)} className={`tkc-ovl-fill absolute top-0 left-0 w-full bg-gradient-to-r text-center font-black text-white uppercase tracking-[0.3em] text-xl py-3 shadow-lg ${banner.className}`}>{banner.text}</div>
      )}

      {/* Encabezado: a la izquierda cómo se juega, a la derecha el reloj o la fase. */}
      <div className="flex items-stretch gap-6 flex-shrink-0">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <p {...labelProps(customize, 'theme-accent-text text-base uppercase tracking-[0.3em] font-black')}>{state.offstream ? '💀 Eliminación' : '💀 Eliminación — Únete con:'}</p>
            {state.lockedMode && (
              <span className="tkc-ovl-fill bg-slate-800 border border-slate-500/60 text-slate-300 text-xs font-black uppercase tracking-widest px-3 py-1 rounded-full">🔒 Locked</span>
            )}
          </div>
          {!state.offstream && (
            <div className="flex items-center justify-between gap-4 px-6 py-3 rounded-3xl" style={boxStyle}>
              <div className="flex items-center gap-3 min-w-0">
                {state.targetGiftIcon && <img alt="" src={state.targetGiftIcon} className="w-16 h-16 drop-shadow-xl flex-shrink-0" />}
                <span className="text-[32px] leading-tight font-black text-white truncate">{state.targetGiftName}</span>
              </div>
              <span className="tkc-ovl-fill text-yellow-400 text-[28px] font-black bg-yellow-400/10 border border-yellow-400/20 px-4 py-1 rounded-2xl shadow-inner flex-shrink-0">{state.targetGiftCoins} 🪙</span>
            </div>
          )}
          {state.instaWinGiftName && (
            <div className="tkc-ovl-fill flex items-center justify-between gap-4 bg-yellow-900/30 border border-yellow-600/50 px-6 py-2 rounded-2xl">
              <div className="flex items-center gap-3 min-w-0">
                {state.instaWinGiftIcon && <img alt="" src={state.instaWinGiftIcon} className="w-10 h-10 flex-shrink-0" />}
                <div className="text-left leading-tight min-w-0">
                  <span {...labelProps(customize, 'block text-xs uppercase tracking-widest text-yellow-500 font-bold')}>O Insta-Win:</span>
                  <span className="text-xl font-bold text-yellow-100 truncate block">{state.instaWinGiftName}</span>
                </div>
              </div>
              <span className="tkc-ovl-fill text-yellow-400 text-xl font-black bg-yellow-500/20 px-3 py-1 rounded-xl flex-shrink-0">{state.instaWinGiftCoins} 🪙</span>
            </div>
          )}
          <div style={{ zoom: 1.4 }}><PrizeStrip prize={prize} customize={customize} /></div>
          <div className="flex items-center gap-4" style={{ zoom: 1.3 }}>
            <TimeWarningBadge label="Reingreso" seconds={state.rejoinTime} customize={customize} />
          </div>
        </div>

        <div className="w-[340px] flex-shrink-0 rounded-[2.5rem] px-6 py-5 flex flex-col items-center justify-center text-center gap-2" style={boxStyle}>
          {state.mode === 'finished' ? (
            state.winner
              ? <div className="text-[44px] leading-none font-black tracking-wide text-yellow-400 animate-pulse">¡GANADOR!</div>
              : <div className="text-[36px] leading-none font-black tracking-wide text-red-500">SIN GANADOR</div>
          ) : state.mode === 'revealing' ? (
            <div className="w-full">
              <p className="text-[32px] font-black text-fuchsia-300 uppercase tracking-widest animate-pulse" style={labelScaleStyle(customize)}>🎲 Sorteando...</p>
              <PhaseProgressBar active durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
            </div>
          ) : state.mode === 'result' ? (
            <div className="w-full">
              <p className="text-[32px] font-black text-red-300 uppercase tracking-widest" style={labelScaleStyle(customize)}>💀 Eliminados</p>
              <PhaseProgressBar active durationMs={state.revealResultMs} colorClass="bg-red-400" />
            </div>
          ) : (
            <>
              <p {...labelProps(customize, 'text-sm uppercase tracking-[0.4em] text-gray-500 font-bold')}>{state.paused ? 'PAUSADO' : timerTitle}</p>
              <p className={`text-[80px] leading-none font-black tabular-nums tracking-tighter transition-colors ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>
            </>
          )}
          <p {...labelProps(customize, 'text-base font-bold text-gray-400 mt-1')}>
            {players.toLocaleString('es-MX')} {players === 1 ? 'jugador' : 'jugadores'} · {participants.length.toLocaleString('es-MX')} {participants.length === 1 ? 'entrada' : 'entradas'}
          </p>
        </div>
      </div>

      {/* Burbujas: todo el resto del cuadrado (ver ElimParticipantsGrid). */}
      <ElimParticipantsGrid state={state} customize={customize} maxSize={140} summaryScale={2.4}>
        {state.mode === 'finished' ? (
          state.winner ? (
            <div className="flex flex-col items-center gap-6 animate-pop">
              <div className="relative">
                {/* impeccable-disable-next-line bounce-easing: el rebote de la corona del ganador es parte de la identidad del show (decisión del dueño) */}
                <div className="absolute -top-24 -right-16 text-[140px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-2xl opacity-60 bg-yellow-500" />
                <img alt="" src={state.winner.avatar} className="w-72 h-72 rounded-full border-8 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
              <p className={`text-[56px] leading-none font-black text-yellow-400 ${nameOverride.className}`} style={nameOverride.cssVars}>@{state.winner.username}</p>
            </div>
          ) : <span />
        ) : state.mode === 'result' ? (
          // Margen arriba: la calavera del resultado sobresale de la foto y la grilla recorta lo que se sale.
          <div className="pt-20" style={{ zoom: 1.9 }}><EliminationResultVisual list={state.lastEliminatedList} customize={customize} /></div>
        ) : null}
      </ElimParticipantsGrid>
    </div>
  );
}
