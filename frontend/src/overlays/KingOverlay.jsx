import { useEffect, useRef } from 'react';
import { kingSnapshot, kingSounds } from '../eventSoundRules';
import { getUsernameOverride, resolveBackgroundStyle, rowBorder } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { playOverlaySounds } from './helpers';
import { OfflineCard, PrizeStrip, TimeWarningBadge } from './shared';

export function KingOverlay({ state, prize, customize }) {
  // Detecta transiciones para disparar sonido: robo de trono (cambia el
  // lastParticipant mientras está en 'main') y ganador. El guard `mounted`
  // evita que sonar apenas se abre/recarga el overlay a mitad de una ronda.
  const prevRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    const sounds = kingSounds(prevRef.current, state);
    prevRef.current = kingSnapshot(state);
    playOverlaySounds(sounds);
    // Solo cuando cambia el modo o el ganador: el resto del estado llega a cada rato y no debe repetir el sonido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mode, state?.lastParticipant?.username, state?.winner]);

  if (!state.isActive && state.mode !== 'finished') return <OfflineCard />;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mb-3">ROBA EL LUGAR CON:</p>
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

      <div className="my-10 w-full flex flex-col items-center">
        {state.lastParticipant ? (
          <div key={state.lastParticipant.username + state.timeLeft} className="flex flex-col items-center animate-pop">
            <div className="relative">
              {/* impeccable-disable-next-line bounce-easing: el rebote de la corona del ganador es parte de la identidad del show (decisión del dueño) */}
              {state.mode === 'finished' && <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>}
              <div className={`absolute inset-0 rounded-full blur-xl opacity-60 ${state.mode === 'finished' ? 'bg-yellow-500' : ''}`} style={state.mode === 'finished' ? undefined : { background: 'var(--accent)' }} />
              <img src={state.lastParticipant.avatar} className={`w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl ${state.mode === 'finished' ? 'border-yellow-400' : ''}`} style={state.mode === 'finished' ? undefined : { borderColor: 'var(--accent)' }} />
            </div>
            <p className={`text-2xl font-black mt-6 tracking-wide drop-shadow-md ${state.mode === 'finished' ? 'text-yellow-400' : ''} ${getUsernameOverride(customize).className}`} style={{ ...(state.mode === 'finished' ? undefined : { color: 'var(--accent-soft)' }), ...getUsernameOverride(customize).cssVars }}>@{state.lastParticipant.username}</p>
          </div>
        ) : <div className="w-32 h-32 rounded-full border-2 border-dashed flex items-center justify-center" style={{ borderColor: 'var(--surface-border-color)', background: 'color-mix(in oklch, var(--surface-bg-alt) 50%, transparent)' }}><span className="text-4xl opacity-30">👤</span></div>}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse py-4">WINNER!</div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">{state.paused ? 'PAUSADO' : state.mode === 'waiting' ? 'ESPERANDO...' : 'TIEMPO RESTANTE'}</p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'waiting' ? 'text-gray-500' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>          </div>
        )}
      </div>
    </div>
  );
}
