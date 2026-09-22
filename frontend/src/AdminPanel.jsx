import { HowItWorks, StartRequirement } from './PanelHelp';
import { useState, useEffect, useMemo, useRef } from 'react';
import GiftPicker from './GiftPicker';
import PrizeEditor from './PrizeEditor';
import TimeInput from './TimeInput';
import { formatMMSS } from './timeFormat';
import { loadDraft, saveDraft } from './gameDraftStorage';

const DRAFT_KEY = 'tkc_king_draft';

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
  // Lo último que se dejó configurado en este dispositivo SIN llegar a presionar
  // Iniciar (ver gameDraftStorage.js) -- se lee una sola vez al montar. El servidor
  // manda un regalo/tiempos reales en cuanto el concurso se inició alguna vez (ni
  // siquiera se borran al detenerlo), así que sigue ganando sobre el borrador.
  const draft = useMemo(() => loadDraft(DRAFT_KEY, {}), []);
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
    saveDraft(DRAFT_KEY, { selectedGift, selectedInstaWin, mainTime, snipeTime });
  }, [selectedGift, selectedInstaWin, mainTime, snipeTime]);

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

  const stopContest    = () => socket.emit('stop_contest');
  const restartContest = () => socket.emit('restart_contest');
  const togglePause    = () => socket.emit(state.paused ? 'resume_contest' : 'pause_contest');

  // Los ajustes se pueden tocar en cualquier momento, sin LIVE conectado (pedido
  // explícito); solo el botón START exige "connected" a secas.

  const timerLabel = state.paused ? 'PAUSADO' : (state.mode === 'waiting' ? 'ESPERANDO' : 'TIEMPO');
  const timerColorClass = state.paused
    ? 'text-gray-500'
    : state.mode === 'snipe' ? 'text-red-500'
    : state.mode === 'waiting' ? 'text-gray-500'
    : 'text-white';

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview del Admin */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.mode === 'finished' && (
          <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />
        )}
        <div className="flex justify-between items-center relative z-10">
          <div>
            <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">REY DEL TRONO</p>
            {state.lastParticipant ? (
              <div className="flex items-center gap-3">
                <div className="relative">
                  {state.mode === 'finished' && (
                    <span className="absolute -top-3 -right-2 text-xl z-20">👑</span>
                  )}
                  <img
                    src={state.lastParticipant.avatar}
                    className="w-12 h-12 rounded-full border-[3px] border-green-400 object-cover"
                  />
                </div>
                <div>
                  <p className="font-bold text-gray-100 leading-tight">@{state.lastParticipant.username}</p>
                  <p className="text-xs text-green-400">{state.lastParticipant.giftName}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-600 text-sm italic font-medium">Nadie todavía...</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              {timerLabel}
            </p>
            <p className={`text-4xl font-black tabular-nums transition-colors ${timerColorClass}`}>
              {formatMMSS(state.timeLeft)}
            </p>
          </div>
        </div>
      </div>

      {/* Panel principal de configuración */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <HowItWorks storageKey="king">
        <p>Quien manda el <span className="font-bold text-white">regalo objetivo</span> se queda con el trono y arranca su reloj. Si otra persona manda el regalo antes de que se acabe, le quita el lugar.</p>
        <p>Gana quien tenga el trono cuando el tiempo llega a cero. El <span className="font-bold text-white">Insta-Win</span> es un regalo que da la victoria al instante.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Selector regalo normal */}
            <div className="mb-4 relative z-20">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">⚔️ REGALO OBJETIVO</label>
              <GiftPicker
                gifts={giftsList.filter(g => g.coins > 0)}
                selected={selectedGift}
                onSelect={setSelectedGift}
                placeholder="Elige un regalo..."
              />
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                Cualquier regalo cuenta si su valor en monedas alcanza a este (acumulando varios seguidos, máximo 10s entre uno y otro) — sin importar por cuánto se pase, siempre cuenta como una sola vez.
              </p>
            </div>

            {/* Selector Insta-Win */}
            <div className="mb-6 relative z-10">
              <label className="block text-[10px] uppercase tracking-widest text-yellow-500 mb-1 font-black">👑 INSTA-WIN</label>
              <GiftPicker
                gifts={giftsList}
                selected={selectedInstaWin}
                onSelect={setSelectedInstaWin}
                placeholder="Elige un regalo..."
                variant="insta"
              />
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                Cualquier regalo (o suma de varios, máximo 10s entre uno y otro) que alcance este valor en monedas declara ganador al instante.
              </p>
            </div>

            {/* Base Time */}
            <div className="pt-2 mb-4">
              <label className="theme-label text-[10px] uppercase tracking-widest font-semibold block mb-1">
                TIEMPO BASE {state.isActive && <span className="text-gray-400 ml-1 text-[8px]" title="No corta al participante actual: se aplica la próxima vez que alguien se robe el lugar">(próx. ronda)</span>}
              </label>
              <TimeInput seconds={mainTime} onChange={setMainTime} />
            </div>

            {/* Snipe Time */}
            <div className="mb-6">
              <label className="text-[10px] uppercase tracking-widest text-red-400 font-semibold block mb-1">
                TIEMPO DE SNIPE {state.isActive && <span className="text-gray-400 ml-1 text-[8px]" title="Se aplica la próxima vez que arranque el modo snipe">(próx. ronda)</span>}
              </label>
              <TimeInput seconds={snipeTime} onChange={setSnipeTime} />
            </div>

            <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />
            {!state.isActive && connectionStatus === 'connected' && !selectedGift && <p role="status" className="text-xs text-amber-500 mb-3">Selecciona un regalo para iniciar.</p>}

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={startContest}
                  disabled={connectionStatus !== 'connected' || !selectedGift}
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
                    {state.paused ? 'REANUDAR ▶' : 'PAUSAR ⏸'}
                  </button>
                  <button
                    onClick={restartContest}
                    className="theme-btn-warning theme-btn-lg flex-1 font-bold tracking-wide transition-all"
                  >
                    REINICIAR ⟲
                  </button>
                </>
              )}
              <button
                onClick={stopContest}
                className="theme-btn-danger theme-btn-lg font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>

          {/* Premio: aparte de los ajustes a propósito — se puede
              configurar antes de tener la conexión live confirmada. */}
          <PrizeEditor socket={socket} prize={prize} />
        </div>
      </div>
    </div>
  );
}
