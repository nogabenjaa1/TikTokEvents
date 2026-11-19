import { HowItWorks, StartRequirement, LiveTag, LiveAppliedNote, ConfirmButton, GameStage, SettingsTitle } from './PanelHelp';
import { liveKey, useLiveApplied, useActionLock } from './liveApply';
import { useState, useEffect, useRef } from 'react';
import GiftPicker from './GiftPicker';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { useEventDraft } from './app/eventSettingsContext';


// Los bloques de entradas se van achicando a medida que hay más gente, para
// que el recuadro siga cabiendo todo el elenco — mismo criterio que
// Eliminación (ver sizeFor en Elimination.jsx).
function sizeFor(count) {
  if (count <= 8)  return { box: 'w-16 h-16', text: 'text-[9px]', emoji: 'text-2xl' };
  if (count <= 16) return { box: 'w-12 h-12', text: 'text-[9px]', emoji: 'text-lg'  };
  if (count <= 30) return { box: 'w-9 h-9',   text: 'text-[8px]', emoji: 'text-sm'  };
  return               { box: 'w-7 h-7',   text: 'text-[8px]', emoji: 'text-xs'  };
}

function EntryBlock({ e, size }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={e.username}>
      <img alt="" loading="lazy" src={e.avatar} className={`${size.box} rounded-full border-2 object-cover flex-shrink-0`} style={{ borderColor: 'var(--accent)' }} />
      <span className={`${size.text} text-gray-300 max-w-[56px] truncate`}>@{e.username}</span>
    </div>
  );
}

const WINNER_RULE_LABELS = { first: 'Primero en salir', last: 'Último en quedar', position: 'Número específico' };
// Nombre de cada fase en el escenario.
const PHASE = {
  joining:  { phase: 'Tiempo para entrar', tone: 'live' },
  spinning: { phase: 'Girando…', tone: 'live' },
  result:   { phase: 'Resultado del giro', tone: 'live' },
};

// ─────────────────────────────────────────────
// RULETA
// Sorteo por comentario (Modo Chat: comentar una palabra clave) o por
// regalo (Modo Gift: mandar un regalo específico,
// cada uno suma una entrada — mismo mecanismo de slots que Eliminación).
// Se abre una ventana de tiempo para entrar; al vencer, el giro arranca
// SOLO (no hay botón manual): baraja todas las entradas al azar y revela
// eliminaciones una por una, más lento cerca del final, hasta la posición
// ganadora configurada (primero / último / un número específico).
// La conexión TikTok (username/connectionStatus/giftsList) viene
// normalizada desde App.jsx, compartida con los demás módulos.
// ─────────────────────────────────────────────
export default function Roulette({ state, socket, username, connectionStatus, giftsList, prize }) {
  // Lo último configurado en la cuenta sin llegar a presionar Iniciar (ver
  // eventSettingsStore.js) -- el servidor sigue ganando mientras el sorteo está EN
  // VIVO (antes estos campos siempre leían de `state`, que nunca se toca hasta
  // Iniciar/Reiniciar, así que un ajuste sin arrancar se perdía apenas se salía
  // de esta pantalla y se volvía).
  const [draft, saveDraft] = useEventDraft('roulette');
  const [startError, setStartError] = useState('');
  const [entryMode, setEntryMode]         = useState(() => state.isActive ? (state.entryMode ?? 'chat') : (draft.entryMode ?? 'chat'));
  const [keyword, setKeyword]             = useState(() => state.isActive ? (state.keyword ?? 'participo') : (draft.keyword ?? 'participo'));
  const [entryWindowSec, setEntryWindowSec] = useState(() => state.isActive ? (state.entryWindowSec ?? 300) : (draft.entryWindowSec ?? 300));
  const [selectedGift, setSelectedGift]   = useState(() => state.targetGiftCoins > 0 ? { name: state.targetGiftName, icon: state.targetGiftIcon, coins: state.targetGiftCoins } : (draft.selectedGift ?? null));
  const [winnerRule, setWinnerRule]       = useState(() => state.isActive ? (state.winnerRule ?? 'first') : (draft.winnerRule ?? 'first'));
  const [winnerPosition, setWinnerPosition] = useState(() => state.isActive ? (state.winnerPosition ?? 1) : (draft.winnerPosition ?? 1));
  // Mismo criterio que Eliminación (ver ese archivo): fastMode reduce las
  // fases de selección/resultado a la mitad, eliminationsPerRound agrupa
  // varias eliminaciones por paso del sorteo. Sin lockedMode a propósito
  // (pedido explícito, se sacó del panel): en Ruleta las entradas YA solo
  // se aceptan mientras se está "uniendo" gente, tanto en Chat como en
  // Gift — no hay nada que un toggle pudiera cambiar de verdad.
  const [fastMode, setFastMode]           = useState(() => state.isActive ? (state.fastMode ?? false) : (draft.fastMode ?? false));
  const [eliminationsPerRound, setEliminationsPerRound] = useState(() => state.isActive ? (state.eliminationsPerRound ?? 1) : (draft.eliminationsPerRound ?? 1));
  const [manualUsername, setManualUsername] = useState('');
  const [manualCount, setManualCount]       = useState(1);

  useEffect(() => {
    saveDraft({ entryMode, keyword, entryWindowSec, selectedGift, winnerRule, winnerPosition, fastMode, eliminationsPerRound });
  }, [entryMode, keyword, entryWindowSec, selectedGift, winnerRule, winnerPosition, fastMode, eliminationsPerRound, saveDraft]);

  // Compartido por Iniciar/Reiniciar/la actualización en vivo — así los
  // tres mandan siempre exactamente los mismos campos, en el mismo formato.
  const buildConfig = () => ({
    tiktokUsername: username,
    entryMode,
    keyword: keyword.trim(),
    entryWindowSec: Math.max(30, Math.round(entryWindowSec)),
    targetGiftName: entryMode === 'gift' ? selectedGift?.name || '' : '',
    targetGiftIcon: entryMode === 'gift' ? selectedGift?.icon || '' : '',
    targetGiftCoins: entryMode === 'gift' ? selectedGift?.coins || 0 : 0,
    winnerRule,
    winnerPosition: Math.max(1, Math.round(winnerPosition)),
    fastMode, eliminationsPerRound,
  });

  const addManualEntry = () => {
    const uname = manualUsername.trim().replace(/^@/, '');
    if (!uname) return;
    socket.emit('roulette_add_manual_entry', { username: uname, count: Math.max(1, Math.round(manualCount) || 1) });
    setManualUsername('');
    setManualCount(1);
  };

  const startRoulette = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (entryMode === 'chat' && !keyword.trim()) return setStartError('¡Escribe la palabra clave para participar!');
    if (entryMode === 'gift' && !selectedGift) return setStartError('¡Elige el regalo para participar!');
    socket.emit('start_roulette', buildConfig());
  };

  const stopRoulette    = () => socket.emit('stop_roulette');
  // Solo pausa la cuenta de "tiempo para entrar" — el giro en sí no se
  // pausa (el botón queda deshabilitado mientras mode === 'spinning', ver JSX).
  const togglePause     = () => socket.emit(state.paused ? 'resume_roulette' : 'pause_roulette');
  // Manda los ajustes actuales — así, si cambiaste la palabra clave, el
  // tiempo de entrada o la posición ganadora antes de reiniciar, la ronda
  // nueva arranca YA con esos valores, sin tener que pasar por Stop +
  // Iniciar de cero para que se reflejen.
  const restartRoulette = () => socket.emit('restart_roulette', buildConfig());

  // Mientras se están uniendo participantes (antes de que el giro arranque
  // y quede comprometido con el shuffle), cualquier cambio en los ajustes
  // se manda en vivo — mismo patrón que ya usan Rey del Trono/Zubastinis/
  // Eliminación. OJO: además del guard de "recién activado" (evita mandar
  // doble pisando al start_roulette que ya emitió los mismos datos), hace
  // falta el de "recién montado" (isMounted) — sin él, cada vez que el
  // streamer cambia de pestaña y vuelve a Ruleta, este efecto corre de
  // nuevo con los valores LOCALES por defecto (keyword 'participo',
  // entryWindowSec 300, etc.) y los manda de una, pisando en vivo la
  // configuración real de una ronda que ya estaba activa — esto es lo que
  // rompía correr Ruleta en simultáneo con otro modo (Extensible, por
  // ejemplo): con solo pasar por su pestaña sin tocar nada, la ronda de
  // Ruleta quedaba reseteada a los valores por defecto del panel.
  const isMounted = useRef(false);
  const justActivated = useRef(state.isActive);
  useEffect(() => {
    const activeJustChanged = justActivated.current !== state.isActive;
    justActivated.current = state.isActive;
    if (!isMounted.current) { isMounted.current = true; return; }
    if (activeJustChanged) return;
    if (state.isActive && state.mode === 'joining') socket.emit('update_roulette_settings', buildConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMode, keyword, entryWindowSec, selectedGift, winnerRule, winnerPosition, fastMode, eliminationsPerRound, state.isActive, state.mode]);

  const entries = state.entries || [];
  // Los ajustes solo se aplican en vivo mientras se están uniendo
  // participantes: una vez que gira, el sorteo ya quedó armado y lo que se
  // cambie se guarda para la próxima ronda (Reiniciar la arranca con eso).
  // Antes no se decía nada y parecía que el cambio se había perdido.
  const liveEditable = state.isActive && state.mode === 'joining';
  const liveWhen = liveEditable ? 'now' : 'restart';
  const liveTitle = liveEditable ? 'Se aplica a la ronda que está abierta' : 'La ronda ya está en marcha: se usa al reiniciar';
  const cfg = buildConfig();
  const appliedPhase = useLiveApplied({
    active: liveEditable,
    localKey: liveKey([cfg.entryMode, cfg.keyword, cfg.entryWindowSec, cfg.targetGiftCoins, cfg.winnerRule, cfg.winnerPosition, !!cfg.fastMode, cfg.eliminationsPerRound]),
    serverKey: liveKey([state.entryMode, state.keyword, state.entryWindowSec, state.targetGiftCoins || 0, state.winnerRule, state.winnerPosition, !!state.fastMode, state.eliminationsPerRound]),
  });
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}:${state.mode}`);
  const hasProgress = state.isActive && state.mode !== 'finished' && entries.length > 0;
  const size = sizeFor(entries.length);
  // Fase del juego para el escenario: qué está pasando y con qué tono.
  const stage = !state.isActive || state.mode === 'idle' ? { phase: 'Sin iniciar', tone: 'idle' }
    : state.mode === 'finished' ? (state.winner ? { phase: 'Terminado', tone: 'finished' } : { phase: 'Sin ganador', tone: 'nowinner' })
    : state.paused ? { phase: 'En pausa', tone: 'paused' }
    : PHASE[state.mode] || { phase: 'En curso', tone: 'live' };

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:p-6 sm:pt-8 font-sans flex-1">
      {/* Vista previa + premio a la izquierda y ajustes a la derecha en escritorio; una columna en móvil (ver .tkc-game-layout). */}
      <div className="tkc-game-layout">

      {/* Escenario: las entradas en juego y, mientras se puede entrar, el reloj. */}
      <GameStage title="Ruleta" phase={stage.phase} tone={stage.tone} timer={state.mode === 'joining' ? formatMMSS(state.timeLeft || 0) : undefined}>
        {(state.lastEliminatedList || []).length > 0 && (state.mode === 'spinning' || state.mode === 'result') && (
          <ul className="flex flex-col gap-1.5" aria-label="Último paso del giro">
            {state.lastEliminatedList.map((e, i) => (
              <li key={e.username + i} className="theme-notice flex items-center gap-2">
                <img alt="" src={e.avatar} className="w-7 h-7 rounded-full object-cover grayscale" />
                <span>@{e.username} quedó fuera</span>
              </li>
            ))}
          </ul>
        )}

        {state.mode === 'finished' ? (
          <p className="tkc-stage-result" data-tone={state.winner ? 'finished' : 'nowinner'}>
            {state.winner ? `Ganador: @${state.winner.username}` : 'Sin ganador: nadie participó.'}
          </p>
        ) : entries.length > 0 ? (
          <>
            <p className="tkc-meta -mt-2">{entries.length} entrada{entries.length === 1 ? '' : 's'}</p>
            <div className="flex flex-wrap gap-2 justify-center max-h-52 overflow-y-auto">
              {entries.map(e => <EntryBlock key={e.id} e={e} size={size} />)}
            </div>
          </>
        ) : (
          <p className="tkc-stage-empty">{entryMode === 'chat' ? 'Nadie ha entrado todavía. Entran al comentar la palabra clave.' : 'Nadie ha entrado todavía. Entran al mandar el regalo para participar.'}</p>
        )}
      </GameStage>

      {/* Settings */}
      <div className="theme-surface tkc-game-main w-full p-6 sm:p-8 relative">
        <SettingsTitle />

        <HowItWorks storageKey="roulette">
        <p>Se abre un tiempo para entrar: por <span className="font-bold text-white">chat</span> (comentando una palabra clave) o por <span className="font-bold text-white">regalo</span> (cada regalo suma entradas).</p>
        <p>Al vencer el tiempo, la ruleta gira sola y va eliminando entradas hasta llegar a la posición ganadora que elegiste (primero, último o un número).</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Modo de entrada */}
            <div className="tkc-field">
              <label className="tkc-field-label">Cómo se consigue una entrada<LiveTag active={state.isActive} when={liveWhen} title={liveTitle} /></label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEntryMode('chat')} aria-pressed={entryMode === 'chat'}
                  className="tkc-option flex-1 justify-center">
                  <span className="tkc-option-label">Modo Chat</span>
                </button>
                <button type="button" onClick={() => setEntryMode('gift')} aria-pressed={entryMode === 'gift'}
                  className="tkc-option flex-1 justify-center">
                  <span className="tkc-option-label">Modo Gift</span>
                </button>
              </div>
            </div>

            {entryMode === 'chat' ? (
              <div className="tkc-field">
                <label className="tkc-field-label">Palabra clave<LiveTag active={state.isActive} when={liveWhen} title={liveTitle} /></label>
                <input
                  value={keyword} onChange={e => setKeyword(e.target.value)}
                  placeholder="ej: participo"
                  className="theme-input w-full p-3 text-sm outline-none"
                />
                <p className="tkc-hint mt-1">Cualquier comentario que la contenga cuenta — no hace falta que sea exacto.</p>
              </div>
            ) : (
              <div className="tkc-field relative z-20">
                <label className="tkc-field-label">Regalo para participar<LiveTag active={state.isActive} when={liveWhen} title={liveTitle} /></label>
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
            )}

            {/* Ventana de entrada */}
            <div className="tkc-field">
              <label className="tkc-field-label">
                Tiempo para entrar<LiveTag active={state.isActive} when={liveWhen} title={liveEditable ? 'El tiempo que queda salta al valor nuevo' : liveTitle} />
              </label>
              <TimeInput seconds={entryWindowSec} onChange={setEntryWindowSec} />
              <p className="tkc-hint mt-1">Al vencer, se cierran las entradas y el giro arranca solo.</p>
            </div>

            {/* Cuántas caen por paso del sorteo */}
            <div className="tkc-field">
              <label className="tkc-field-label">Eliminadas por paso<LiveTag active={state.isActive} when={liveWhen} title={liveTitle} /></label>
              <input
                type="number" min="1" inputMode="numeric" value={eliminationsPerRound}
                onChange={e => setEliminationsPerRound(Math.max(1, Number(e.target.value) || 1))}
                className="theme-input w-20 p-2 text-center text-sm font-bold outline-none"
              />
              <p className="tkc-hint mt-1">Cuántas entradas se sacan de una en cada paso del sorteo (nunca incluye a la ganadora).</p>
            </div>

            {/* Fast Mode (sin Locked Mode a propósito: en Ruleta las entradas
                SIEMPRE se cierran al arrancar el giro, tanto en Chat como en
                Gift — no hay nada que un toggle pudiera cambiar de verdad). */}
            <div className="mb-6">
              <button type="button" onClick={() => setFastMode(f => !f)} aria-pressed={!!fastMode}
                className="tkc-option w-full justify-center"
                title="Reduce las animaciones de giro/resultado a la mitad (1s en vez de 2s)">
                <span className="tkc-option-label">Fast Mode</span>
              </button>
            </div>

            {/* Entrada manual (admin): suma entradas a mano a un usuario
                existente o nuevo, sin depender de un regalo o comentario
                real — cuenta exactamente igual que una entrada por regalo.
                Solo mientras la ventana de entrada sigue abierta: una vez
                que arranca el giro, el orden ya quedó barajado y fijo. */}
            <div className="tkc-field pt-4 border-t" style={{ borderColor: 'var(--surface-border-color)' }}>
              <label className="tkc-field-label">Agregar entrada manual</label>
              <div className="flex gap-2">
                <input
                  value={manualUsername} onChange={e => setManualUsername(e.target.value)}
                  placeholder="usuario"
                  className="theme-input flex-1 min-w-0 p-2 text-sm outline-none"
                />
                <input
                  type="number" min="1" value={manualCount}
                  onChange={e => setManualCount(Math.max(1, Number(e.target.value) || 1))}
                  className="theme-input w-16 p-2 text-center text-sm outline-none"
                />
                <button type="button" onClick={addManualEntry}
                  disabled={!state.isActive || state.mode !== 'joining' || !manualUsername.trim()}
                  className="theme-btn-secondary theme-btn-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  Agregar
                </button>
              </div>
              <p className="tkc-hint mt-1">Cuenta igual que una entrada por regalo/comentario. Solo mientras está abierta la ventana de entrada.</p>
            </div>

            {/* Regla de ganador */}
            <div className="tkc-field">
              <label className="tkc-field-label">Posición ganadora<LiveTag active={state.isActive} when={liveWhen} title={liveTitle} /></label>
              <div className="flex gap-2 mb-2">
                {Object.entries(WINNER_RULE_LABELS).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setWinnerRule(value)} aria-pressed={winnerRule === value}
                    className="tkc-option flex-1 justify-center">
                    <span className="tkc-option-label">{label}</span>
                  </button>
                ))}
              </div>
              {winnerRule === 'position' && (
                <input
                  type="number" min="1"
                  value={winnerPosition}
                  onChange={e => setWinnerPosition(Math.max(1, Number(e.target.value) || 1))}
                  placeholder="ej: 24"
                  className="theme-input w-full p-2 text-sm outline-none"
                />
              )}
              <p className="tkc-hint mt-1">El sorteo es al azar de verdad — esto solo dice en qué lugar del sorteo tiene que salir la ganadora.</p>
            </div>
            {state.isActive && !liveEditable && state.mode !== 'finished' && (
              <p role="status" className="theme-notice theme-notice-warning mb-3">La ronda ya está girando: lo que cambies se guarda y se usa al reiniciar.</p>
            )}
            <LiveAppliedNote phase={appliedPhase} />

          </div>

        </div>
      </div>

      {/* Controles del juego: en escritorio, bajo la vista previa (estado y
          botones juntos, sin bajar hasta el final de los ajustes); en móvil,
          después de los ajustes, como antes (ver .tkc-game-layout). */}
      <div className="theme-surface tkc-game-controls w-full p-4 sm:p-5">
        <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />
        {!state.isActive && connectionStatus === 'connected' && (entryMode === 'gift' && !selectedGift) && <p role="status" className="theme-notice theme-notice-warning mb-3">Elige el regalo para participar para iniciar.</p>}

        {/* Botones */}
        <div className="flex flex-wrap gap-3">
          {!state.isActive ? (
            <button
              onClick={() => runLocked(startRoulette)}
              disabled={connectionStatus !== 'connected' || (entryMode === 'gift' && !selectedGift) || actionLocked}
              className="theme-btn-primary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                disabled={state.mode !== 'joining'}
                className="theme-btn-secondary theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.paused ? 'REANUDAR' : 'PAUSAR'}
              </button>
              <ConfirmButton
                needsConfirm={hasProgress}
                onConfirm={() => runLocked(restartRoulette)}
                disabled={state.mode === 'spinning' || actionLocked}
                className="theme-btn-warning theme-btn-lg flex-1 font-extrabold tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                REINICIAR
              </ConfirmButton>
            </>
          )}
          <ConfirmButton
            needsConfirm={hasProgress}
            onConfirm={stopRoulette}
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
