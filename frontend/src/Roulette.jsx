import React, { useState, useEffect } from 'react';
import PrizeEditor from './PrizeEditor';

// Los bloques de entradas se van achicando a medida que hay más gente, para
// que el recuadro siga cabiendo todo el elenco — mismo criterio que
// Eliminación (ver sizeFor en Elimination.jsx).
function sizeFor(count) {
  if (count <= 8)  return { box: 'w-16 h-16', text: 'text-[9px]', emoji: 'text-2xl' };
  if (count <= 16) return { box: 'w-12 h-12', text: 'text-[8px]', emoji: 'text-lg'  };
  if (count <= 30) return { box: 'w-9 h-9',   text: 'text-[7px]', emoji: 'text-sm'  };
  return               { box: 'w-7 h-7',   text: 'text-[6px]', emoji: 'text-xs'  };
}

function EntryBlock({ e, size }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={e.username}>
      <img src={e.avatar} className={`${size.box} rounded-full border-2 object-cover flex-shrink-0`} style={{ borderColor: 'var(--accent)' }} />
      <span className={`${size.text} text-gray-300 max-w-[56px] truncate`}>@{e.username}</span>
    </div>
  );
}

const WINNER_RULE_LABELS = { first: 'Primero en salir', last: 'Último en quedar', position: 'Número específico' };
const MODE_LABEL = { joining: 'TIEMPO PARA ENTRAR', spinning: 'GIRANDO...' };

// ─────────────────────────────────────────────
// RULETA
// Sorteo por comentario (Modo Chat: comentar una palabra clave, opcional
// solo seguidores) o por regalo (Modo Gift: mandar un regalo específico,
// cada uno suma una entrada — mismo mecanismo de slots que Eliminación).
// Se abre una ventana de tiempo para entrar; al vencer, el giro arranca
// SOLO (no hay botón manual): baraja todas las entradas al azar y revela
// eliminaciones una por una, más lento cerca del final, hasta la posición
// ganadora configurada (primero / último / un número específico).
// La conexión TikTok (username/connectionStatus/giftsList) viene
// normalizada desde App.jsx, compartida con los demás módulos.
// ─────────────────────────────────────────────
export default function Roulette({ state, socket, username, connectionStatus, giftsList, prize }) {
  const [entryMode, setEntryMode]         = useState('chat');
  const [keyword, setKeyword]             = useState('participo');
  const [followersOnly, setFollowersOnly] = useState(false);
  const [entryWindowMin, setEntryWindowMin] = useState(5);
  const [selectedGift, setSelectedGift]   = useState(null);
  const [isDropOpen, setIsDropOpen]       = useState(false);
  const [winnerRule, setWinnerRule]       = useState('first');
  const [winnerPosition, setWinnerPosition] = useState(1);

  useEffect(() => {
    setSelectedGift(giftsList.find(g => g.coins > 0) || null);
  }, [giftsList]);

  const startRoulette = () => {
    if (connectionStatus !== 'connected') return alert('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (entryMode === 'chat' && !keyword.trim()) return alert('¡Escribe la palabra clave para participar!');
    if (entryMode === 'gift' && !selectedGift) return alert('¡Elige el regalo para participar!');
    socket.emit('start_roulette', {
      tiktokUsername: username,
      entryMode,
      keyword: keyword.trim(),
      followersOnly,
      entryWindowSec: Math.max(30, Math.round(entryWindowMin * 60)),
      targetGiftName: entryMode === 'gift' ? selectedGift.name : '',
      targetGiftIcon: entryMode === 'gift' ? selectedGift.icon : '',
      targetGiftCoins: entryMode === 'gift' ? selectedGift.coins : 0,
      winnerRule,
      winnerPosition: Math.max(1, Math.round(winnerPosition)),
    });
  };

  const stopRoulette    = () => socket.emit('stop_roulette');
  const restartRoulette = () => socket.emit('restart_roulette');

  const isLocked = connectionStatus !== 'connecting' && connectionStatus !== 'connected';
  const entries = state.entries || [];
  const size = sizeFor(entries.length);
  const timerTitle = state.mode === 'finished' ? 'FINALIZADO' : (MODE_LABEL[state.mode] || 'TIEMPO');

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.mode === 'finished' && <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />}

        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🎡 RULETA</p>
          {state.mode !== 'idle' && (
            <div className="text-right">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{timerTitle}</p>
              {state.mode === 'joining' && (
                <p className="text-3xl font-black tabular-nums text-white">
                  {state.timeLeft || 0}<span className="text-base text-gray-600">s</span>
                </p>
              )}
            </div>
          )}
        </div>

        {state.lastEliminated && state.mode === 'spinning' && (
          <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/50 rounded-xl px-3 py-2 mb-3 relative z-10">
            <img src={state.lastEliminated.avatar} className="w-7 h-7 rounded-full border-2 border-red-500 object-cover grayscale" />
            <span className="text-xs font-bold text-red-300">💀 @{state.lastEliminated.username} quedó fuera</span>
          </div>
        )}

        {state.mode === 'finished' ? (
          <p className="relative z-10 text-center text-sm font-black text-yellow-300">
            {state.winner ? `👑 GANADOR: @${state.winner.username}` : 'SIN GANADOR — nadie participó'}
          </p>
        ) : entries.length > 0 ? (
          <div className="flex flex-wrap gap-2 justify-center relative z-10 max-h-52 overflow-y-auto">
            {entries.map(e => <EntryBlock key={e.id} e={e} size={size} />)}
          </div>
        ) : (
          <p className="text-gray-600 text-sm italic font-medium relative z-10">Nadie se ha unido todavía...</p>
        )}

        {entries.length > 0 && state.mode !== 'finished' && (
          <p className="text-[10px] text-gray-500 text-center mt-2 relative z-10">{entries.length} entrada{entries.length === 1 ? '' : 's'}</p>
        )}
      </div>

      {/* Settings */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <div className="space-y-5">
          <div className={`transition-all duration-500 ${isLocked ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>

            {/* Modo de entrada */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">CÓMO SE CONSIGUE UNA ENTRADA</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEntryMode('chat')}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${entryMode === 'chat' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                  💬 Modo Chat
                </button>
                <button type="button" onClick={() => setEntryMode('gift')}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${entryMode === 'gift' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                  🎁 Modo Gift
                </button>
              </div>
            </div>

            {entryMode === 'chat' ? (
              <div className="mb-4">
                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">💬 PALABRA CLAVE</label>
                <input
                  value={keyword} onChange={e => setKeyword(e.target.value)}
                  placeholder="ej: participo"
                  className="theme-input w-full p-3 text-sm outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-1">Cualquier comentario que la contenga cuenta — no hace falta que sea exacto.</p>
              </div>
            ) : (
              <div className="mb-4 relative z-20">
                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎁 REGALO PARA PARTICIPAR</label>
                <div
                  onClick={() => setIsDropOpen(!isDropOpen)}
                  className="theme-input w-full p-3 cursor-pointer flex items-center justify-between hover:border-[var(--accent)]"
                >
                  {selectedGift ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3">
                        <img src={selectedGift.icon} className="w-6 h-6" />
                        <span className="text-sm">{selectedGift.name}</span>
                      </div>
                      <span className="text-yellow-400 text-xs font-bold bg-yellow-400/10 px-2 py-1 rounded-md">{selectedGift.coins} 🪙</span>
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">Esperando...</span>
                  )}
                </div>
                {isDropOpen && (
                  <div className="theme-surface absolute top-full left-0 w-full mt-1 overflow-y-auto max-h-48">
                    {giftsList.filter(g => g.coins > 0).map((gift, i) => (
                      <div key={`r-${gift.id}-${i}`}
                        onClick={() => { setSelectedGift(gift); setIsDropOpen(false); }}
                        className="p-2 hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] cursor-pointer flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <img src={gift.icon} className="w-6 h-6" />
                          <span className="text-sm">{gift.name}</span>
                        </div>
                        <span className="text-yellow-400 text-xs">{gift.coins} 🪙</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-gray-500 mt-1">Cada regalo enviado suma una entrada más — más regalos, más chances.</p>
              </div>
            )}

            {/* Solo seguidores */}
            <label className="theme-input flex items-center gap-3 px-4 py-3 cursor-pointer mb-4">
              <input type="checkbox" checked={followersOnly} onChange={e => setFollowersOnly(e.target.checked)} className="sr-only peer" />
              <span aria-hidden="true" className="w-10 h-6 rounded-full bg-gray-700 peer-checked:theme-accent-bg relative flex-shrink-0 transition-colors after:absolute after:w-4 after:h-4 after:rounded-full after:bg-white after:left-1 after:top-1 after:transition-transform peer-checked:after:translate-x-4" />
              <span className="text-sm font-black text-white">Solo seguidores</span>
            </label>

            {/* Ventana de entrada */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">TIEMPO PARA ENTRAR</label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{entryWindowMin} min</span>
              </div>
              <input type="range" min="1" max="30" step="1" value={entryWindowMin} onChange={e => setEntryWindowMin(Number(e.target.value))} />
              <p className="text-[10px] text-gray-500 mt-1">Al vencer, se cierran las entradas y el giro arranca solo.</p>
            </div>

            {/* Regla de ganador */}
            <div className="mb-6">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">POSICIÓN GANADORA</label>
              <div className="flex gap-2 mb-2">
                {Object.entries(WINNER_RULE_LABELS).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setWinnerRule(value)}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${winnerRule === value ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                    {label}
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
              <p className="text-[10px] text-gray-500 mt-1">El sorteo es al azar de verdad — esto solo dice en qué lugar del sorteo tiene que salir la ganadora.</p>
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={startRoulette}
                  disabled={connectionStatus !== 'connected'}
                  className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
                </button>
              ) : (
                <button
                  onClick={restartRoulette}
                  disabled={state.mode === 'spinning'}
                  className="theme-btn-warning flex-1 py-4 font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  REINICIAR ⟲
                </button>
              )}
              <button
                onClick={stopRoulette}
                className="theme-btn-danger px-6 py-4 font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>

          {/* Premio: fuera del bloque isLocked a propósito — se puede
              configurar antes de tener la conexión live confirmada. */}
          <PrizeEditor socket={socket} app="roulette" prize={prize} />
        </div>
      </div>
    </div>
  );
}
