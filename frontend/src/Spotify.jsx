import React, { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';
import { HowItWorks } from './PanelHelp';

const DEFAULT_SPOTIFY_SETTINGS = { enabled: true, allUsers: false, moderators: true, fanMembers: false, minFanLevel: 1, maxQueueSize: 8 };
function spotifySettingsEqual(a, b) {
  return a.enabled === b.enabled && a.allUsers === b.allUsers && a.moderators === b.moderators
    && a.fanMembers === b.fanMembers && a.minFanLevel === b.minFanLevel && a.maxQueueSize === b.maxQueueSize;
}

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
  const [connectError, setConnectError] = useState('');
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
    setConnectError('');
    try {
      const res = await fetch(`${backendUrl()}/api/spotify/connect`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar la conexión');
      window.location.href = data.authUrl;
    } catch (err) {
      setConnectError(err.message || 'No se pudo iniciar la conexión con Spotify.');
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
  const nowPlaying = queueState?.nowPlaying || null;

  // Bug real reportado (mismo patrón ya arreglado en TtsChat.jsx/App.jsx):
  // antes `settings` era una lectura directa de `settingsState` (el prop
  // que App.jsx actualiza con lo que confirma el backend) sin ningún
  // estado local propio -- cada arrastre del slider de "nivel mínimo" o
  // "máximo en el overlay" emitía al toque y el valor mostrado en
  // pantalla dependía 100% de que la confirmación del servidor volviera
  // a tiempo, así que el slider podía quedarse atrás o saltar hacia atrás
  // a mitad de un arrastre rápido. Se agrega un espejo local
  // (`localSettings`) con el mismo debounce + guardia de eco que TTS: solo
  // se aplica lo que llega de App.jsx si no hay un cambio local más nuevo
  // todavía sin confirmar.
  const [localSettings, setLocalSettings] = useState(() => settingsState || DEFAULT_SPOTIFY_SETTINGS);
  const spotifyEmitTimeoutRef = useRef(null);
  const lastEmittedSpotifyRef = useRef(null);

  useEffect(() => {
    if (!settingsState || spotifyEmitTimeoutRef.current) return;
    setLocalSettings((current) => {
      const sent = lastEmittedSpotifyRef.current;
      if (sent && !spotifySettingsEqual(current, sent)) return current;
      return settingsState;
    });
  }, [settingsState]);

  useEffect(() => {
    if (!socket) return;
    if (spotifyEmitTimeoutRef.current) clearTimeout(spotifyEmitTimeoutRef.current);
    spotifyEmitTimeoutRef.current = setTimeout(() => {
      socket.emit('update_spotify_settings', localSettings);
      lastEmittedSpotifyRef.current = localSettings;
      spotifyEmitTimeoutRef.current = null;
    }, 300);
    return () => { if (spotifyEmitTimeoutRef.current) clearTimeout(spotifyEmitTimeoutRef.current); };
  }, [socket, localSettings]);

  const settings = localSettings;
  const update = (key, value) => setLocalSettings((current) => ({ ...current, [key]: value }));

  // El volumen ya tenía estado local propio (nunca sufrió este bug, no hay
  // eco que lo pise) -- se le agrega el mismo debounce nada más para no
  // spamear la API de Spotify con un request por cada tick del arrastre.
  const volumeEmitTimeoutRef = useRef(null);
  const changeVolume = (value) => {
    setVolume(value);
    if (volumeEmitTimeoutRef.current) clearTimeout(volumeEmitTimeoutRef.current);
    volumeEmitTimeoutRef.current = setTimeout(() => {
      socket?.emit('set_spotify_volume', value);
      volumeEmitTimeoutRef.current = null;
    }, 250);
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🎵 Spotify</p>

      {banner === 'connected' && (
        <div role="status" className="w-full max-w-md rounded-lg px-4 py-3 text-xs font-bold border bg-emerald-500/10 border-emerald-500/40 text-emerald-600 flex items-start justify-between gap-3">
          <span>✅ CUENTA DE SPOTIFY CONECTADA. Por seguridad el TTS se apaga al volver: si lo usabas, vuelve a activarlo.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {banner === 'error' && (
        <div role="alert" className="w-full max-w-md rounded-lg px-4 py-3 text-xs font-bold border bg-red-500/10 border-red-500/40 text-red-700 flex items-start justify-between gap-3">
          <span>❌ NO SE PUDO CONECTAR CON SPOTIFY. INTENTA DE NUEVO.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
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
          {!loading && connected && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border text-green-300 border-green-500/40 bg-green-500/10">● Conectado</span>
          )}
          {!loading && !connected && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-gray-600/50 text-gray-400">Sin conectar</span>
          )}
        </div>

        <HowItWorks storageKey="spotify">
          <p>Conectas tu cuenta de Spotify y tu chat puede pedir canciones con <code className="theme-chip px-1 py-0.5 rounded text-[10px]">!play nombre</code>. Las canciones pedidas aparecen en el overlay "Cola de Spotify".</p>
          <p>Necesitas <span className="font-bold text-white">Spotify Premium</span> y tener Spotify <span className="font-bold text-white">abierto y sonando</span> en algún dispositivo mientras transmites.</p>
        </HowItWorks>

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
            <ol className="text-[11px] text-gray-400 mb-4 leading-snug space-y-1.5 list-decimal list-inside">
              <li>Ten a la mano tu cuenta de <span className="font-bold text-white">Spotify Premium</span>.</li>
              <li>Pulsa el botón: irás a Spotify a autorizar el acceso (nunca vemos tu contraseña).</li>
              <li>Al volver, abre Spotify y deja una canción sonando.</li>
            </ol>
            <button
              onClick={connect}
              disabled={connecting}
              className="theme-btn-primary w-full py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connecting ? 'Redirigiendo...' : 'Conectar con Spotify'}
            </button>
            {connectError && <p role="alert" className="text-[11px] font-bold text-red-500 mt-3">{connectError}</p>}
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

          {settings.enabled && !settings.allUsers && !settings.moderators && !settings.fanMembers && (
            <p role="status" className="rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-500 p-3 text-xs mb-3">Ahora mismo nadie del chat puede pedir canciones: activa al menos una opción de abajo.</p>
          )}

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

          <label className="block mt-4">
            <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Máximo de canciones en el overlay</span>
            <div className="flex items-center gap-4">
              <input
                type="range" min="1" max="20"
                value={settings.maxQueueSize}
                onChange={(event) => update('maxQueueSize', Number(event.target.value))}
                className="flex-1"
              />
              <span className="theme-chip w-14 text-center font-bold px-2 py-1.5 rounded text-xs flex-shrink-0">{settings.maxQueueSize}</span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">No limita cuántas se pueden pedir, solo cuántas se muestran a la vez en el overlay.</p>
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
          <h2 className="theme-heading text-lg font-semibold mb-4">Sonando ahora</h2>
          {nowPlaying ? (
            <div className="theme-input flex items-center gap-3 px-3 py-2 border border-green-500/60">
              {nowPlaying.albumArt && <img src={nowPlaying.albumArt} className="w-9 h-9 rounded object-cover flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{nowPlaying.title}</p>
                <p className="text-[10px] text-gray-500 truncate">
                  {nowPlaying.artist}
                  {nowPlaying.requestedBy && ` · pedido por @${nowPlaying.requestedBy}`}
                </p>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-green-400 flex-shrink-0">🔊 Sonando</span>
            </div>
          ) : (
            <p className="text-gray-600 text-xs italic">Nada sonando en este momento.</p>
          )}
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
                <div key={song.id} className={`theme-input flex items-center gap-3 px-3 py-2 ${song.playing ? 'border border-green-500/60' : ''}`}>
                  {song.albumArt && <img src={song.albumArt} className="w-9 h-9 rounded object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{song.title}</p>
                    <p className="text-[10px] text-gray-500 truncate">{song.artist} · pedido por @{song.requestedBy}</p>
                  </div>
                  {song.playing && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-green-400 flex-shrink-0">🔊 Sonando</span>
                  )}
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
