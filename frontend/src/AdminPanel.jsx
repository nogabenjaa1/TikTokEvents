import { HowItWorks, StartRequirement, LiveTag, LiveAppliedNote, ConfirmButton, GameStage, SettingsTitle } from './PanelHelp';
import { liveKey, useLiveApplied, useActionLock } from './liveApply';
import { useState, useEffect, useRef } from 'react';
import GiftPicker from './GiftPicker';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { useEventDraft } from './app/eventSettingsContext';


// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'Ninguno',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

// ─────────────────────────────────────────────
// ADMIN PANEL — REY DEL TRONO
// Recibe `username`/`connectionStatus`/`giftsList` como
// props: la conexión TikTok se normalizó en App.jsx y se
// comparte con Zubastinis y cualquier módulo futuro.
// ─────────────────────────────────────────────
export default function AdminPanel({ state, socket, username, connectionStatus, giftsList, prize }) {
  // Lo último que se dejó configurado en la cuenta SIN llegar a presionar
  // Iniciar (ver eventSettingsStore.js) -- se lee una sola vez al montar. El servidor
  // manda un regalo/tiempos reales en cuanto el concurso se inició alguna vez (ni
  // siquiera se borran al detenerlo), así que sigue ganando sobre el borrador.
  const [draft, saveDraft] = useEventDraft('king');
  const [startError, setStartError] = useState('');
  const [selectedGift, setSelectedGift]         = useState(() => state.targetGiftCoins > 0 ? { name: state.targetGiftName, icon: state.targetGiftIcon, coins: state.targetGiftCoins } : (draft.selectedGift ?? null));
  const [selectedInstaWin, setSelectedInstaWin] = useState(() => state.instaWinGiftCoins > 0 ? { name: state.instaWinGiftName, icon: state.instaWinGiftIcon, coins: state.instaWinGiftCoins } : (draft.selectedInstaWin ?? NO_INSTA_WIN));

  const [mainTime, setMainTime]   = useState(() => state.isActive ? (state.mainTime ?? 15) : (draft.mainTime ?? 15));
  const [snipeTime, setSnipeTime] = useState(() => state.isActive ? (state.snipeTime ?? 5) : (draft.snipeTime ?? 5));

  // Guarda el borrador en cuanto algo cambia -- aunque el concurso esté corriendo
  // (así, si se detiene, la próxima vez ya arranca con lo mismo). Nunca choca con
  // el efecto de arriba: ese manda al SERVIDOR (solo si ya está activo), este
  // guarda en ESTE dispositivo (siempre) -- cosas distintas, sin ningún guard en
  // común que compartir.
  useEffect(() => {
    saveDraft({ selectedGift, selectedInstaWin, mainTime, snipeTime });
  }, [selectedGift, selectedInstaWin, mainTime, snipeTime, saveDraft]);

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

    if (state.isActive && selectedGift) {
      socket.emit('update_settings', {
        targetGiftName:    selectedGift.name,
        targetGiftIcon:    selectedGift.icon,
        targetGiftCoins:   selectedGift.coins,
        instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
        instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
        instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
        mainTime,
        snipeTime,
      });
    }
    // Cambiar de socket (reconexión) no debe re-enviar los ajustes: solo cuando el streamer los cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGift, selectedInstaWin, mainTime, snipeTime, state.isActive]);

  const startContest = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (!selectedGift) return setStartError('¡Elige el regalo objetivo!');
    socket.emit('start_contest', {
      tiktokUsername:    username,
      targetGiftName:    selectedGift.name,
      targetGiftIcon:    selectedGift.icon,
      targetGiftCoins:   selectedGift.coins,
      instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
      instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
      instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
      mainTime,
      snipeTime,
    });
  };

  // Confirmación de los cambios en vivo y protección de los botones (ver
  // liveApply.js): Iniciar/Reiniciar no se mandan dos veces por un doble clic,
  // y Detener/Reiniciar piden confirmar si ya hay alguien en el trono.
  const appliedPhase = useLiveApplied({
    active: state.isActive,
    localKey: liveKey([selectedGift?.coins ?? 0, selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0, mainTime, snipeTime]),
    serverKey: liveKey([state.targetGiftCoins ?? 0, state.instaWinGiftCoins ?? 0, state.mainTime, state.snipeTime]),
  });
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}:${state.mode}`);
  const hasProgress = state.isActive && !!state.lastParticipant && state.mode !== 'finished';

  const stopContest    = () => socket.emit('stop_contest');
  const restartContest = () => socket.emit('restart_contest');
  const togglePause    = () => socket.emit(state.paused ? 'resume_contest' : 'pause_contest');

  // Los ajustes se pueden tocar en cualquier momento, sin LIVE conectado (pedido
  // explícito); solo el botón START exige "connected" a secas.

  // Fase del juego para el escenario: qué está pasando y con qué tono.
  const stage = !state.isActive ? { phase: 'Sin iniciar', tone: 'idle' }
    : state.mode === 'finished' ? { phase: 'Terminado', tone: 'finished' }
    : state.paused ? { phase: 'En pausa', tone: 'paused' }
    : state.mode === 'waiting' ? { phase: 'Esperando el primer regalo', tone: 'idle' }
    : state.mode === 'snipe' ? { phase: 'Snipe: último aviso', tone: 'snipe' }
    : { phase: 'En curso', tone: 'live' };

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:p-6 sm:pt-8 font-sans flex-1">
      {/* Vista previa + premio a la izquierda y ajustes a la derecha en escritorio; una columna en móvil (ver .tkc-game-layout). */}
      <div className="tkc-game-layout">

      {/* Escenario: quién tiene el trono y cuánto le queda. */}
      <GameStage title="Rey del Trono" phase={stage.phase} tone={stage.tone} timer={formatMMSS(state.timeLeft)}>
        {state.lastParticipant ? (
          <div className="flex items-center gap-3">
            <img
              src={state.lastParticipant.avatar}
              alt=""
              className="w-14 h-14 rounded-full object-cover flex-shrink-0"
              style={{ boxShadow: `0 0 0 3px ${state.mode === 'finished' ? '#10B981' : 'var(--accent)'}` }}
            />
            <div className="min-w-0">
              <p className="tkc-meta">{state.mode === 'finished' ? 'Ganador' : 'En el trono'}</p>
              <p className="font-bold text-white text-lg leading-tight truncate">@{state.lastParticipant.username}</p>
              <p className="tkc-meta truncate">{state.lastParticipant.giftName}</p>
            </div>
          </div>
        ) : (
          <p className="tkc-stage-empty">Nadie en el trono todavía. El primero que mande el regalo objetivo lo toma.</p>
        )}
      </GameStage>

      {/* Panel principal de configuración */}
      <div className="theme-surface tkc-game-main w-full p-6 sm:p-8 relative">
        <SettingsTitle />

        <HowItWorks storageKey="king">
        <p>Quien manda el <span className="font-bold text-white">regalo objetivo</span> se queda con el trono y arranca su reloj. Si otra persona manda el regalo antes de que se acabe, le quita el lugar.</p>
        <p>Gana quien tenga el trono cuando el tiempo llega a cero. El <span className="font-bold text-white">Insta-Win</span> es un regalo que da la victoria al instante.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Selector regalo normal */}
            <div className="tkc-field relative z-20">
              <label className="tkc-field-label">Regalo objetivo<LiveTag active={state.isActive} title="Los regalos que lleguen desde ahora cuentan con el nuevo valor" /></label>
              <GiftPicker
                gifts={giftsList.filter(g => g.coins > 0)}
                selected={selectedGift}
                onSelect={setSelectedGift}
                placeholder="Elige un regalo..."
              />
              <p className="tkc-hint mt-1">
                Cualquier regalo cuenta si su valor en monedas alcanza a este (acumulando varios seguidos, máximo 10s entre uno y otro) — sin importar por cuánto se pase, siempre cuenta como una sola vez.
              </p>
            </div>

            {/* Selector Insta-Win */}
            <div className="tkc-field relative z-10">
              <label className="tkc-field-label" data-tone="warning">Insta-Win<LiveTag active={state.isActive} title="Los regalos que lleguen desde ahora cuentan con el nuevo valor" /></label>
              <GiftPicker
                gifts={giftsList}
                selected={selectedInstaWin}
                onSelect={setSelectedInstaWin}
                placeholder="Elige un regalo..."
                variant="insta"
              />
              <p className="tkc-hint mt-1">
                Cualquier regalo (o suma de varios, máximo 10s entre uno y otro) que alcance este valor en monedas declara ganador al instante.
              </p>
            </div>

            {/* Base Time */}
            <div className="tkc-field">
              <label className="tkc-field-label">
                Tiempo base<LiveTag active={state.isActive} title="Si el reloj principal está corriendo, salta al tiempo nuevo; si no, se usa la próxima vez que alguien tome el trono" />
              </label>
              <TimeInput seconds={mainTime} onChange={setMainTime} />
            </div>

            {/* Snipe Time */}
            <div className="tkc-field">
              <label className="tkc-field-label" data-tone="danger">
                Tiempo de snipe<LiveTag active={state.isActive} title="Si el snipe está corriendo, salta al tiempo nuevo; si no, se usa cuando empiece" />
              </label>
              <TimeInput seconds={snipeTime} onChange={setSnipeTime} />
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
        {!state.isActive && connectionStatus === 'connected' && !selectedGift && <p role="status" className="theme-notice theme-notice-warning mb-3">Elige el regalo objetivo para iniciar.</p>}

        {/* Botones */}
        <div className="flex flex-wrap gap-3">
          {!state.isActive ? (
            <button
              onClick={() => runLocked(startContest)}
              disabled={connectionStatus !== 'connected' || !selectedGift || actionLocked}
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
                onConfirm={() => runLocked(restartContest)}
                disabled={actionLocked}
                className="theme-btn-warning theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                REINICIAR
              </ConfirmButton>
            </>
          )}
          <ConfirmButton
            needsConfirm={hasProgress}
            onConfirm={stopContest}
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
