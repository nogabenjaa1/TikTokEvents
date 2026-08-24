import React, { useState, useEffect, useRef, useMemo } from 'react';
import PrizeEditor from './PrizeEditor';

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'None',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

// Los bloques de participantes se van achicando a medida que hay más gente,
// para que el recuadro siga cabiendo todo el elenco.
function sizeFor(count) {
  if (count <= 8)  return { box: 'w-16 h-16', text: 'text-[9px]', emoji: 'text-2xl' };
  if (count <= 16) return { box: 'w-12 h-12', text: 'text-[8px]', emoji: 'text-lg'  };
  if (count <= 30) return { box: 'w-9 h-9',   text: 'text-[7px]', emoji: 'text-sm'  };
  return               { box: 'w-7 h-7',   text: 'text-[6px]', emoji: 'text-xs'  };
}

function ParticipantBlock({ p, size }) {
  // Puede haber varios bloques con el mismo username: cada regalo (incluso
  // repetido por el mismo usuario) inserta su propio slot/bloque.
  return (
    <div className="flex flex-col items-center gap-0.5" title={p.username}>
      <img src={p.avatar} className={`${size.box} rounded-full border-2 object-cover flex-shrink-0`} style={{ borderColor: 'var(--accent)' }} />
      <span className={`${size.text} text-gray-300 max-w-[56px] truncate`}>@{p.username}</span>
    </div>
  );
}

const MODE_LABEL = {
  joining:   'TIEMPO PARA UNIRSE',
  revealing: 'SORTEANDO...',
  rejoin:    'TIEMPO DE RE-JOIN',
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
  const [selectedGift, setSelectedGift]         = useState(null);
  const [selectedInstaWin, setSelectedInstaWin] = useState(NO_INSTA_WIN);
  const [baseTime, setBaseTime]                 = useState(60);
  const [rejoinTime, setRejoinTime]             = useState(20);
  const [isDropOpen, setIsDropOpen]             = useState(false);
  const [isInstaDropOpen, setIsInstaDropOpen]   = useState(false);

  useEffect(() => {
    setSelectedGift(giftsList.find(g => g.coins > 0) || null);
    setSelectedInstaWin(NO_INSTA_WIN);
  }, [giftsList]);

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

    if (state.isActive && selectedGift) {
      socket.emit('update_elim_settings', {
        targetGiftName:    selectedGift.name,
        targetGiftIcon:    selectedGift.icon,
        targetGiftCoins:   selectedGift.coins,
        instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
        instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
        instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
        baseTime, rejoinTime,
      });
    }
  }, [selectedGift, selectedInstaWin, baseTime, rejoinTime, state.isActive]);

  const startElimination = () => {
    if (connectionStatus !== 'connected') return alert('Esperá a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (!selectedGift) return alert('¡Elige el regalo para unirse!');
    socket.emit('start_elimination', {
      tiktokUsername: username,
      targetGiftName:    selectedGift.name,
      targetGiftIcon:    selectedGift.icon,
      targetGiftCoins:   selectedGift.coins,
      instaWinGiftName:  selectedInstaWin.coins > 0 ? selectedInstaWin.name  : '',
      instaWinGiftIcon:  selectedInstaWin.coins > 0 ? selectedInstaWin.icon  : '',
      instaWinGiftCoins: selectedInstaWin.coins > 0 ? selectedInstaWin.coins : 0,
      baseTime, rejoinTime,
    });
  };

  const stopElimination    = () => socket.emit('stop_elimination');
  const restartElimination = () => socket.emit('restart_elimination');
  const togglePause        = () => socket.emit(state.paused ? 'resume_elimination' : 'pause_elimination');

  // Los ajustes se pueden tocar mientras se confirma el username o la
  // conexión en vivo; el botón START, en cambio, exige "connected" a secas.
  const isLocked = connectionStatus !== 'connecting' && connectionStatus !== 'connected';
  const participants = state.participants || [];
  const size = sizeFor(participants.length);
  const distinctCount = new Set(participants.map(p => p.username)).size;
  // Cuántos slots tiene EXACTAMENTE cada participante (alguien con 3 slots
  // tiene 3x más chances de perder uno en el próximo sorteo).
  const slotCounts = useMemo(() => {
    const counts = {};
    for (const p of participants) counts[p.username] = (counts[p.username] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [participants]);

  const timerTitle = state.paused ? 'PAUSADO' : state.mode === 'finished' ? 'FINALIZADO' : (MODE_LABEL[state.mode] || 'TIMER');

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.mode === 'finished' && <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />}

        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">💀 ELIMINACIÓN</p>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{timerTitle}</p>
            <p className={`text-3xl font-black tabular-nums transition-colors ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500' : 'text-white'}`}>
              {state.timeLeft || 0}<span className="text-base text-gray-600">s</span>
            </p>
          </div>
        </div>

        {state.lastEliminated && state.mode !== 'idle' && (
          <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/50 rounded-xl px-3 py-2 mb-3 relative z-10">
            <img src={state.lastEliminated.avatar} className="w-7 h-7 rounded-full border-2 border-red-500 object-cover grayscale" />
            <span className="text-xs font-bold text-red-300">
              💀 @{state.lastEliminated.username} {state.lastEliminated.final === false ? 'perdió un slot (todavía sigue en pie)' : 'fue eliminado'}
            </span>
          </div>
        )}

        {state.mode === 'finished' ? (
          <p className="relative z-10 text-center text-sm font-black text-yellow-300">
            {state.winner ? `👑 GANADOR: @${state.winner.username}` : 'SIN GANADOR — nadie participó'}
          </p>
        ) : participants.length > 0 ? (
          <div className="flex flex-wrap gap-2 justify-center relative z-10 max-h-52 overflow-y-auto">
            {participants.map(p => <ParticipantBlock key={p.id} p={p} size={size} />)}
          </div>
        ) : (
          <p className="text-gray-600 text-sm italic font-medium relative z-10">Nadie se ha unido todavía...</p>
        )}

        {participants.length > 0 && state.mode !== 'finished' && (
          <p className="text-[10px] text-gray-500 text-center mt-2 relative z-10">
            {participants.length} slot{participants.length === 1 ? '' : 's'} · {distinctCount} participante{distinctCount === 1 ? '' : 's'}
          </p>
        )}

        {/* Cuántos slots tiene cada uno, para saber quién arriesga más en el
            próximo sorteo (a más slots, más chances de perder uno). */}
        {slotCounts.length > 0 && state.mode !== 'finished' && (
          <div className="relative z-10 mt-2 max-h-32 overflow-y-auto space-y-1">
            {slotCounts.map(([username, count]) => (
              <div key={username} className="theme-input flex items-center justify-between px-2 py-1">
                <span className="text-gray-300 text-xs truncate">@{username}</span>
                <span className="text-yellow-400 text-xs font-bold flex-shrink-0 ml-2">{count} slot{count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">SETTINGS</h1>
        </div>

        <div className="space-y-5">
          <div className={`transition-all duration-500 ${isLocked ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>

            {/* Selector regalo para unirse */}
            <div className="mb-4 relative z-20">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎯 REGALO PARA UNIRSE</label>
              <div
                onClick={() => { setIsDropOpen(!isDropOpen); setIsInstaDropOpen(false); }}
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
              {isDropOpen && (
                <div className="theme-surface absolute top-full left-0 w-full mt-1 overflow-y-auto max-h-48">
                  {giftsList.filter(g => g.coins > 0).map((gift, i) => (
                    <div
                      key={`e-${gift.id}-${i}`}
                      onClick={() => { setSelectedGift(gift); setIsDropOpen(false); }}
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
                onClick={() => { setIsInstaDropOpen(!isInstaDropOpen); setIsDropOpen(false); }}
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
                      key={`ei-${gift.id || 'none'}-${i}`}
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
                  TIEMPO PARA UNIRSE {state.isActive && <span className="text-cyan-400 ml-1 text-[8px]" title="No corta la ventana de unirse actual: se aplica en la próxima ronda">(próx. ronda)</span>}
                </label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{baseTime}s</span>
              </div>
              <input type="range" min="15" max="300" step="15" value={baseTime} onChange={e => setBaseTime(Number(e.target.value))} />
            </div>

            {/* Rejoin Time */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-red-400 font-semibold">
                  TIEMPO DE RE-JOIN {state.isActive && <span className="text-cyan-400 ml-1 text-[8px]" title="No corta la ventana de rejoin actual: se aplica en la próxima eliminación">(próx. ronda)</span>}
                </label>
                <span className="text-red-200 font-bold bg-red-900/50 px-2 rounded text-xs">{rejoinTime}s</span>
              </div>
              <input type="range" min="5" max="120" step="5" value={rejoinTime} onChange={e => setRejoinTime(Number(e.target.value))} />
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={startElimination}
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
                    onClick={restartElimination}
                    className="flex-1 bg-[#1A122E] border border-yellow-700/50 hover:bg-yellow-900/30 text-yellow-400 py-4 rounded-xl font-bold tracking-wide transition-all"
                  >
                    RESTART ⟲
                  </button>
                </>
              )}
              <button
                onClick={stopElimination}
                className="px-6 bg-[#1A122E] border border-red-900/50 hover:bg-red-900/30 text-red-400 py-4 rounded-xl font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>

          {/* Premio: fuera del bloque isLocked a propósito — se puede
              configurar antes de tener la conexión live confirmada. */}
          <PrizeEditor socket={socket} app="elim" prize={prize} />
        </div>
      </div>
    </div>
  );
}
