import { HowItWorks, StartRequirement, LiveTag, LiveAppliedNote, ConfirmButton, GameStage, SettingsTitle } from './PanelHelp';
import { liveKey, useLiveApplied, useActionLock } from './liveApply';
import { useState, useEffect, useRef } from 'react';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { useEventDraft } from './app/eventSettingsContext';




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
  // Lo último configurado en la cuenta sin llegar a presionar Iniciar (ver
  // eventSettingsStore.js) -- mientras el concurso está EN VIVO manda el servidor
  // (antes ni siquiera se intentaba leer de ahí: el panel siempre arrancaba en
  // 60/15/15/0 aunque hubiera una ronda activa con otros valores).
  const [draft, saveDraft] = useEventDraft('zub');
  const [startError, setStartError] = useState('');
  const [mainTime, setMainTime]         = useState(() => state.isActive ? (state.mainTime ?? 60) : (draft.mainTime ?? 60));
  const [snipeTime, setSnipeTime]       = useState(() => state.isActive ? (state.snipeTime ?? 15) : (draft.snipeTime ?? 15));
  const [tiebreakTime, setTiebreakTime] = useState(() => state.isActive ? (state.tiebreakTime ?? 15) : (draft.tiebreakTime ?? 15));
  const [minCoins, setMinCoins]         = useState(() => state.isActive ? (state.minCoins ?? 0) : (draft.minCoins ?? 0)); // 0 = NO MINIMUM

  useEffect(() => {
    saveDraft({ mainTime, snipeTime, tiebreakTime, minCoins });
  }, [mainTime, snipeTime, tiebreakTime, minCoins, saveDraft]);

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

  // Confirmación de los cambios en vivo y protección de los botones (ver
  // liveApply.js).
  const appliedPhase = useLiveApplied({
    active: state.isActive,
    localKey: liveKey([mainTime, snipeTime, tiebreakTime, minCoins || 0]),
    serverKey: liveKey([state.mainTime, state.snipeTime, state.tiebreakTime, state.minCoins || 0]),
  });
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}:${state.mode}`);
  const hasProgress = state.isActive && state.mode !== 'finished' && (state.top3?.length ?? 0) > 0;

  const stopZubastinis    = () => socket.emit('stop_zubastinis');
  const restartZubastinis = () => socket.emit('restart_zubastinis');
  const togglePause       = () => socket.emit(state.paused ? 'resume_zubastinis' : 'pause_zubastinis');

  // Los ajustes se pueden tocar en cualquier momento, sin LIVE conectado (pedido
  // explícito); solo el botón START exige "connected" a secas.
  const top3 = state.top3 || [];

  const noWinnerMessage = state.mode === 'finished' && !state.winner
    ? (state.noWinnerReason === 'minimum'
        ? `Nadie alcanzó el mínimo de ${state.minCoins} monedas: sin ganador.`
        : 'Sin ganador: nadie participó.')
    : null;

  // Fase del juego para el escenario: qué está pasando y con qué tono.
  const stage = !state.isActive ? { phase: 'Sin iniciar', tone: 'idle' }
    : state.mode === 'finished' ? (state.winner ? { phase: 'Terminado', tone: 'finished' } : { phase: 'Sin ganador', tone: 'nowinner' })
    : state.paused ? { phase: 'En pausa', tone: 'paused' }
    : state.mode === 'snipe' ? { phase: 'Snipe: último aviso', tone: 'snipe' }
    : state.mode === 'tiebreak' ? { phase: 'Desempate', tone: 'tiebreak' }
    : { phase: 'En curso', tone: 'live' };

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:p-6 sm:pt-8 font-sans flex-1">
      {/* Vista previa + premio a la izquierda y ajustes a la derecha en escritorio; una columna en móvil (ver .tkc-game-layout). */}
      <div className="tkc-game-layout">

      {/* Escenario: el top 3 en vivo y cuánto falta. */}
      <GameStage title="Zubastinis" phase={stage.phase} tone={stage.tone} timer={formatMMSS(state.timeLeft || 0)}>
        <p className="tkc-meta -mt-2">Mínimo para ganar: {minCoins > 0 ? `${minCoins} monedas` : 'sin mínimo'}</p>
        {top3.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {top3.map((g, i) => (
              <li key={g.username} className="tkc-stage-row">
                <span className={`tkc-rank ${i === 0 ? 'tkc-rank-1' : ''}`} aria-label={`Puesto ${i + 1}`}>{i + 1}</span>
                <img alt="" src={g.avatar} className="w-8 h-8 rounded-full object-cover" />
                <span className="flex-1 font-bold text-white text-sm truncate">@{g.username}</span>
                <span className="tkc-coins">{g.coins} monedas</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="tkc-stage-empty">Nadie ha regalado todavía. Aquí aparece el top 3 en cuanto lleguen regalos.</p>
        )}
        {state.mode === 'finished' && (
          <p className="tkc-stage-result" data-tone={state.winner ? 'finished' : 'nowinner'}>
            {state.winner ? `Ganador: @${state.winner.username} con ${state.winner.coins} monedas` : noWinnerMessage}
          </p>
        )}
      </GameStage>

      {/* Panel principal de configuración */}
      <div className="theme-surface tkc-game-main w-full p-6 sm:p-8 relative">
        <SettingsTitle />

        <HowItWorks storageKey="zub">
        <p>El reloj arranca en cuanto pulsas iniciar. Al terminar el tiempo gana quien <span className="font-bold text-white">más monedas haya regalado</span> en total.</p>
        <p>Puedes poner un mínimo de monedas para poder ganar y un tiempo de desempate por si hay empate en el primer puesto.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Base Time */}
            <div className="tkc-field">
              <label className="tkc-field-label">
                Tiempo base<LiveTag active={state.isActive} title="Si el reloj principal está corriendo, salta al tiempo nuevo" />
              </label>
              <TimeInput seconds={mainTime} onChange={setMainTime} />
            </div>

            {/* Snipe Time */}
            <div className="tkc-field">
              <label className="tkc-field-label" data-tone="danger">
                Tiempo de snipe<LiveTag active={state.isActive} title="Si el snipe está corriendo, salta al tiempo nuevo" />
              </label>
              <TimeInput seconds={snipeTime} onChange={setSnipeTime} />
            </div>

            {/* Tiebreak Time */}
            <div className="tkc-field">
              <label className="tkc-field-label" data-tone="warning">
                Tiempo de desempate<LiveTag active={state.isActive} title="Si el desempate está corriendo, salta al tiempo nuevo" />
              </label>
              <TimeInput seconds={tiebreakTime} onChange={setTiebreakTime} />
            </div>

            {/* Minimum */}
            <div className="tkc-field">
              <label className="tkc-field-label">
                Mínimo para ganar<LiveTag active={state.isActive} title="Se revisa al terminar el tiempo" />
              </label>
              <input
                type="number" min="0" step="50" value={minCoins || ''}
                onChange={e => setMinCoins(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                placeholder="Sin mínimo"
                className="theme-input w-full p-3 outline-none text-sm placeholder-gray-600"
              />
              <p className="tkc-hint mt-1">Si nadie llega a este monto, el concurso termina sin ganador.</p>
            </div>
            <LiveAppliedNote phase={appliedPhase} />

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
              onClick={() => runLocked(startZubastinis)}
              disabled={connectionStatus !== 'connected' || actionLocked}
              className="theme-btn-primary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                disabled={state.mode === 'finished'}
                className="theme-btn-secondary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.paused ? 'REANUDAR' : 'PAUSAR'}
              </button>
              <ConfirmButton
                needsConfirm={hasProgress}
                onConfirm={() => runLocked(restartZubastinis)}
                disabled={actionLocked}
                className="theme-btn-warning theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                REINICIAR
              </ConfirmButton>
            </>
          )}
          <ConfirmButton
            needsConfirm={hasProgress}
            onConfirm={stopZubastinis}
            className="theme-btn-danger theme-btn-lg flex-1 sm:flex-none font-extrabold tracking-wider uppercase transition-all"
          >
            DETENER
          </ConfirmButton>
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
