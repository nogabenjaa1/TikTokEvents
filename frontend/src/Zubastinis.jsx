import { HowItWorks, StartRequirement } from './PanelHelp';
import { useState, useEffect, useMemo, useRef } from 'react';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { loadDraft, saveDraft } from './gameDraftStorage';

const DRAFT_KEY = 'tkc_zub_draft';


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
  // Lo último configurado en este dispositivo sin llegar a presionar Iniciar (ver
  // gameDraftStorage.js) -- mientras el concurso está EN VIVO manda el servidor
  // (antes ni siquiera se intentaba leer de ahí: el panel siempre arrancaba en
  // 60/15/15/0 aunque hubiera una ronda activa con otros valores).
  const draft = useMemo(() => loadDraft(DRAFT_KEY, {}), []);
  const [startError, setStartError] = useState('');
  const [mainTime, setMainTime]         = useState(() => state.isActive ? (state.mainTime ?? 60) : (draft.mainTime ?? 60));
  const [snipeTime, setSnipeTime]       = useState(() => state.isActive ? (state.snipeTime ?? 15) : (draft.snipeTime ?? 15));
  const [tiebreakTime, setTiebreakTime] = useState(() => state.isActive ? (state.tiebreakTime ?? 15) : (draft.tiebreakTime ?? 15));
  const [minCoins, setMinCoins]         = useState(() => state.isActive ? (state.minCoins ?? 0) : (draft.minCoins ?? 0)); // 0 = NO MINIMUM

  useEffect(() => {
    saveDraft(DRAFT_KEY, { mainTime, snipeTime, tiebreakTime, minCoins });
  }, [mainTime, snipeTime, tiebreakTime, minCoins]);

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
    // Cambiar de socket (reconexión) no debe re-enviar los ajustes: solo cuando el streamer los cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTime, snipeTime, tiebreakTime, minCoins, state.isActive]);

  const startZubastinis = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    socket.emit('start_zubastinis', { tiktokUsername: username, mainTime, snipeTime, tiebreakTime, minCoins });
  };

  const stopZubastinis    = () => socket.emit('stop_zubastinis');
  const restartZubastinis = () => socket.emit('restart_zubastinis');
  const togglePause       = () => socket.emit(state.paused ? 'resume_zubastinis' : 'pause_zubastinis');

  // Los ajustes se pueden tocar en cualquier momento, sin LIVE conectado (pedido
  // explícito); solo el botón START exige "connected" a secas.
  const top3 = state.top3 || [];

  const timerLabel = state.paused ? 'PAUSADO' : (MODE_LABEL[state.mode] || 'TIMER');
  const timerColorClass = state.paused
    ? 'text-gray-500'
    : state.mode === 'snipe' ? 'text-red-500'
    : state.mode === 'tiebreak' ? 'text-amber-400'
    : 'text-white';

  const noWinnerMessage = state.mode === 'finished' && !state.winner
    ? (state.noWinnerReason === 'minimum'
        ? `Nadie alcanzó el mínimo de ${state.minCoins} monedas — SIN GANADOR`
        : 'SIN GANADOR — nadie participó')
    : null;

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:p-6 sm:pt-8 font-sans flex-1">
      {/* Vista previa + premio a la izquierda y ajustes a la derecha en escritorio; una columna en móvil (ver .tkc-game-layout). */}
      <div className="tkc-game-layout">

      {/* Preview del leaderboard */}
      <div className="theme-surface-featured w-full p-5 relative overflow-hidden">
        {state.mode === 'finished' && (
          <div className={`absolute inset-0 animate-pulse ${state.winner ? 'bg-yellow-500/20' : 'bg-red-500/10'}`} />
        )}

        {/* Mínimo configurado, siempre visible arriba */}
        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text tkc-eyebrow">ZUBASTINIS</p>
          <span className="theme-input tkc-label px-2 py-1 text-gray-300">
            MÍNIMO: {minCoins > 0 ? `${minCoins} monedas` : 'SIN MÍNIMO'}
          </span>
        </div>

        <div className="flex justify-between items-center relative z-10 mb-3">
          {state.mode === 'tiebreak' && (
            <span className="tkc-label text-amber-400 animate-pulse">EMPATE</span>
          )}
          <div className="text-right ml-auto">
            <p className="tkc-label text-gray-500">{timerLabel}</p>
            <p className={`text-3xl font-black tabular-nums transition-colors ${timerColorClass}`}>
              {formatMMSS(state.timeLeft || 0)}
            </p>
          </div>
        </div>

        {top3.length > 0 ? (
          <div className="flex flex-col gap-2 relative z-10">
            {top3.map((g, i) => (
              <div key={g.username} className="theme-input flex items-center gap-3 px-3 py-2">
                <span className="theme-accent-text text-sm font-black w-6 text-center">{i + 1}</span>
                <img alt="" src={g.avatar} className="w-8 h-8 rounded-full border-2 object-cover" style={{ borderColor: 'var(--accent)' }} />
                <span className="flex-1 font-bold text-gray-100 text-sm truncate">@{g.username}</span>
                <span className="text-yellow-400 text-xs font-black">{g.coins} monedas</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-sm italic font-medium relative z-10">Nadie ha regalado todavía...</p>
        )}

        {state.mode === 'finished' && (
          <p className={`relative z-10 mt-3 text-center text-sm font-black ${state.winner ? 'text-yellow-300' : 'text-red-400'}`}>
            {state.winner ? `@${state.winner.username} — ${state.winner.coins} monedas` : noWinnerMessage}
          </p>
        )}
      </div>

      {/* Panel principal de configuración */}
      <div className="theme-surface tkc-game-main w-full p-6 sm:p-8 relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <HowItWorks storageKey="zub">
        <p>El reloj arranca en cuanto pulsas iniciar. Al terminar el tiempo gana quien <span className="font-bold text-white">más monedas haya regalado</span> en total.</p>
        <p>Puedes poner un mínimo de monedas para poder ganar y un tiempo de desempate por si hay empate en el primer puesto.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Base Time */}
            <div className="pt-2 mb-4">
              <label className="theme-label tkc-label block mb-1">
                TIEMPO BASE {state.isActive && <span className="text-green-400 ml-1 normal-case tracking-normal font-semibold">(EN VIVO)</span>}
              </label>
              <TimeInput seconds={mainTime} onChange={setMainTime} />
            </div>

            {/* Snipe Time */}
            <div className="mb-4">
              <label className="tkc-label text-red-400 block mb-1">
                TIEMPO DE SNIPE {state.isActive && <span className="text-green-400 ml-1 normal-case tracking-normal font-semibold">(EN VIVO)</span>}
              </label>
              <TimeInput seconds={snipeTime} onChange={setSnipeTime} />
            </div>

            {/* Tiebreak Time */}
            <div className="mb-4">
              <label className="tkc-label text-amber-400 block mb-1">
                TIEMPO DE DESEMPATE {state.isActive && <span className="text-green-400 ml-1 normal-case tracking-normal font-semibold">(EN VIVO)</span>}
              </label>
              <TimeInput seconds={tiebreakTime} onChange={setTiebreakTime} />
            </div>

            {/* Minimum */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label className="tkc-label text-gray-400">
                  MÍNIMO PARA GANAR {state.isActive && <span className="text-green-400 ml-1 normal-case tracking-normal font-semibold">(EN VIVO)</span>}
                </label>
              </div>
              <input
                type="number" min="0" step="50" value={minCoins || ''}
                onChange={e => setMinCoins(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                placeholder="SIN MÍNIMO"
                className="theme-input w-full p-3 outline-none text-sm placeholder-gray-600"
              />
              <p className="tkc-hint mt-1">Si nadie llega a este monto, el concurso termina sin ganador.</p>
            </div>

          </div>

        </div>
      </div>

      {/* Controles del juego: en escritorio, bajo la vista previa (estado y
          botones juntos, sin bajar hasta el final de los ajustes); en móvil,
          después de los ajustes, como antes (ver .tkc-game-layout). */}
      <div className="theme-surface tkc-game-controls w-full p-4 sm:p-5">
        <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />

        {/* Botones */}
        <div className="flex flex-wrap gap-3">
          {!state.isActive ? (
            <button
              onClick={startZubastinis}
              disabled={connectionStatus !== 'connected'}
              className="theme-btn-primary theme-btn-lg flex-1 font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                disabled={state.mode === 'finished'}
                className="theme-btn-secondary theme-btn-lg flex-1 font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.paused ? 'REANUDAR' : 'PAUSAR'}
              </button>
              <button
                onClick={restartZubastinis}
                className="theme-btn-warning theme-btn-lg flex-1 font-bold tracking-wide transition-all"
              >
                REINICIAR ⟲
              </button>
            </>
          )}
          <button
            onClick={stopZubastinis}
            className="theme-btn-danger theme-btn-lg font-bold transition-all"
          >
            DETENER
          </button>
        </div>
      </div>

      {/* Premio: aparte de los ajustes a propósito — se puede
          configurar antes de tener la conexión live confirmada. En
          escritorio va debajo de la vista previa (columna izquierda). */}
      <PrizeEditor socket={socket} prize={prize} />
      </div>
    </div>
  );
}
