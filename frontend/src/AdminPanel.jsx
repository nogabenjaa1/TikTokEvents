import React, { useState, useEffect, useRef } from 'react';
import PrizeEditor from './PrizeEditor';

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'None',
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
  const [selectedGift, setSelectedGift]         = useState(null);
  const [selectedInstaWin, setSelectedInstaWin] = useState(NO_INSTA_WIN);

  const [mainTime, setMainTime]   = useState(15);
  const [snipeTime, setSnipeTime] = useState(5);

  const [isNormalDropOpen, setIsNormalDropOpen] = useState(false);
  const [isInstaDropOpen, setIsInstaDropOpen]   = useState(false);

  // Cuando llega una lista de regalos nueva (usuario conectado), preseleccionar
  useEffect(() => {
    if (giftsList.length > 0) {
      setSelectedGift(giftsList.find(g => g.coins > 0) || null);
      setSelectedInstaWin(NO_INSTA_WIN);
    } else {
      setSelectedGift(null);
    }
  }, [giftsList]);

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
  }, [selectedGift, selectedInstaWin, mainTime, snipeTime, state.isActive]);

  const startContest = () => {
    if (connectionStatus !== 'connected') return alert('Esperá a que se confirme la conexión en vivo con TikTok antes de iniciar.');
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

  // Los ajustes se pueden tocar mientras se confirma el username o la
  // conexión en vivo; el botón START, en cambio, exige "connected" a secas.
  const isLocked = connectionStatus !== 'connecting' && connectionStatus !== 'connected';

  const timerLabel = state.paused ? 'PAUSADO' : (state.mode === 'waiting' ? 'WAITING' : 'TIMER');
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
            <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">KING</p>
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
              <p className="text-gray-600 text-sm italic font-medium">Nobody...</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              {timerLabel}
            </p>
            <p className={`text-4xl font-black tabular-nums transition-colors ${timerColorClass}`}>
              {state.timeLeft}<span className="text-lg text-gray-600">s</span>
            </p>
          </div>
        </div>
      </div>

      {/* Panel principal de configuración */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">SETTINGS</h1>
        </div>

        <div className="space-y-5">
          <div className={`transition-all duration-500 ${isLocked ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>

            {/* Selector regalo normal */}
            <div className="mb-4 relative z-20">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">⚔️ TARGET GIFT</label>
              <div
                onClick={() => { setIsNormalDropOpen(!isNormalDropOpen); setIsInstaDropOpen(false); }}
                className="theme-input w-full p-3 cursor-pointer flex items-center justify-between hover:border-[var(--accent)]"
              >
                {selectedGift ? (
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <img src={selectedGift.icon} className="w-6 h-6" />
                      <span className="text-sm">{selectedGift.name}</span>
                    </div>
                    <span className="text-yellow-400 text-xs font-bold bg-yellow-400/10 px-2 py-1 rounded-md">
                      {selectedGift.coins} 🪙
                    </span>
                  </div>
                ) : (
                  <span className="text-gray-500 text-sm">Waiting...</span>
                )}
              </div>
              {isNormalDropOpen && (
                <div className="theme-surface absolute top-full left-0 w-full mt-1 overflow-y-auto max-h-48">
                  {giftsList.filter(g => g.coins > 0).map((gift, i) => (
                    <div
                      key={`n-${gift.id}-${i}`}
                      onClick={() => { setSelectedGift(gift); setIsNormalDropOpen(false); }}
                      className="p-2 hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] cursor-pointer flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <img src={gift.icon} className="w-6 h-6" />
                        <span className="text-sm">{gift.name}</span>
                      </div>
                      <span className="text-yellow-400 text-xs">{gift.coins} 🪙</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selector Insta-Win */}
            <div className="mb-6 relative z-10">
              <label className="block text-[10px] uppercase tracking-widest text-yellow-500 mb-1 font-black">👑 INSTA-WIN</label>
              <div
                onClick={() => { setIsInstaDropOpen(!isInstaDropOpen); setIsNormalDropOpen(false); }}
                className="w-full p-3 bg-yellow-900/10 rounded-xl border border-yellow-700/50 cursor-pointer flex items-center justify-between hover:border-yellow-500"
              >
                {selectedInstaWin ? (
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <img src={selectedInstaWin.icon} className="w-6 h-6" />
                      <span className="text-sm text-yellow-100">{selectedInstaWin.name}</span>
                    </div>
                    {selectedInstaWin.coins > 0 && (
                      <span className="text-yellow-400 text-xs font-bold">{selectedInstaWin.coins} 🪙</span>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-500 text-sm">Waiting...</span>
                )}
              </div>
              {isInstaDropOpen && (
                <div className="absolute top-full left-0 w-full mt-1 bg-[#130E24] border border-yellow-700/50 rounded-xl shadow-xl overflow-y-auto max-h-48">
                  {giftsList.map((gift, i) => (
                    <div
                      key={`i-${gift.id || 'none'}-${i}`}
                      onClick={() => { setSelectedInstaWin(gift); setIsInstaDropOpen(false); }}
                      className="p-2 hover:bg-yellow-900/30 cursor-pointer flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <img src={gift.icon} className="w-6 h-6" />
                        <span className="text-sm">{gift.name}</span>
                      </div>
                      {gift.coins > 0 && (
                        <span className="text-yellow-400 text-xs">{gift.coins} 🪙</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Base Time */}
            <div className="pt-2 mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">
                  BASE TIME {state.isActive && <span className="text-cyan-400 ml-1 text-[8px]" title="No corta al participante actual: se aplica la próxima vez que alguien se robe el lugar">(próx. ronda)</span>}
                </label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{mainTime}s</span>
              </div>
              <input type="range" min="5" max="120" step="5" value={mainTime} onChange={e => setMainTime(Number(e.target.value))} />
            </div>

            {/* Snipe Time */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-red-400 font-semibold">
                  SNIPE TIME {state.isActive && <span className="text-cyan-400 ml-1 text-[8px]" title="Se aplica la próxima vez que arranque el modo snipe">(próx. ronda)</span>}
                </label>
                <span className="text-red-200 font-bold bg-red-900/50 px-2 rounded text-xs">{snipeTime}s</span>
              </div>
              <input type="range" min="1" max="30" step="1" value={snipeTime} onChange={e => setSnipeTime(Number(e.target.value))} />
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={startContest}
                  disabled={connectionStatus !== 'connected'}
                  className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'START'}
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
                    onClick={restartContest}
                    className="flex-1 bg-[#1A122E] border border-yellow-700/50 hover:bg-yellow-900/30 text-yellow-400 py-4 rounded-xl font-bold tracking-wide transition-all"
                  >
                    RESTART ⟲
                  </button>
                </>
              )}
              <button
                onClick={stopContest}
                className="px-6 bg-[#1A122E] border border-red-900/50 hover:bg-red-900/30 text-red-400 py-4 rounded-xl font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>

          {/* Premio: fuera del bloque isLocked a propósito — se puede
              configurar antes de tener la conexión live confirmada. */}
          <PrizeEditor socket={socket} app="king" prize={prize} />
        </div>
      </div>
    </div>
  );
}
