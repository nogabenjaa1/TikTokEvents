import React, { useState, useEffect } from 'react';
import { backendUrl, authHeaders } from './auth';

// Mismo interruptor visual que TTS/Colorsays (WinBonusToggle) — se duplica
// en vez de compartirse porque acá no lleva label/descripción propios, se
// componen aparte (mismo criterio ya usado en el resto del proyecto).
function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="theme-input flex items-center gap-3 px-4 py-3 cursor-pointer transition-opacity hover:opacity-90">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only peer" />
      <span aria-hidden="true" className="w-10 h-6 rounded-full bg-gray-700 peer-checked:theme-accent-bg relative flex-shrink-0 transition-colors after:absolute after:w-4 after:h-4 after:rounded-full after:bg-white after:left-1 after:top-1 after:transition-transform peer-checked:after:translate-x-4" />
      <span>
        <span className="block text-sm font-black text-white">{label}</span>
        <span className="block text-[11px] text-gray-500 mt-0.5">{description}</span>
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────
// SPOTIFY — !play/!skip/!revoke en el chat
// Cada licencia conecta SU PROPIA cuenta de Spotify por OAuth (como con
// TikTok) — el backend nunca ve la contraseña, solo un access/refresh
// token que Spotify emite. Requisitos reales e ineludibles del lado de
// Spotify (no algo que este panel pueda evitar): cuenta Premium, y Spotify
// abierto y sonando en algún dispositivo en el momento de pedir/saltar una
// canción o cambiar el volumen — si falta alguno, la acción falla y se
// avisa acá (`spotify_error` por socket), nunca en el chat.
// `queueState`/`settingsState` llegan centralizados desde App.jsx (mismo
// patrón que tapTapState/gifterState) — el permiso de !play/!skip lo
// aplica el SERVIDOR (tenant.js), no el navegador de cada espectador como
// en TTS, porque acá la acción real (llamar a la API de Spotify) pasa por
// el backend.
// ─────────────────────────────────────────────
export default function Spotify({ socket, queueState, settingsState }) {
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('spotify'));
  const [errorToast, setErrorToast] = useState(null);
  const [volume, setVolume] = useState(50);

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
  // acá después del OAuth con ?spotify=connected|error en la URL — App.jsx
  // ya se encarga de que esta pestaña quede activa apenas se vuelve.
  useEffect(() => {
    if (!banner) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (banner === 'connected') fetchStatus();
  }, [banner]);

  useEffect(() => {
    if (!socket) return;
    const onError = ({ message } = {}) => {
      setErrorToast(message || 'No se pudo completar la acción en Spotify.');
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
    if (!window.confirm('¿Desconectar tu cuenta de Spotify? !play/!skip dejan de funcionar hasta que la vuelvas a conectar.')) return;
    await fetch(`${backendUrl()}/api/spotify/disconnect`, { method: 'POST', headers: authHeaders() });
    setConnected(false);
    setDisplayName(null);
  };

  const clearQueue = () => socket?.emit('clear_spotify_queue');
  const queue = queueState?.queue || [];

  const settings = settingsState || { enabled: true, allUsers: false, moderators: true, fanMembers: false, minFanLevel: 1 };
  const update = (key, value) => socket?.emit('update_spotify_settings', { ...settings, [key]: value });

  const changeVolume = (value) => {
    setVolume(value);
    socket?.emit('set_spotify_volume', value);
  };

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
              Conecta tu cuenta de Spotify (necesitas Premium) para que el chat pueda pedir canciones. Necesitas tener Spotify abierto y sonando en algún dispositivo para que una acción pueda aplicarse.
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
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="theme-heading text-lg font-semibold">Comandos del chat</h2>
              <p className="text-[11px] text-gray-500 mt-1">
                <code className="theme-chip px-1.5 py-0.5 rounded text-[10px]">!play nombre de la canción</code>,{' '}
                <code className="theme-chip px-1.5 py-0.5 rounded text-[10px]">!skip</code> (salta a la siguiente) y{' '}
                <code className="theme-chip px-1.5 py-0.5 rounded text-[10px]">!revoke</code> (cada uno saca SU PROPIO último pedido de esta lista — no cancela la canción si ya quedó en la cola real de Spotify).
              </p>
            </div>
            <button
              type="button"
              onClick={() => update('enabled', !settings.enabled)}
              className={`px-4 py-3 text-xs font-black tracking-widest transition-opacity flex-shrink-0 ${settings.enabled ? 'bg-red-950/70 border border-red-700/60 text-red-300 rounded-xl' : 'theme-btn-primary'}`}
            >
              {settings.enabled ? 'DESACTIVAR' : 'ACTIVAR'}
            </button>
          </div>

          <div className={`space-y-3 transition-opacity ${settings.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <Toggle checked={settings.allUsers} onChange={(v) => update('allUsers', v)} label="Todos los usuarios" description="Cualquiera del chat puede pedir canciones; anula los filtros de abajo." />
            <Toggle checked={settings.moderators} onChange={(v) => update('moderators', v)} label="Moderadores" description="Permite a los moderadores del creador." />
            <Toggle checked={settings.fanMembers} onChange={(v) => update('fanMembers', v)} label="Nivel específico" description="Aplica el nivel mínimo seleccionado abajo." />
          </div>

          <label className={`block mt-4 ${settings.enabled && settings.fanMembers && !settings.allUsers ? '' : 'opacity-45 pointer-events-none'}`}>
            <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Nivel mínimo</span>
            <div className="flex items-center gap-4">
              <input
                type="range" min="1" max="50"
                value={settings.minFanLevel}
                onChange={(event) => update('minFanLevel', Number(event.target.value))}
                className="flex-1"
              />
              <span className="theme-chip w-14 text-center font-bold px-2 py-1.5 rounded text-xs flex-shrink-0">{settings.minFanLevel}</span>
            </div>
          </label>
        </div>
      )}

      {connected && (
        <div className="theme-surface w-full max-w-md p-6">
          <h2 className="theme-heading text-lg font-semibold mb-4">Volumen</h2>
          <div className="flex items-center gap-4">
            <span className="text-lg flex-shrink-0">🔈</span>
            <input type="range" min="0" max="100" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} className="flex-1" />
            <span className="text-lg flex-shrink-0">🔊</span>
            <span className="theme-chip w-14 text-center font-bold px-2 py-1.5 rounded text-xs flex-shrink-0">{volume}%</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">Controla el volumen del dispositivo activo de Spotify — necesita estar sonando en algún dispositivo.</p>
        </div>
      )}

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
