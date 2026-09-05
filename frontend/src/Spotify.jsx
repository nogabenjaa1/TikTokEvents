import React, { useState, useEffect } from 'react';
import { backendUrl, authHeaders } from './auth';

// ─────────────────────────────────────────────
// SPOTIFY — cola de canciones vía !play en el chat
// Cada licencia conecta SU PROPIA cuenta de Spotify por OAuth (como con
// TikTok) — el backend nunca ve la contraseña, solo un access/refresh
// token que Spotify emite. Requisitos reales e ineludibles del lado de
// Spotify (no algo que este panel pueda evitar): cuenta Premium, y Spotify
// abierto y sonando en algún dispositivo en el momento de pedir una
// canción — si falta alguno, el pedido falla y se avisa acá (`spotify_error`
// por socket), nunca en el chat.
// `queueState` llega centralizado desde App.jsx (mismo patrón que
// tapTapState/gifterState) — así el mismo estado sirve para este panel Y
// para el overlay de OBS sin duplicar la suscripción al socket.
// ─────────────────────────────────────────────
export default function Spotify({ socket, queueState }) {
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('spotify'));
  const [errorToast, setErrorToast] = useState(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/spotify/status`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setConnected(data.connected);
        setDisplayName(data.displayName);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  // Igual que Membership.jsx con ?payment=...: Spotify redirige de vuelta
  // acá después del OAuth con ?spotify=connected|error en la URL.
  useEffect(() => {
    if (!banner) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (banner === 'connected') fetchStatus();
  }, [banner]);

  useEffect(() => {
    if (!socket) return;
    const onError = ({ message } = {}) => {
      setErrorToast(message || 'No se pudo agregar la canción.');
      setTimeout(() => setErrorToast(null), 6000);
    };
    socket.on('spotify_error', onError);
    return () => socket.off('spotify_error', onError);
  }, [socket]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${backendUrl()}/api/spotify/connect`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar la conexión');
      window.location.href = data.authUrl;
    } catch (err) {
      alert(err.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('¿Desconectar tu cuenta de Spotify? !play deja de funcionar hasta que la vuelvas a conectar.')) return;
    await fetch(`${backendUrl()}/api/spotify/disconnect`, { method: 'POST', headers: authHeaders() });
    setConnected(false);
    setDisplayName(null);
  };

  const clearQueue = () => socket?.emit('clear_spotify_queue');
  const queue = queueState?.queue || [];

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🎵 Spotify</p>

      {banner === 'connected' && (
        <div className="w-full max-w-md rounded-lg px-4 py-3 text-xs font-bold border bg-emerald-500/10 border-emerald-500/40 text-emerald-600">
          ✅ CUENTA DE SPOTIFY CONECTADA
        </div>
      )}
      {banner === 'error' && (
        <div className="w-full max-w-md rounded-lg px-4 py-3 text-xs font-bold border bg-red-500/10 border-red-500/40 text-red-700">
          ❌ NO SE PUDO CONECTAR CON SPOTIFY. INTENTA DE NUEVO.
        </div>
      )}
      {errorToast && (
        <div className="w-full max-w-md rounded-lg px-4 py-3 text-xs font-bold border bg-amber-500/10 border-amber-500/40 text-amber-600">
          ⚠️ {errorToast}
        </div>
      )}

      <div className="theme-surface w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">CONEXIÓN</h1>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm italic">Verificando...</p>
        ) : connected ? (
          <>
            <p className="text-sm text-gray-300 mb-4">Conectado como <span className="font-bold text-white">{displayName}</span></p>
            <button onClick={disconnect} className="theme-btn-danger w-full py-3 rounded-xl font-bold tracking-wide transition-all">
              Desconectar
            </button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-gray-500 mb-4 leading-snug">
              Conecta tu cuenta de Spotify (necesitas Premium) para que moderadores y suscriptores puedan pedir canciones en el chat con <code className="theme-chip px-1.5 py-0.5 rounded text-[10px]">!play nombre de la canción</code>. Necesitas tener Spotify abierto y sonando en algún dispositivo para que un pedido pueda agregarse.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="theme-btn-primary w-full py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connecting ? 'Redirigiendo...' : 'Conectar con Spotify'}
            </button>
          </>
        )}
      </div>

      {connected && (
        <div className="theme-surface w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="theme-heading text-lg font-semibold">Pedidas por chat</h2>
            {queue.length > 0 && (
              <button onClick={clearQueue} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline">
                Vaciar
              </button>
            )}
          </div>
          {queue.length > 0 ? (
            <div className="flex flex-col gap-2">
              {queue.map((song) => (
                <div key={song.id} className="theme-input flex items-center gap-3 px-3 py-2">
                  {song.albumArt && <img src={song.albumArt} className="w-9 h-9 rounded object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{song.title}</p>
                    <p className="text-[10px] text-gray-500 truncate">{song.artist} · pedido por @{song.requestedBy}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-xs italic">Todavía nadie pidió nada...</p>
          )}
        </div>
      )}
    </div>
  );
}
