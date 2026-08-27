import React, { useState, useEffect, useRef } from 'react';
import PrizeEditor from './PrizeEditor';

const MEDALS = ['🥇', '🥈', '🥉'];

const MODE_LABEL = {
  main:     'TIEMPO',
  snipe:    'SNIPE',
  tiebreak: 'DESEMPATE',
};

// ─────────────────────────────────────────────
// ZUBASTINIS — Top 3 gifters en un tiempo dado
// A diferencia de Rey del Trono, el reloj arranca de
// inmediato al presionar START (no espera regalos ni
// conexión), y declara ganador a quien más monedas
// haya enviado en total (con mínimo opcional y
// desempate si hay empate en el primer puesto).
// La conexión TikTok (username/connectionStatus) viene
// normalizada desde App.jsx, compartida con el King.
// ─────────────────────────────────────────────
export default function Zubastinis({ state, socket, username, connectionStatus, prize }) {
  const [mainTime, setMainTime]         = useState(60);
  const [snipeTime, setSnipeTime]       = useState(15);
  const [tiebreakTime, setTiebreakTime] = useState(15);
  const [minCoins, setMinCoins]         = useState(0); // 0 = NO MINIMUM

  // Sincronización en tiempo real cuando hay concurso activo.
  // OJO: si hay más de una pestaña/ventana con este panel abierta, cada una
  // reevaluaría este efecto en cuanto `state.isActive` cambia (por ejemplo
  // cuando OTRA pestaña arranca el concurso), y reemitiría sus propios valores
  // locales pisando los recién configurados. Por eso solo emitimos cuando
  // el cambio real es en los ajustes (no en el montaje ni justo cuando
  // isActive pasa de false→true/true→false).
  const isMounted = useRef(false);
  const prevActive = useRef(state.isActive);
  useEffect(() => {
    const activeJustChanged = prevActive.current !== state.isActive;
    prevActive.current = state.isActive;

    if (!isMounted.current) { isMounted.current = true; return; }
    if (activeJustChanged) return;

    if (state.isActive) {
      socket.emit('update_zub_settings', { mainTime, snipeTime, tiebreakTime, minCoins });
    }
  }, [mainTime, snipeTime, tiebreakTime, minCoins, state.isActive]);

  const startZubastinis = () => {
    if (connectionStatus !== 'connected') return alert('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    socket.emit('start_zubastinis', { tiktokUsername: username, mainTime, snipeTime, tiebreakTime, minCoins });
  };

  const stopZubastinis    = () => socket.emit('stop_zubastinis');
  const restartZubastinis = () => socket.emit('restart_zubastinis');
  const togglePause       = () => socket.emit(state.paused ? 'resume_zubastinis' : 'pause_zubastinis');

  // Los ajustes se pueden tocar mientras se confirma el username o la
  // conexión en vivo; el botón START, en cambio, exige "connected" a secas.
  const isLocked = connectionStatus !== 'connecting' && connectionStatus !== 'connected';
  const top3 = state.top3 || [];

  const timerLabel = state.paused ? 'PAUSADO' : (MODE_LABEL[state.mode] || 'TIMER');
  const timerColorClass = state.paused
    ? 'text-gray-500'
    : state.mode === 'snipe' ? 'text-red-500'
    : state.mode === 'tiebreak' ? 'text-amber-400'
    : 'text-white';

  const noWinnerMessage = state.mode === 'finished' && !state.winner
    ? (state.noWinnerReason === 'minimum'
        ? `Nadie alcanzó el mínimo de ${state.minCoins} 🪙 — SIN GANADOR`
        : 'SIN GANADOR — nadie participó')
    : null;

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview del leaderboard */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.mode === 'finished' && (
          <div className={`absolute inset-0 animate-pulse ${state.winner ? 'bg-yellow-500/20' : 'bg-red-500/10'}`} />
        )}

        {/* Mínimo configurado, siempre visible arriba */}
        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🏆 ZUBASTINIS</p>
          <span className="theme-input text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md text-gray-300">
            MÍNIMO: {minCoins > 0 ? `${minCoins} 🪙` : 'SIN MÍNIMO'}
          </span>
        </div>

        <div className="flex justify-between items-center relative z-10 mb-3">
          {state.mode === 'tiebreak' && (
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 animate-pulse">🤝 EMPATE</span>
          )}
          <div className="text-right ml-auto">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{timerLabel}</p>
            <p className={`text-3xl font-black tabular-nums transition-colors ${timerColorClass}`}>
              {state.timeLeft || 0}<span className="text-base text-gray-600">s</span>
            </p>
          </div>
        </div>

        {top3.length > 0 ? (
          <div className="flex flex-col gap-2 relative z-10">
            {top3.map((g, i) => (
              <div key={g.username} className="theme-input flex items-center gap-3 px-3 py-2">
                <span className="text-lg w-6 text-center">{MEDALS[i]}</span>
                <img src={g.avatar} className="w-8 h-8 rounded-full border-2 border-purple-500 object-cover" />
                <span className="flex-1 font-bold text-gray-100 text-sm truncate">@{g.username}</span>
                <span className="text-yellow-400 text-xs font-black">{g.coins} 🪙</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-sm italic font-medium relative z-10">Nadie ha regalado todavía...</p>
        )}

        {state.mode === 'finished' && (
          <p className={`relative z-10 mt-3 text-center text-sm font-black ${state.winner ? 'text-yellow-300' : 'text-red-400'}`}>
            {state.winner ? `👑 @${state.winner.username} — ${state.winner.coins} 🪙` : noWinnerMessage}
          </p>
        )}
      </div>

      {/* Panel principal de configuración */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <div className="space-y-5">
          <div className={`transition-all duration-500 ${isLocked ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>

            {/* Base Time */}
            <div className="pt-2 mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">
                  TIEMPO BASE {state.isActive && <span className="text-green-400 ml-1 text-[8px]">(EN VIVO)</span>}
                </label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{mainTime}s</span>
              </div>
              <input type="range" min="15" max="600" step="15" value={mainTime} onChange={e => setMainTime(Number(e.target.value))} />
            </div>

            {/* Snipe Time */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-red-400 font-semibold">
                  TIEMPO DE SNIPE {state.isActive && <span className="text-green-400 ml-1 text-[8px]">(EN VIVO)</span>}
                </label>
                <span className="text-red-200 font-bold bg-red-900/50 px-2 rounded text-xs">{snipeTime}s</span>
              </div>
              <input type="range" min="5" max="120" step="5" value={snipeTime} onChange={e => setSnipeTime(Number(e.target.value))} />
            </div>

            {/* Tiebreak Time */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
                  TIEMPO DE DESEMPATE {state.isActive && <span className="text-green-400 ml-1 text-[8px]">(EN VIVO)</span>}
                </label>
                <span className="text-amber-200 font-bold bg-amber-900/50 px-2 rounded text-xs">{tiebreakTime}s</span>
              </div>
              <input type="range" min="5" max="120" step="5" value={tiebreakTime} onChange={e => setTiebreakTime(Number(e.target.value))} />
            </div>

            {/* Minimum */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">
                  MÍNIMO PARA GANAR {state.isActive && <span className="text-green-400 ml-1 text-[8px]">(EN VIVO)</span>}
                </label>
              </div>
              <input
                type="number" min="0" step="50" value={minCoins || ''}
                onChange={e => setMinCoins(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                placeholder="SIN MÍNIMO"
                className="theme-input w-full p-3 outline-none text-sm placeholder-gray-600"
              />
              <p className="text-[10px] text-gray-600 mt-1">Si nadie llega a este monto, el concurso termina sin ganador.</p>
            </div>

            {/* Botones */}
            <div className="flex gap-3 flex-wrap">
              {!state.isActive ? (
                <button
                  onClick={startZubastinis}
                  disabled={connectionStatus !== 'connected'}
                  className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePause}
                    disabled={state.mode === 'finished'}
                    className="theme-btn-secondary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {state.paused ? 'REANUDAR ▶' : 'PAUSAR ⏸'}
                  </button>
                  <button
                    onClick={restartZubastinis}
                    className="theme-btn-warning flex-1 py-4 font-bold tracking-wide transition-all"
                  >
                    REINICIAR ⟲
                  </button>
                </>
              )}
              <button
                onClick={stopZubastinis}
                className="theme-btn-danger px-6 py-4 font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>

          {/* Premio: fuera del bloque isLocked a propósito — se puede
              configurar antes de tener la conexión live confirmada. */}
          <PrizeEditor socket={socket} app="zub" prize={prize} />
        </div>
      </div>
    </div>
  );
}
