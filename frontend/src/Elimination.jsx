import { HowItWorks, StartRequirement, LiveTag, LiveAppliedNote, ConfirmButton, GameStage, SettingsTitle } from './PanelHelp';
import { liveKey, useLiveApplied, useActionLock } from './liveApply';
import { useState, useEffect, useRef, useMemo } from 'react';
import GiftPicker from './GiftPicker';
import ElimEntriesManager from './ElimEntriesManager';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { useEventDraft } from './app/eventSettingsContext';


const NO_PARTICIPANTS = [];

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'Ninguno',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

// Los bloques de participantes se van achicando a medida que hay más gente,
// para que el recuadro siga cabiendo todo el elenco.
function sizeFor(count) {
  if (count <= 8)  return { box: 'w-16 h-16', text: 'text-[9px]', emoji: 'text-2xl' };
  if (count <= 16) return { box: 'w-12 h-12', text: 'text-[9px]', emoji: 'text-lg'  };
  if (count <= 30) return { box: 'w-9 h-9',   text: 'text-[8px]', emoji: 'text-sm'  };
  return               { box: 'w-7 h-7',   text: 'text-[8px]', emoji: 'text-xs'  };
}

function ParticipantBlock({ p, size }) {
  // Puede haber varios bloques con el mismo username: cada regalo (incluso
  // repetido por el mismo usuario) inserta su propio slot/bloque.
  return (
    <div className="flex flex-col items-center gap-0.5" title={p.username}>
      <img alt="" loading="lazy" src={p.avatar} className={`${size.box} rounded-full border-2 object-cover flex-shrink-0`} style={{ borderColor: 'var(--accent)' }} />
      <span className={`${size.text} text-gray-300 max-w-[56px] truncate`}>@{p.username}</span>
    </div>
  );
}

// Nombre de cada fase en el escenario.
const PHASE = {
  joining:   { phase: 'Tiempo para unirse', tone: 'live' },
  revealing: { phase: 'Sorteando…', tone: 'live' },
  result:    { phase: 'Resultado del sorteo', tone: 'live' },
  rejoin:    { phase: 'Tiempo de reingreso', tone: 'snipe' },
};

// ─────────────────────────────────────────────
// ELIMINACIÓN
// Fase 1 (baseTime): se abre un tiempo para unirse mandando un regalo
// específico. Al agotarse, se elimina al azar a un participante y se abre
// una ventana de rejoin (ajustable) donde cualquiera puede (re)entrar
// mandando el mismo regalo. Si nadie entra y solo queda 1, ese gana; si
// entra alguien, se repite la eliminación hasta que quede un sobreviviente.
// También tiene, igual que Rey del Trono, un regalo Insta-Win que declara
// ganador instantáneo a quien lo mande.
// La conexión TikTok (username/connectionStatus/giftsList) viene
// normalizada desde App.jsx, compartida con los demás módulos.
// ─────────────────────────────────────────────
export default function Elimination({ state, socket, username, connectionStatus, giftsList, prize }) {
  // Lo último configurado en la cuenta sin llegar a presionar Iniciar (ver
  // eventSettingsStore.js) -- el servidor sigue ganando en cuanto la dinámica se
  // arrancó alguna vez (ni siquiera se borra al detenerla).
  const [draft, saveDraft] = useEventDraft('elim');
  const [startError, setStartError] = useState('');
  const [selectedGift, setSelectedGift]         = useState(() => state.targetGiftCoins > 0 ? { name: state.targetGiftName, icon: state.targetGiftIcon, coins: state.targetGiftCoins } : (draft.selectedGift ?? null));
  const [selectedInstaWin, setSelectedInstaWin] = useState(() => state.instaWinGiftCoins > 0 ? { name: state.instaWinGiftName, icon: state.instaWinGiftIcon, coins: state.instaWinGiftCoins } : (draft.selectedInstaWin ?? NO_INSTA_WIN));
  const [baseTime, setBaseTime]                 = useState(() => state.isActive ? (state.baseTime ?? 60) : (draft.baseTime ?? 60));
  const [rejoinTime, setRejoinTime]             = useState(() => state.isActive ? (state.rejoinTime ?? 20) : (draft.rejoinTime ?? 20));
  // fastMode: fases de selección/resultado de 1s en vez de 2s.
  // eliminationsPerRound: cuántos slots caen por ronda de sorteo (antes
  // siempre 1). lockedMode: solo entra gente durante la ventana inicial de
  // unirse, nadie se suma ya arrancada la dinámica (ni en "rejoin").
  const [fastMode, setFastMode]                 = useState(() => state.isActive ? (state.fastMode ?? false) : (draft.fastMode ?? false));
  const [eliminationsPerRound, setEliminationsPerRound] = useState(() => state.isActive ? (state.eliminationsPerRound ?? 1) : (draft.eliminationsPerRound ?? 1));
  const [lockedMode, setLockedMode]             = useState(() => state.isActive ? (state.lockedMode ?? false) : (draft.lockedMode ?? false));
  // Fase final (pedido explícito: "de 100 en 100 hasta que queden 15 y de ahí
  // de 1 en 1"): con finalPhaseAt > 0, al quedar esa cantidad de entradas o
  // menos caen finalPhasePerRound por ronda. 0 = sin fase final.
  // Offstream (pedido explícito): la misma dinámica solo con entradas
  // manuales, sin TikTok. Se elige antes de iniciar; con la ronda en curso
  // manda lo que dice el servidor.
  const [offstreamDraft, setOffstreamDraft]     = useState(() => draft.offstream ?? false);
  const offstream = state.isActive ? !!state.offstream : offstreamDraft;
  const [finalPhaseAt, setFinalPhaseAt]         = useState(() => state.isActive ? (state.finalPhaseAt ?? 0) : (draft.finalPhaseAt ?? 0));
  const [finalPhasePerRound, setFinalPhasePerRound] = useState(() => state.isActive ? (state.finalPhasePerRound ?? 1) : (draft.finalPhasePerRound ?? 1));

  useEffect(() => {
    saveDraft({ selectedGift, selectedInstaWin, baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound, offstream: offstreamDraft });
  }, [selectedGift, selectedInstaWin, baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound, offstreamDraft, saveDraft]);

  // Sincronización en tiempo real cuando hay concurso activo.
  // Igual que en Zubastinis: solo emitimos si el cambio es en los ajustes
  // (no en el montaje ni justo cuando isActive cambia), para no pisar los
  // valores de otra pestaña que también tenga este panel abierto.
  const isMounted = useRef(false);
  const prevActive = useRef(state.isActive);
  useEffect(() => {
    const activeJustChanged = prevActive.current !== state.isActive;
    prevActive.current = state.isActive;

    if (!isMounted.current) { isMounted.current = true; return; }
    if (activeJustChanged) return;

    // Offstream no lleva regalo: los tiempos y demás ajustes se mandan igual.
    if (state.isActive && (selectedGift || state.offstream)) {
      socket.emit('update_elim_settings', {
        targetGiftName:    selectedGift?.name ?? '',
        targetGiftIcon:    selectedGift?.icon ?? '',
        targetGiftCoins:   selectedGift?.coins ?? 0,
        instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
        instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
        instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
        baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound,
      });
    }
    // Cambiar de socket (reconexión) no debe re-enviar los ajustes: solo cuando el streamer los cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGift, selectedInstaWin, baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound, state.isActive]);

  const startElimination = () => {
    setStartError('');
    if (offstreamDraft) {
      // Sin TikTok: no hace falta LIVE ni regalo; el servidor deja los regalos vacíos.
      socket.emit('start_elimination', { offstream: true, baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound });
      return;
    }
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (!selectedGift) return setStartError('¡Elige el regalo para unirse!');
    socket.emit('start_elimination', {
      tiktokUsername: username,
      targetGiftName:    selectedGift.name,
      targetGiftIcon:    selectedGift.icon,
      targetGiftCoins:   selectedGift.coins,
      instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
      instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
      instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
      baseTime, rejoinTime, fastMode, eliminationsPerRound, lockedMode, finalPhaseAt, finalPhasePerRound,
    });
  };

  // Confirmación de los cambios en vivo y protección de los botones (ver
  // liveApply.js).
  const appliedPhase = useLiveApplied({
    active: state.isActive,
    localKey: liveKey([offstream ? 0 : (selectedGift?.coins ?? 0), offstream ? 0 : (selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0), baseTime, rejoinTime, !!fastMode, eliminationsPerRound, !!lockedMode, finalPhaseAt, finalPhasePerRound]),
    serverKey: liveKey([state.targetGiftCoins ?? 0, state.instaWinGiftCoins ?? 0, state.baseTime, state.rejoinTime, !!state.fastMode, state.eliminationsPerRound, !!state.lockedMode, state.finalPhaseAt ?? 0, state.finalPhasePerRound ?? 1]),
  });
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}:${state.mode}`);
  const hasProgress = state.isActive && state.mode !== 'finished' && (state.participants?.length ?? 0) > 0;

  const stopElimination    = () => socket.emit('stop_elimination');
  const restartElimination = () => socket.emit('restart_elimination');
  const togglePause        = () => socket.emit(state.paused ? 'resume_elimination' : 'pause_elimination');

  // Pedido explícito: una vez arrancada la ronda con Locked Mode activado,
  // no se puede desactivar hasta Detener/Reiniciar — el toggle queda
  // deshabilitado visualmente en ese caso. Prender sí se puede en cualquier
  // momento (el backend además lo refuerza con el mismo criterio, ver
  // update_elim_settings).
  const lockedModeLocked = state.isActive && lockedMode;

  // Los ajustes se pueden tocar en cualquier momento, sin LIVE conectado (pedido
  // explícito); solo el botón START exige "connected" a secas.
  const participants = state.participants || NO_PARTICIPANTS;
  const size = sizeFor(participants.length);
  const distinctCount = new Set(participants.map(p => p.username)).size;
  // Cuántos slots tiene EXACTAMENTE cada participante (alguien con 3 slots
  // tiene 3x más chances de perder uno en el próximo sorteo).
  const slotCounts = useMemo(() => {
    const counts = {};
    for (const p of participants) counts[p.username] = (counts[p.username] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [participants]);

  // Fase del juego para el escenario: qué está pasando y con qué tono.
  const stage = !state.isActive ? { phase: 'Sin iniciar', tone: 'idle' }
    : state.mode === 'finished' ? (state.winner ? { phase: 'Terminado', tone: 'finished' } : { phase: 'Sin ganador', tone: 'nowinner' })
    : state.paused ? { phase: 'En pausa', tone: 'paused' }
    : PHASE[state.mode] || { phase: 'En curso', tone: 'live' };

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:p-6 sm:pt-8 font-sans flex-1">
      {/* Vista previa + premio a la izquierda y ajustes a la derecha en escritorio; una columna en móvil (ver .tkc-game-layout). */}
      <div className="tkc-game-layout">

      {/* Escenario: quién sigue en pie, quién acaba de caer y cuánto falta. */}
      <GameStage title={offstream ? 'Eliminación · Offstream' : 'Eliminación'} phase={stage.phase} tone={stage.tone} timer={formatMMSS(state.timeLeft || 0)}>
        {(state.lastEliminatedList || []).length > 0 && state.mode !== 'idle' && (
          <ul className="flex flex-col gap-1.5" aria-label="Último sorteo">
            {state.lastEliminatedList.map((e, i) => (
              <li key={e.username + i} className="theme-notice flex items-center gap-2">
                <img alt="" src={e.avatar} className="w-7 h-7 rounded-full object-cover grayscale" />
                <span>@{e.username} {e.final === false ? 'perdió una entrada (sigue en pie)' : 'fue eliminado'}</span>
              </li>
            ))}
          </ul>
        )}

        {state.mode === 'finished' ? (
          <p className="tkc-stage-result" data-tone={state.winner ? 'finished' : 'nowinner'}>
            {state.winner ? `Ganador: @${state.winner.username}` : 'Sin ganador: nadie participó.'}
          </p>
        ) : participants.length > 0 ? (
          <>
            <p className="tkc-meta -mt-2">
              {distinctCount} participante{distinctCount === 1 ? '' : 's'} en pie · {participants.length} entrada{participants.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-h-52 overflow-y-auto">
              {participants.map(p => <ParticipantBlock key={p.id} p={p} size={size} />)}
            </div>
          </>
        ) : (
          <p className="tkc-stage-empty">{offstream ? 'Nadie todavía. Agrega participantes en "Participantes y entradas".' : 'Nadie se ha unido todavía. Entran al mandar el regalo para unirse.'}</p>
        )}

        {/* Cuántas entradas tiene cada uno, para saber quién arriesga más en el
            próximo sorteo (a más entradas, más chances de perder una). */}
        {slotCounts.length > 0 && state.mode !== 'finished' && (
          <ol className="max-h-32 overflow-y-auto flex flex-col gap-1" aria-label="Entradas por participante">
            {slotCounts.map(([username, count]) => (
              <li key={username} className="tkc-stage-row py-1.5">
                <span className="flex-1 text-white text-xs font-semibold truncate">@{username}</span>
                <span className="tkc-coins text-xs">{count} entrada{count === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ol>
        )}
      </GameStage>

      {/* Settings */}
      <div className="theme-surface tkc-game-main w-full p-6 sm:p-8 relative">
        <SettingsTitle />

        <HowItWorks storageKey="elim">
        <p>Con <span className="font-bold text-white">Offstream</span> se juega igual pero solo con entradas manuales, sin conectar TikTok.</p>
        <p>Primero se abre un tiempo para <span className="font-bold text-white">unirse mandando el regalo</span> elegido. Al agotarse, se elimina a un participante al azar.</p>
        <p>Después se abre una ventana para que cualquiera (re)entre con el mismo regalo. Se repite hasta que queda un sobreviviente. El <span className="font-bold text-white">Insta-Win</span> declara ganador al instante a quien lo mande.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Offstream: solo entradas manuales, sin TikTok */}
            <div className="tkc-field">
              <button type="button" onClick={() => !state.isActive && setOffstreamDraft(o => !o)} aria-pressed={offstream}
                disabled={state.isActive}
                className={`tkc-option w-full justify-center ${state.isActive ? 'opacity-70 cursor-not-allowed' : ''}`}
                title={state.isActive ? 'Se elige antes de iniciar: detén la ronda para cambiarlo' : 'Jugar solo con entradas manuales, sin conectar TikTok'}>
                <span className="tkc-option-label">Offstream (sin TikTok)</span>
              </button>
              <p className="tkc-hint mt-1">
                {offstream
                  ? 'Solo entradas manuales: los regalos no cuentan y no hace falta estar en LIVE. Agrega a los participantes abajo, en "Participantes y entradas".'
                  : 'Actívalo para jugar solo con entradas manuales, sin conectar TikTok.'}
                {state.isActive && ' Se cambia al detener la ronda.'}
              </p>
            </div>

            {!offstream && (<>
            {/* Selector regalo para unirse */}
            <div className="tkc-field relative z-20">
              <label className="tkc-field-label">Regalo para unirse<LiveTag active={state.isActive} title="Los regalos que lleguen desde ahora cuentan con el nuevo valor" /></label>
              <GiftPicker
                gifts={giftsList.filter(g => g.coins > 0)}
                selected={selectedGift}
                onSelect={setSelectedGift}
                placeholder="Elige un regalo..."
              />
              <p className="tkc-hint mt-1">
                Cualquier regalo cuenta — se convierte a entradas según su valor en monedas comparado con este (ej: si eliges uno de 1 moneda, un regalo de 30 monedas da 30 entradas). Varios regalos seguidos de la misma persona se suman entre sí si no pasan más de 10s entre uno y otro.
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
            </>)}

            {/* Base Time */}
            <div className="tkc-field">
              <label className="tkc-field-label">
                Tiempo para unirse<LiveTag active={state.isActive} title="Si el tiempo para unirse está corriendo, salta al tiempo nuevo; si no, se usa en la próxima ronda" />
              </label>
              <TimeInput seconds={baseTime} onChange={setBaseTime} />
            </div>

            {/* Rejoin Time */}
            <div className="tkc-field">
              <label className="tkc-field-label" data-tone="danger">
                Tiempo de reingreso<LiveTag active={state.isActive} title="Si el reingreso está corriendo, salta al tiempo nuevo; si no, se usa en el próximo" />
              </label>
              <TimeInput seconds={rejoinTime} onChange={setRejoinTime} />
            </div>

            {/* Cuántos caen por ronda */}
            <div className="tkc-field">
              <label className="tkc-field-label">Eliminados por ronda<LiveTag active={state.isActive} title="Se usa en el próximo sorteo" /></label>
              <input
                type="number" min="1" inputMode="numeric" value={eliminationsPerRound}
                onChange={e => setEliminationsPerRound(Math.max(1, Number(e.target.value) || 1))}
                className="theme-input w-20 p-2 text-center text-sm font-bold outline-none"
              />
              <p className="tkc-hint mt-1">Cuántas entradas se eliminan de una en cada sorteo (siempre deja al menos 1 participante en pie).</p>
            </div>

            {/* Fase final: cambia cuántos caen por ronda al quedar pocas entradas */}
            <div className="tkc-field">
              <label className="tkc-field-label">Fase final<LiveTag active={state.isActive} title="Se usa en el próximo sorteo" /></label>
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
                <span>Cuando queden</span>
                <input
                  type="number" min="0" inputMode="numeric" value={finalPhaseAt} aria-label="Entradas con las que empieza la fase final"
                  onChange={e => setFinalPhaseAt(Math.max(0, Number(e.target.value) || 0))}
                  className="theme-input w-20 p-2 text-center text-sm font-bold outline-none"
                />
                <span>entradas o menos, eliminar</span>
                <input
                  type="number" min="1" inputMode="numeric" value={finalPhasePerRound} aria-label="Eliminados por ronda en la fase final"
                  onChange={e => setFinalPhasePerRound(Math.max(1, Number(e.target.value) || 1))}
                  disabled={!finalPhaseAt}
                  className="theme-input w-20 p-2 text-center text-sm font-bold outline-none disabled:opacity-50"
                />
                <span>por ronda</span>
              </div>
              <p className="tkc-hint mt-1">
                {finalPhaseAt > 0
                  ? `Se eliminan ${eliminationsPerRound} por ronda hasta llegar a ${finalPhaseAt} entradas (una ronda nunca baja de ahí) y desde ahí ${finalPhasePerRound} por ronda.`
                  : 'Deja 0 para eliminar siempre la misma cantidad por ronda. Ejemplo: 100 por ronda y fase final en 15 con 1 por ronda.'}
              </p>
            </div>

            {/* Fast Mode / Locked Mode */}
            <div className="tkc-field flex gap-3 mb-6">
              <button type="button" onClick={() => setFastMode(f => !f)} aria-pressed={!!fastMode}
                className="tkc-option flex-1 justify-center"
                title="Reduce las animaciones de sorteo/resultado a la mitad (1s en vez de 2s)">
                <span className="tkc-option-label">Fast Mode</span>
              </button>
              <button type="button" onClick={() => !lockedModeLocked && setLockedMode(l => !l)} aria-pressed={!!lockedMode}
                disabled={lockedModeLocked}
                className={`tkc-option flex-1 justify-center ${lockedModeLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                title={lockedModeLocked ? 'No se puede desactivar hasta Detener o Reiniciar la ronda' : 'Solo participa quien entró durante el tiempo para unirse inicial — nadie nuevo se suma después'}>
                <span className="tkc-option-label">Locked Mode</span>
              </button>
            </div>
            {lockedModeLocked && <p className="tkc-hint -mt-4 mb-4">Locked Mode no se puede apagar con la ronda en curso: así nadie entra a último momento. Se libera al detener o reiniciar.</p>}
            <LiveAppliedNote phase={appliedPhase} />

            {/* Entradas a mano (agregar, corregir, quitar, combinar): ver
                ElimEntriesManager.jsx. A propósito ignoran Locked Mode: es una
                acción explícita del streamer, no una entrada automática. */}
            <ElimEntriesManager state={state} socket={socket} />

          </div>

        </div>
      </div>

      {/* Controles del juego: en escritorio, bajo la vista previa (estado y
          botones juntos, sin bajar hasta el final de los ajustes); en móvil,
          después de los ajustes, como antes (ver .tkc-game-layout). */}
      <div className="theme-surface tkc-game-controls w-full p-4 sm:p-5">
        {/* Offstream no necesita LIVE: sin el aviso de conexión. */}
        <StartRequirement connectionStatus={offstream ? 'connected' : connectionStatus} active={state.isActive} error={startError} />
        {!state.isActive && !offstream && connectionStatus === 'connected' && !selectedGift && <p role="status" className="theme-notice theme-notice-warning mb-3">Elige el regalo para unirse para iniciar.</p>}

        {/* Botones */}
        <div className="flex flex-wrap gap-3">
          {!state.isActive ? (
            <button
              onClick={() => runLocked(startElimination)}
              disabled={offstream ? actionLocked : (connectionStatus !== 'connected' || !selectedGift || actionLocked)}
              className="theme-btn-primary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {offstream ? 'INICIAR OFFSTREAM' : connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                // Pausa solo durante el tiempo para unirse (lo valida también el
                // servidor); reanudar, siempre que esté pausado.
                disabled={state.mode === 'finished' || (!state.paused && state.mode !== 'joining')}
                title={!state.paused && state.mode !== 'joining' ? 'Solo se puede pausar durante el tiempo para unirse' : undefined}
                className="theme-btn-secondary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.paused ? 'REANUDAR' : 'PAUSAR'}
              </button>
              <ConfirmButton
                needsConfirm={hasProgress}
                onConfirm={() => runLocked(restartElimination)}
                disabled={actionLocked}
                className="theme-btn-warning theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                REINICIAR
              </ConfirmButton>
            </>
          )}
          <ConfirmButton
            needsConfirm={hasProgress}
            onConfirm={stopElimination}
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
