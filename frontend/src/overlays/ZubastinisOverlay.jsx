import { useEffect, useRef } from 'react';
import { zubSnapshot, zubSounds } from '../eventSoundRules';
import { getUsernameOverride, resolveBackgroundStyle, rowBorder } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { MEDALS, playOverlaySounds } from './helpers';
import { OfflineCard, PrizeStrip, TimeWarningBadge } from './shared';

export function ZubastinisOverlay({ state, prize, customize }) {
  // Mismo sonido de ganador que King/Eliminación, para que el momento se
  // sienta igual sin importar el modo.
  const prevModeRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    const sounds = zubSounds(prevModeRef.current, state);
    prevModeRef.current = zubSnapshot(state);
    playOverlaySounds(sounds);
    // Solo cuando cambia el modo o el ganador: el resto del estado llega a cada rato y no debe repetir el sonido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mode, state?.winner]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard customize={customize} />;

  const top3 = state.top3 || [];
  const noWinnerMessage = state.mode === 'finished' && !state.winner
    ? (state.noWinnerReason === 'minimum' ? `Nadie llegó al mínimo de ${state.minCoins} 🪙` : 'Nadie participó')
    : null;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.mode === 'tiebreak' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-amber-500 to-amber-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🤝 DESEMPATE 🤝</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mt-3 mb-4">🏆 TOP REGALADORES</p>

      <div className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-2" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
        <span className="text-[9px] uppercase tracking-widest text-gray-400 font-bold">Mínimo para ganar:</span>
        <span className={`text-sm font-black ${state.minCoins > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
          {state.minCoins > 0 ? `${state.minCoins} 🪙` : 'Sin mínimo'}
        </span>
      </div>

      <div className="w-full mb-6">
        <PrizeStrip prize={prize} />
      </div>

      <div className="w-full flex-1 flex flex-col gap-3 justify-center">
        {top3.length > 0 ? top3.map((g, i) => (
          <div key={g.username} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${i === 0 ? 'border border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.35)]' : 'border'}`} style={i === 0 ? resolveBackgroundStyle(customize, 'var(--surface-bg-alt)') : { borderColor: 'var(--surface-border-color)', ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)') }}>
            <span className="text-2xl">{MEDALS[i]}</span>
            <img src={g.avatar} className={`w-12 h-12 rounded-full border-2 object-cover ${i === 0 ? 'border-yellow-400' : ''}`} style={i === 0 ? undefined : { borderColor: 'var(--accent)' }} />
            <span className={`flex-1 font-black text-white truncate ${getUsernameOverride(customize).className}`} style={getUsernameOverride(customize).cssVars}>@{g.username}</span>
            <span className="text-yellow-400 font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl">{g.coins} 🪙</span>
          </div>
        )) : (
          <p className="text-gray-600 text-sm italic text-center">Esperando regalos...</p>
        )}
      </div>

      <div className="w-full text-center mt-auto pt-6">
        {state.mode === 'finished' ? (
          <div className="flex flex-col items-center gap-2 py-2">
            {state.winner ? (
              <>
                <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse">¡GANADOR!</div>
                <p className="text-lg font-black text-yellow-400"><span className={getUsernameOverride(customize).className} style={getUsernameOverride(customize).cssVars}>@{state.winner.username}</span> · {state.winner.coins} 🪙</p>
              </>
            ) : (
              <>
                <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
                <p className="text-sm font-bold text-gray-400">{noWinnerMessage}</p>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">
              {state.paused ? 'PAUSADO' : state.mode === 'tiebreak' ? 'DESEMPATE' : 'TIEMPO RESTANTE'}
            </p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'tiebreak' ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>          </div>
        )}
      </div>
    </div>
  );
}
