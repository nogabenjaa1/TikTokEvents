import { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';
import { HowItWorks } from './PanelHelp';
import SpotifyAppGuide from './SpotifyAppGuide';

// Días de conexión a partir de los cuales el panel avisa que hay que renovarla
// (Spotify la caduca a los 180, ver normalizeStatus).
const RENEW_WARNING_DAYS = 150;

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
      <span aria-hidden="true" className="tkc-switch" />
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
// Quién puede usar Spotify y con cuál app (ver backend/spotify.js, "Quién
// puede usarlo"): lo decide SIEMPRE la respuesta de /status, no el tipo de
// licencia guardado en la sesión, que no se entera de una compra hecha
// después. Un backend anterior (que solo mandaba allowed/connected/
// displayName) se lee como "con derecho y con la app de la plataforma" para
// no romper el panel mientras un despliegue está a medias.
function normalizeStatus(data) {
  const access = data.access || {
    entitled: data.allowed !== false,
    reason: 'lifetime',
    source: data.allowed === false ? null : 'shared',
    needsOwnApp: false,
    addonRequired: false,
    holdsSharedSlot: data.allowed !== false,
  };
  // Spotify caduca la conexión a los 6 meses de autorizarla (y refrescar el
  // token NO la extiende): se avisa desde los 150 días para renovarla antes de
  // que deje de funcionar en pleno directo. Se calcula aquí, y no al renderizar,
  // porque leer la hora en el render no es puro.
  const daysConnected = data.connectedAt ? Math.floor((Date.now() - data.connectedAt) / 86400000) : null;
  const renewSoon = !!data.connected && daysConnected !== null && daysConnected >= RENEW_WARNING_DAYS;
  return { ...data, access, daysConnected, renewSoon };
}

// Por qué a esta licencia le toca crear su propia app (intro de la guía).
// `total` es la cantidad de cupos que informa el backend (sharedSlots.total,
// ver backend/spotify.js): así el número no queda escrito a mano aquí. Si un
// backend anterior no lo manda, el texto sale sin número.
function ownAppReason(reason, total) {
  if (reason === 'lifetime') {
    return `${total ? `Los ${total} cupos` : 'Los cupos'} de la app de Spotify de la plataforma son para los primeros Lifetime y ya están ocupados, así que tu licencia conecta con su propia app.`;
  }
  if (reason === 'addon') return 'Tu complemento de Spotify se conecta con tu propia app de Spotify, no con la de la plataforma.';
  return 'Tu plan Anual incluye Spotify: se conecta con tu propia app de Spotify, no con la de la plataforma.';
}
const SWITCH_TO_OWN_APP_REASON = 'Vas a conectar con tu propia app en lugar de la de la plataforma. Al guardarla se desconecta tu cuenta actual y hay que volver a conectarla.';
const CHANGE_OWN_APP_REASON = 'Pega las credenciales de otra app de Spotify. Al guardarla se desconecta tu cuenta actual y hay que volver a conectarla.';

export default function Spotify({ socket, queueState, settingsState, oauthResult, onOAuthResultConsumed, onWantsMembership }) {
  // Respuesta de /api/spotify/status (null mientras carga): acceso, cupos,
  // app propia, Redirect URI, precio del complemento y si está conectado.
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(oauthResult || null);
  const [errorToast, setErrorToast] = useState(null);
  const [connectError, setConnectError] = useState('');
  // Guía de "crea tu propia app" abierta por decisión del streamer (a quien no
  // le queda otra, `access.needsOwnApp`, se le muestra sola).
  const [showGuide, setShowGuide] = useState(false);
  const [volume, setVolume] = useState(50);

  const access = status?.access || null;
  const connected = status?.connected ?? false;
  const displayName = status?.displayName ?? null;
  // Cupos de la app de la plataforma (ver backend/spotify.js); null si un
  // backend anterior no lo informa.
  const slotsTotal = status?.sharedSlots?.total ?? null;
  // Precio vigente del complemento (centavos -> pesos); 18000 es solo el
  // respaldo si un backend anterior no lo manda (ver backend/pricing.js).
  const addonPriceMxn = (status?.addonPriceCents ?? 18000) / 100;

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/spotify/status`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setStatus(normalizeStatus(data));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  // Spotify redirige de vuelta al panel después del OAuth con
  // ?spotify=connected|not_registered|not_registered_own|error — App.jsx deja esta pestaña
  // activa apenas se vuelve y nos pasa ese valor como `oauthResult`: para
  // cuando este panel (carga perezosa) monta, App.jsx ya reescribió la URL
  // sin la query, así que no se puede leer de window.location. Se consume
  // una sola vez para que volver a esta pestaña no repita el aviso.
  useEffect(() => {
    if (!banner) return;
    if (banner === 'connected') fetchStatus();
    onOAuthResultConsumed?.();
  }, [banner, onOAuthResultConsumed]);

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
    setStatus((current) => (current ? { ...current, connected: false, displayName: null } : current));
  };

  // La app propia se guardó bien (ver SpotifyAppGuide): el backend borró la
  // cuenta conectada, que era de otra app — se vuelve a leer el estado y el
  // streamer solo tiene que pulsar "Conectar".
  const onAppSaved = async () => {
    setShowGuide(false);
    setBanner('app_saved');
    await fetchStatus();
  };

  const removeOwnApp = async () => {
    if (!window.confirm('¿Quitar tu app de Spotify? Se desconecta tu cuenta y !play/!skip dejan de funcionar hasta que conectes otra.')) return;
    await fetch(`${backendUrl()}/api/spotify/app`, { method: 'DELETE', headers: authHeaders() });
    await fetchStatus();
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
        <div role="status" className="w-full max-w-md theme-notice theme-notice-success theme-notice-roomy flex items-start justify-between gap-3">
          <span>✅ CUENTA DE SPOTIFY CONECTADA. Por seguridad el TTS se apaga al volver: si lo usabas, vuelve a activarlo.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {banner === 'error' && (
        <div role="alert" className="w-full max-w-md theme-notice theme-notice-roomy flex items-start justify-between gap-3">
          <span>❌ NO SE PUDO CONECTAR CON SPOTIFY. INTENTA DE NUEVO.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {/* Aparte del genérico de arriba a propósito: reintentar NO lo arregla —
          Spotify solo deja conectar las cuentas que el administrador cargó a
          mano en su lista de usuarios (ver backend/spotify.js). Con el mensaje
          genérico la gente apretaba "Conectar" una y otra vez. */}
      {banner === 'not_registered' && (
        <div role="alert" className="w-full max-w-md theme-notice theme-notice-roomy flex items-start justify-between gap-3">
          <span>❌ TU CUENTA DE SPOTIFY TODAVÍA NO ESTÁ HABILITADA. Spotify solo deja conectar las cuentas que el administrador agregó a la plataforma: envíale el correo con el que inicias sesión en Spotify y, cuando te confirme que ya la agregó, vuelve a intentarlo.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {/* Mismo caso que el de arriba pero con la app PROPIA del streamer: aquí
          no hay a quién pedirle nada, el arreglo es suyo (paso 4 de la guía). */}
      {banner === 'not_registered_own' && (
        <div role="alert" className="w-full max-w-md theme-notice theme-notice-roomy flex items-start justify-between gap-3">
          <span>❌ TU CUENTA DE SPOTIFY NO ESTÁ EN LOS USUARIOS DE TU APP. En el dashboard de Spotify abre tu app, entra a Settings → User Management → Add new user, agrega tu nombre y el correo de tu cuenta de Spotify, y vuelve a intentarlo.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {banner === 'app_saved' && (
        <div role="status" className="w-full max-w-md theme-notice theme-notice-success theme-notice-roomy flex items-start justify-between gap-3">
          <span>✅ TU APP DE SPOTIFY QUEDÓ GUARDADA. Ahora pulsa "Conectar con Spotify" para autorizar tu cuenta.</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {errorToast && (
        <div className="w-full max-w-md theme-notice theme-notice-warning theme-notice-roomy">
          ⚠️ {errorToast}
        </div>
      )}

      <div className="theme-surface w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">CONEXIÓN</h1>
          {!loading && access?.entitled && connected && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border text-green-300 border-green-500/40 bg-green-500/10">● Conectado</span>
          )}
          {!loading && access?.entitled && !connected && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-gray-600/50 text-gray-400">Sin conectar</span>
          )}
          {!loading && access && !access.entitled && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-gray-600/50 text-gray-400">{access.addonRequired ? 'Requiere complemento' : 'Anual y Lifetime'}</span>
          )}
        </div>

        <HowItWorks storageKey="spotify">
          <p>Conectas tu cuenta de Spotify y tu chat puede pedir canciones con <code className="theme-chip px-1 py-0.5 rounded text-[10px]">!play nombre</code>. Las canciones pedidas aparecen en el overlay "Cola de Spotify".</p>
          <p>Necesitas <span className="font-bold text-white">Spotify Premium</span> y tener Spotify <span className="font-bold text-white">abierto y sonando</span> en algún dispositivo mientras transmites.</p>
        </HowItWorks>

        {loading || !access ? (
          <p className="text-gray-500 text-sm italic">Verificando...</p>
        ) : !access.entitled ? (
          access.addonRequired ? (
            <>
              <p className="text-sm text-gray-300 mb-4">
                Tu plan Mensual no incluye los pedidos de canciones con <code className="theme-chip px-1 py-0.5 rounded text-[10px]">!play</code>. Con el{' '}
                <span className="font-bold text-white">complemento de Spotify</span> (un solo pago de MX${addonPriceMxn.toLocaleString('es-MX')}, sin renovación) los activas en tu licencia:
                conectas con tu propia app de Spotify y te guiamos paso a paso.
              </p>
              {onWantsMembership && (
                <button type="button" onClick={onWantsMembership} className="theme-btn-primary theme-btn-lg w-full font-bold tracking-wide transition-all shadow-lg">
                  Ver el complemento
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-300 mb-4">
                Los pedidos de canciones con <code className="theme-chip px-1 py-0.5 rounded text-[10px]">!play</code> están incluidos en los planes{' '}
                <span className="font-bold text-white">Anual</span> y <span className="font-bold text-white">Lifetime</span>, y como complemento de pago único en el plan{' '}
                <span className="font-bold text-white">Mensual</span>.
              </p>
              {onWantsMembership && (
                <button type="button" onClick={onWantsMembership} className="theme-btn-primary theme-btn-lg w-full font-bold tracking-wide transition-all shadow-lg">
                  Ver membresías
                </button>
              )}
            </>
          )
        ) : showGuide || (!connected && access.needsOwnApp) ? (
          <SpotifyAppGuide
            redirectUri={status.redirectUri}
            intro={showGuide
              ? (access.source === 'own' ? CHANGE_OWN_APP_REASON : SWITCH_TO_OWN_APP_REASON)
              : ownAppReason(access.reason, slotsTotal)}
            existingClientId={status.ownApp?.clientId || ''}
            onSaved={onAppSaved}
            onCancel={access.needsOwnApp ? undefined : () => setShowGuide(false)}
          />
        ) : connected ? (
          <>
            <p className="text-sm text-gray-300 mb-1">Conectado como <span className="font-bold text-white">{displayName}</span></p>
            <p className="text-[11px] text-gray-500 mb-4">
              {access.source === 'own' ? 'Con tu propia app de Spotify.' : 'Con la app de Spotify de la plataforma (cupo reservado a los primeros Lifetime).'}
            </p>
            {status.renewSoon && (
              <>
                <p role="status" className="theme-input text-[11px] text-amber-500 leading-snug px-3 py-2 mb-3">
                  Spotify caduca la conexión a los 6 meses de autorizarla y la tuya ya lleva {status.daysConnected} días. Renuévala ahora para empezar otros 6 meses; si no, dejará de funcionar sola y tendrás que volver a conectarla.
                </p>
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="theme-btn-primary theme-btn-lg w-full font-bold tracking-wide transition-all shadow-lg mb-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connecting ? 'Redirigiendo...' : 'Renovar conexión'}
                </button>
                {connectError && <p role="alert" className="text-[11px] font-bold text-red-500 mb-3">{connectError}</p>}
              </>
            )}
            <button onClick={disconnect} className="theme-btn-danger theme-btn-lg w-full font-bold tracking-wide transition-all">
              Desconectar
            </button>
            {access.source === 'own' ? (
              <button type="button" onClick={removeOwnApp} className="block mx-auto mt-3 theme-link">
                Quitar mi app de Spotify
              </button>
            ) : access.reason !== 'admin' && (
              <button type="button" onClick={() => setShowGuide(true)} className="block mx-auto mt-3 text-[11px] font-bold text-gray-400 underline hover:text-white">
                Prefiero usar mi propia app
              </button>
            )}
          </>
        ) : (
          <>
            {access.source === 'shared' && access.reason !== 'admin' && (
              <p role="status" className="theme-input text-[11px] text-gray-400 leading-snug px-3 py-2 mb-4">
                Tienes uno de los {slotsTotal ? `${slotsTotal} cupos` : 'cupos'} de la app de Spotify de la plataforma, reservados a los primeros Lifetime.
              </p>
            )}
            <ol className="text-[11px] text-gray-400 mb-4 leading-snug space-y-1.5 list-decimal list-inside">
              <li>Ten a la mano tu cuenta de <span className="font-bold text-white">Spotify Premium</span>.</li>
              <li>Pulsa el botón: irás a Spotify a autorizar el acceso (nunca vemos tu contraseña).</li>
              <li>Al volver, abre Spotify y deja una canción sonando.</li>
            </ol>
            <button
              onClick={connect}
              disabled={connecting}
              className="theme-btn-primary theme-btn-lg w-full font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connecting ? 'Redirigiendo...' : 'Conectar con Spotify'}
            </button>
            {connectError && <p role="alert" className="text-[11px] font-bold text-red-500 mt-3">{connectError}</p>}
            {access.source === 'own' ? (
              <button type="button" onClick={() => setShowGuide(true)} className="block mx-auto mt-3 text-[11px] font-bold text-gray-400 underline hover:text-white">
                Cambiar mi app de Spotify
              </button>
            ) : access.reason !== 'admin' && (
              <button type="button" onClick={() => setShowGuide(true)} className="block mx-auto mt-3 text-[11px] font-bold text-gray-400 underline hover:text-white">
                Prefiero usar mi propia app
              </button>
            )}
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
              className={`font-black tracking-widest transition-opacity flex-shrink-0 theme-btn-md ${settings.enabled ? 'bg-red-950/70 border border-red-700/60 text-red-300 rounded-xl' : 'theme-btn-primary'}`}
            >
              {settings.enabled ? 'DESACTIVAR' : 'ACTIVAR'}
            </button>
          </div>

          {settings.enabled && !settings.allUsers && !settings.moderators && !settings.fanMembers && (
            <p role="status" className="theme-notice theme-notice-warning mb-3">Ahora mismo nadie del chat puede pedir canciones: activa al menos una opción de abajo.</p>
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
              <span className="text-[10px] font-black uppercase tracking-widest text-green-400 flex-shrink-0">🔊 Sonando</span>
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
              <button onClick={clearQueue} className="theme-link theme-link-danger">
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
                    <span className="text-[10px] font-black uppercase tracking-widest text-green-400 flex-shrink-0">🔊 Sonando</span>
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
