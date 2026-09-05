import React, { useState, useEffect, useRef } from 'react';

// mm:ss — el contador puede superar los 99 minutos fácil (arranca chico y
// crece con follows/regalos), así que el minuto no se acota a 2 dígitos.
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
// MODO EXTENSIBLE
// Cuenta regresiva tipo "subathon": arranca en un tiempo base y cada follow
// o regalo detectado le SUMA segundos (al revés de los demás modos, acá
// nunca se descuenta por eventos, solo por el paso del tiempo). Los
// segundos por follow/regalo son editables en vivo sin reiniciar el
// contador — el tiempo base solo se aplica al Iniciar/Reiniciar.
// Cualquier regalo cuenta (no hay uno específico que elegir), a propósito:
// la idea es premiar cualquier apoyo, no una dinámica de puntería.
// ─────────────────────────────────────────────
export default function Extensible({ state, socket, username, connectionStatus }) {
  const [baseTimeMin, setBaseTimeMin] = useState(1);
  const [secondsPerFollow, setSecondsPerFollow] = useState(5);
  const [secondsPerGift, setSecondsPerGift] = useState(3);

  const buildConfig = () => ({
    tiktokUsername: username,
    baseTime: Math.max(1, Math.round(baseTimeMin * 60)),
    secondsPerFollow: Math.max(0, Math.round(secondsPerFollow)),
    secondsPerGift: Math.max(0, Math.round(secondsPerGift)),
  });

  const startExtensible = () => {
    if (connectionStatus !== 'connected') return alert('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    socket.emit('start_extensible', buildConfig());
  };

  const stopExtensible = () => socket.emit('stop_extensible');
  const restartExtensible = () => socket.emit('restart_extensible', buildConfig());
  const togglePause = () => socket.emit(state.paused ? 'resume_extensible' : 'pause_extensible');

  // Segundos por follow/regalo (y la base, para el próximo reinicio) se
  // reflejan en vivo sin cortar el contador que ya está corriendo — mismo
  // patrón que Ruleta/Eliminación, pero acá SIEMPRE que está activo (no hay
  // una fase "de espera" propia: el contador corre todo el tiempo). El
  // guard de "recién montado" (isMounted) es crítico acá: sin él, cada vez
  // que el streamer cambia de pestaña y vuelve, este efecto corre de nuevo
  // con los valores LOCALES por defecto (baseTimeMin 1, secondsPerFollow 5,
  // etc.) y los manda de una, pisando en vivo un contador que ya estaba
  // corriendo con otros valores — esto rompía tener Extensible corriendo en
  // simultáneo con otro modo, con solo pasar por esta pestaña sin tocar nada.
  const isMounted = useRef(false);
  const justActivated = useRef(state.isActive);
  useEffect(() => {
    const activeJustChanged = justActivated.current !== state.isActive;
    justActivated.current = state.isActive;
    if (!isMounted.current) { isMounted.current = true; return; }
    if (activeJustChanged) return;
    if (state.isActive) socket.emit('update_extensible_settings', buildConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseTimeMin, secondsPerFollow, secondsPerGift, state.isActive]);

  const isLocked = connectionStatus !== 'connecting' && connectionStatus !== 'connected';

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.finished && <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />}

        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">⏱️ MODO EXTENSIBLE</p>
        </div>

        <p className={`relative z-10 text-center text-6xl font-black tabular-nums ${state.finished ? 'text-yellow-300' : state.paused ? 'text-gray-500' : 'text-white'}`}>
          {formatTime(state.timeLeft)}
        </p>
        {state.finished && (
          <p className="relative z-10 text-center text-xs font-black text-yellow-300 mt-2 uppercase tracking-widest">TIEMPO AGOTADO</p>
        )}
        {state.isActive && state.paused && !state.finished && (
          <p className="relative z-10 text-center text-xs font-black text-gray-400 mt-2 uppercase tracking-widest">PAUSADO</p>
        )}
        {!state.isActive && !state.finished && (
          <p className="text-gray-600 text-sm italic font-medium relative z-10 text-center mt-2">Todavía no arrancó...</p>
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

            {/* Tiempo base */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">TIEMPO BASE (AL INICIAR/REINICIAR)</label>
                <span className="theme-chip font-bold px-2 rounded text-xs">{baseTimeMin} min</span>
              </div>
              <input type="range" min="1" max="120" step="1" value={baseTimeMin} onChange={e => setBaseTimeMin(Number(e.target.value))} />
              <p className="text-[10px] text-gray-500 mt-1">Con cuánto tiempo arranca el contador — solo se aplica al Iniciar o Reiniciar.</p>
            </div>

            {/* Segundos por follow */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">👤 SEGUNDOS POR FOLLOW</label>
              <input
                type="number" min="0"
                value={secondsPerFollow}
                onChange={e => setSecondsPerFollow(Math.max(0, Number(e.target.value) || 0))}
                className="theme-input w-full p-3 text-sm outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">Cada nuevo seguidor le suma esto al contador — se aplica al instante, sin reiniciar.</p>
            </div>

            {/* Segundos por regalo */}
            <div className="mb-6">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🎁 SEGUNDOS POR REGALO</label>
              <input
                type="number" min="0"
                value={secondsPerGift}
                onChange={e => setSecondsPerGift(Math.max(0, Number(e.target.value) || 0))}
                className="theme-input w-full p-3 text-sm outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">Cualquier regalo cuenta, multiplicado por la cantidad enviada — se aplica al instante, sin reiniciar.</p>
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={startExtensible}
                  disabled={connectionStatus !== 'connected'}
                  className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePause}
                    disabled={state.finished}
                    className="theme-btn-secondary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {state.paused ? 'REANUDAR ▶' : 'PAUSAR ⏸'}
                  </button>
                  <button
                    onClick={restartExtensible}
                    className="theme-btn-warning flex-1 py-4 font-bold tracking-wide transition-all"
                  >
                    REINICIAR ⟲
                  </button>
                </>
              )}
              <button
                onClick={stopExtensible}
                className="theme-btn-danger px-6 py-4 font-bold transition-all"
              >
                ⏹
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
