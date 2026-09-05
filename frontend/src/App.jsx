import React, { useState, useEffect, useRef } from 'react';
import AdminPanel from './AdminPanel';
import Zubastinis from './Zubastinis';
import Elimination from './Elimination';
import Roulette from './Roulette';
import Extensible from './Extensible';
import ColorSays from './Colorsays';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay } from './Overlay';
import DiceOverlay from './DiceOverlay';
import TikTokLoginBar from './TikTokLoginBar';
import Login from './Login';
import LicenseManager from './LicenseManager';
import Membership from './Membership';
import ThemeSwitcher from './ThemeSwitcher';
import TtsChat from './TtsChat';
import OverlayLink from './OverlayLink';
import InterstitialAd from './InterstitialAd';
import { ThemedShell, useTheme } from './ThemeContext';
import { isOverlayMode, getOverlayScreen, loadSession, clearSession, buildAuthenticatedSocket, backendUrl, authHeaders, logoutSession } from './auth';
import { TRIAL_AD_INTERVAL_MS } from './adConfig';

// Secciones de primer nivel de la sidebar. "events" agrupa los juegos de
// TikTok (antes eran botones sueltos de primer nivel) detrás de una
// subsidebar propia — ver EVENT_TABS.
const SECTIONS = [
  { id: 'overlay', label: 'Overlays',     icon: '🖥️' },
  { id: 'events',  label: 'TikTokEvents', icon: '🎉' },
  { id: 'color',   label: 'ColorDice',    icon: '🎲' },
  { id: 'theme',   label: 'Tema',         icon: '🎨' },
  { id: 'membership', label: 'Membresía', icon: '💳' },
];

// Pestañas dentro de la sección "TikTokEvents" — cada una es uno de los
// módulos que ya existían como botón de primer nivel.
const EVENT_TABS = [
  { id: 'king',     label: 'Rey del Trono', icon: '👑' },
  { id: 'zub',      label: 'Zubastinis',    icon: '🏆' },
  { id: 'elim',     label: 'Eliminación',   icon: '💀' },
  { id: 'roulette', label: 'Ruleta',        icon: '🎡' },
  { id: 'extensible', label: 'Extensible',  icon: '⏱️' },
  { id: 'tts',      label: 'TTS (BETA)',    icon: '🔊' },
];

// Únicas secciones de acceso libre, sin licencia (Color Says, y "Tema" que es
// puramente cosmético/local). Todo lo demás requiere sesión — sin ella se
// muestra el login embebido con la opción de prueba gratis en su lugar.
const FREE_MODES = ['overlay', 'color', 'theme'];

// Pestañas de TikTokEvents que tienen representación en el overlay de OBS
// (TTS no la tiene: lee el chat en el navegador del streamer, sin overlay).
const OVERLAY_APPS = ['king', 'zub', 'elim', 'roulette'];

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'Ninguno',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

// La tarjeta del overlay mide 400x700 fijo (pensada para el recorte de OBS)
// — se achica a este factor para que entre en un celular sin desbordar.
const OVERLAY_PREVIEW_SCALE = 0.75;

// Vista previa del overlay embebida, solo mobile: desde el celular no se
// puede tener a la vez el panel y una ventana aparte de OBS para chequear
// cómo se ve en vivo (a diferencia de desktop, donde el streamer sí puede
// tener las dos ventanas abiertas), así que se resuelve deslizando hacia
// abajo del panel de King/Zub/Elim. Reusa el mismo Overlay.jsx que corre en
// OBS, con el `activeApp` REAL (lo que de verdad está en el aire) — nunca
// forzado al modo que se esté mirando, porque la idea es confirmar qué ve
// la audiencia ahora mismo, no simular un modo que no está activo.
function MobileOverlayPreview({ state, zubState, elimState, rouletteState, activeApp, prizes, theme }) {
  return (
    <div className="md:hidden flex-shrink-0 border-t flex flex-col items-center gap-3 py-5" style={{ borderColor: 'var(--surface-border-color)' }}>
      <p className="theme-label text-[10px] uppercase tracking-widest font-semibold">Vista previa del overlay</p>
      <div style={{ width: 400 * OVERLAY_PREVIEW_SCALE, height: 700 * OVERLAY_PREVIEW_SCALE, overflow: 'hidden' }}>
        <div style={{ width: 400, height: 700, transform: `scale(${OVERLAY_PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
          <Overlay embedded state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={theme} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const overlayMode = isOverlayMode();
  const [session, setSession] = useState(() => loadSession());
  const [socket, setSocket] = useState(null);
  // Un solo dispositivo activo por licencia: si otro dispositivo se loguea
  // con la misma key, el backend nos desconecta y avisa por este evento.
  const [kickedOutMessage, setKickedOutMessage] = useState('');

  // Ads periódicos para licencia trial: se muestra un interstitial cada
  // TRIAL_AD_INTERVAL_MS (3 cada 2 horas) mientras haya sesión trial activa
  // en el panel — es un beneficio de la prueba gratis vs. el invitado sin
  // cuenta, que ve ads con más frecuencia dentro de Color Says (ver ese
  // componente). Nunca corre en el overlay de OBS.
  const [trialAdOpen, setTrialAdOpen] = useState(false);

  const [state, setState]         = useState({ isActive: false, mode: 'idle', timeLeft: 0 });
  const [zubState, setZubState]   = useState({ isActive: false, mode: 'idle', timeLeft: 0, top3: [], winner: null });
  const [elimState, setElimState] = useState({ isActive: false, mode: 'idle', timeLeft: 0, participants: [], lastEliminated: null, winner: null });
  const [rouletteState, setRouletteState] = useState({ isActive: false, mode: 'idle', entryMode: 'chat', timeLeft: 0, entries: [], lastEliminated: null, winner: null });
  // Rankings continuos (sin partida/ganador, ver tenant.js) para los
  // overlays angostos de Top Tap-Tap y Top Gifter.
  const [tapTapState, setTapTapState] = useState({ leaderboard: [] });
  const [gifterState, setGifterState] = useState({ leaderboard: [] });
  // Modo Extensible: cuenta regresiva que crece con follows/regalos, con su
  // propio overlay horizontal (?screen=extensible) — no participa del
  // selector activeApp.
  const [extensibleState, setExtensibleState] = useState({ isActive: false, finished: false, baseTime: 60, secondsPerFollow: 5, secondsPerGift: 3, timeLeft: 0 });
  // Arranca en Color Says (de acceso libre, con ads) en vez de Rey del
  // Trono (bloqueado sin sesión) — así cualquiera que abre el sitio o
  // recarga la página cae directo donde se muestran los anuncios, sin
  // tener que navegar hasta ahí primero.
  const [sidebarMode, setSidebarMode] = useState('color');
  // Pestaña activa dentro de la sección "TikTokEvents" (ver EVENT_TABS).
  const [eventsTab, setEventsTab] = useState('king');

  // Estado para el Overlay
  const [activeApp, setActiveApp] = useState('king');
  // Skin (material + acento) que el overlay debe reflejar — le llega por
  // socket desde el tenant, nunca de su propio localStorage: el overlay
  // corre en la ventana de OBS, un navegador aparte que nunca comparte
  // sesión con el panel de control.
  const [overlayTheme, setOverlayTheme] = useState({ style: 'default', accent: 'purple' });
  // El panel SÍ tiene su propio tema local (useTheme, persistido en este
  // dispositivo); lo usamos acá solo para emitirlo al backend cada vez que
  // cambia, para que el overlay lo replique.
  const { style: panelThemeStyle, accent: panelThemeAccent } = useTheme();

  // Premios por modo (título + imagen opcional), seteados desde los paneles
  // y mostrados en el overlay. El backend es la fuente de verdad.
  const [prizes, setPrizes] = useState({ king: null, zub: null, elim: null, roulette: null });

  // Estado de Color Says (dados), sincronizado hacia/desde el overlay
  // especial de Colores (?screen=colors) — ver Colorsays.jsx/tenant.js.
  const [diceState, setDiceState] = useState({ diceCount: 4, diceResult: [], rolling: false });

  // ── Login TikTok normalizado: compartido entre Rey del Trono,
  // Zubastinis, Eliminación y cualquier módulo futuro que necesite la conexión live ──
  // connectionStatus: idle | checking | error | connecting | connected
  //   idle/checking/error -> todavía no se confirmó que el username exista.
  //   connecting          -> el username existe, esperando confirmar que esté EN VIVO.
  //   connected           -> conexión live confirmada (único estado que habilita "START").
  const [username, setUsername]                 = useState('');
  const [connectionStatus, setConnectionStatus]  = useState('idle');
  const [connectionError, setConnectionError]    = useState('');
  const [giftsList, setGiftsList]                = useState([]);

  const usernameRef = useRef(username);
  useEffect(() => { usernameRef.current = username; }, [username]);

  // Crea (o destruye) el socket cuando hay con qué autenticarlo: la license
  // key de la URL en modo overlay, o el JWT de la sesión logueada. Cada
  // licencia vive en su propio "room" del lado del backend (Tenant), así
  // que este mismo socket ya llega aislado del resto de las licencias.
  useEffect(() => {
    if (!overlayMode && !session) { setSocket(null); return; }
    const s = buildAuthenticatedSocket();
    setSocket(s);
    return () => s?.disconnect();
  }, [overlayMode, session]);

  useEffect(() => {
    if (!socket) return;

    socket.on('state_update',    setState);
    socket.on('contest_started', setState);
    socket.on('timer_updated',   setState);
    socket.on('gift_received',   setState);
    socket.on('snipe_started',   setState);
    socket.on('winner_declared', setState);

    socket.on('zub_state_update',    setZubState);
    socket.on('zub_timer_updated',   setZubState);
    socket.on('zub_snipe_started',   setZubState);
    socket.on('zub_winner_declared', setZubState);

    socket.on('elim_state_update',    setElimState);
    socket.on('elim_timer_updated',   setElimState);
    socket.on('elim_eliminated',      setElimState);
    socket.on('elim_winner_declared', setElimState);

    socket.on('roulette_state_update',    setRouletteState);
    socket.on('roulette_timer_updated',   setRouletteState);
    socket.on('roulette_spin_started',    setRouletteState);
    socket.on('roulette_step',            setRouletteState);
    socket.on('roulette_winner_declared', setRouletteState);

    socket.on('taptap_state_update', setTapTapState);
    socket.on('gifter_state_update', setGifterState);
    socket.on('extensible_state_update', setExtensibleState);

    // Escuchar cambios de app activa (para el overlay)
    socket.on('active_app_changed', setActiveApp);
    socket.on('prizes_updated', setPrizes);
    socket.on('dice_state_update', setDiceState);
    // El overlay se pinta con el skin que le llega acá — nunca con su
    // propio localStorage (ver comment de overlayTheme más arriba).
    socket.on('theme_updated', setOverlayTheme);

    // Un solo dispositivo activo por licencia: si nos desconectan por esto,
    // volvemos a la pantalla de login con un mensaje claro (el overlay,
    // autenticado con la key cruda, nunca recibe este evento).
    socket.on('session_replaced', () => {
      clearSession();
      setKickedOutMessage('Cerraste la sesión aquí porque la licencia se usó desde otro dispositivo.');
      setSession(null);
    });

    // Estado real de la conexión live a TikTok. El backend reintenta solo
    // (cada 3s) mientras haya un username deseado, así que si se cae la
    // conexión mientras seguimos con el mismo username escrito, volvemos a
    // "connecting" en vez de "error" (el backend ya está reintentando).
    const onLiveConnected = () => { setConnectionError(''); setConnectionStatus('connected'); };
    const onLiveDisconnected = () => {
      if (usernameRef.current.trim()) setConnectionStatus('connecting');
    };
    socket.on('live_status', ({ connected }) => { if (connected) setConnectionStatus('connected'); });
    socket.on('live_connected', onLiveConnected);
    socket.on('live_disconnected', onLiveDisconnected);
    socket.on('live_connection_error', ({ message } = {}) => {
      setConnectionError(message || 'No se pudo conectar al LIVE.');
      setConnectionStatus('error');
    });

    return () => socket.off();
  }, [socket]);

  // Emite el skin del panel al backend cada vez que cambia (y una vez al
  // conectar, para sincronizar de entrada) — nunca en modo overlay, que solo
  // debe RECIBIR el tema, jamás pisarlo con el suyo propio.
  useEffect(() => {
    if (overlayMode || !socket) return;
    socket.emit('set_theme', { style: panelThemeStyle, accent: panelThemeAccent });
  }, [socket, overlayMode, panelThemeStyle, panelThemeAccent]);

  // Cadencia de ads de la licencia trial (ver TRIAL_AD_INTERVAL_MS). Si deja
  // de ser trial a mitad de un anuncio ya abierto (logout, upgrade a paga),
  // ese anuncio no se corta solo — el usuario lo cierra con su propio botón
  // "Continuar", que igual no vuelve a abrirse porque el interval ya se limpió.
  useEffect(() => {
    if (overlayMode || session?.licenseType !== 'trial') return;
    const id = setInterval(() => setTrialAdOpen(true), TRIAL_AD_INTERVAL_MS);
    return () => clearInterval(id);
  }, [overlayMode, session?.licenseType]);

  // Conectar al LIVE y cargar regalos son operaciones independientes. La
  // lista de regalos puede fallar o venir vacía aunque el usuario sí esté en
  // vivo, por lo que nunca debe bloquear la conexión (TTS tampoco la necesita).
  useEffect(() => {
    if (!socket || overlayMode) return;

    const normalizedUsername = username.trim().replace(/^@+/, '');
    if (!normalizedUsername) {
      setConnectionStatus('idle');
      setConnectionError('');
      setGiftsList([]);
      socket.emit('set_desired_username', null);
      return;
    }
    setConnectionStatus('checking');

    const timeoutId = setTimeout(async () => {
      // Socket.io guarda el emit incluso si todavía está terminando su propio
      // handshake. El tenant se encarga de reintentar cada 3 segundos.
      setConnectionStatus('connecting');
      setConnectionError('');
      socket.emit('set_desired_username', normalizedUsername);

      try {
        const res  = await fetch(`${backendUrl()}/api/setup/${encodeURIComponent(normalizedUsername)}`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && Array.isArray(data.gifts) && data.gifts.length > 0) {
          setGiftsList([NO_INSTA_WIN, ...data.gifts]);
        } else {
          setGiftsList([]);
        }
      } catch {
        // Los juegos no tendrán selector de regalos hasta que se vuelva a
        // escribir el usuario, pero la conexión LIVE y el TTS siguen activos.
        setGiftsList([]);
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [username, socket, overlayMode]);

  // ✅ ADIÓS React.lazy y Suspense. Ahora el Overlay no se destruye con cada update.
  if (overlayMode) {
    if (!socket) {
      return (
        <div className="min-h-screen bg-[#05030A] text-red-400 flex items-center justify-center font-sans text-sm">
          Falta la clave de licencia en la URL del overlay (?overlay=true&amp;key=...)
        </div>
      );
    }
    const screen = getOverlayScreen();
    if (screen === 'colors') {
      return <DiceOverlay diceState={diceState} theme={overlayTheme} />;
    }
    if (screen === 'taptap') {
      return (
        <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent}>
          <TopTapTapOverlay state={tapTapState} />
        </div>
      );
    }
    if (screen === 'gifter') {
      return (
        <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent}>
          <TopGifterOverlay state={gifterState} />
        </div>
      );
    }
    if (screen === 'extensible') {
      return (
        <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent}>
          <ExtensibleOverlay state={extensibleState} />
        </div>
      );
    }
    return <Overlay state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />;
  }

  const logout = () => {
    if (session) logoutSession(); // best-effort, no bloquea el logout local
    socket?.disconnect();
    clearSession();
    setSession(null);
    setSidebarMode('color');
  };

  // El username queda bloqueado mientras cualquier módulo que dependa de la
  // conexión live esté activo (todos comparten la misma conexión).
  const usernameLocked = state.isActive || zubState.isActive || elimState.isActive || rouletteState.isActive || extensibleState.isActive;

  // Recordatorio de vencimiento in-app: licencias lifetime no tienen expiresAt.
  // Sin sesión (visitante anónimo, solo Color Says) no hay nada que recordar.
  const daysLeft = session?.expiresAt
    ? Math.ceil((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const showExpiryWarning = daysLeft !== null && daysLeft <= 3;

  // Solo Color Says y Tema son de acceso libre; el resto necesita sesión
  // (licencia paga o prueba gratis) — sin ella se muestra el login
  // embebido con la opción de prueba gratis en el panel principal.
  const needsAccess = (modeId) => !session && !FREE_MODES.includes(modeId);

  const onLoggedIn = () => { setKickedOutMessage(''); setSession(loadSession()); };

  return (
    <ThemedShell className="flex flex-col">
      {kickedOutMessage && (
        <div className="w-full bg-red-500/10 border-b border-red-500/40 text-red-700 text-[11px] font-bold text-center py-1.5 tracking-wide flex-shrink-0">
          {kickedOutMessage}
        </div>
      )}
      {showExpiryWarning && (
        <div className="w-full bg-red-500/10 border-b border-red-500/40 text-red-700 text-[11px] font-bold text-center py-1.5 tracking-wide flex-shrink-0">
          Tu licencia vence {daysLeft <= 0 ? 'hoy' : `en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`} — contacta al administrador para renovarla.
        </div>
      )}
    <div className="flex flex-col md:flex-row flex-1 min-h-0">
      <TikTokLoginBar
        username={username} setUsername={setUsername}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        disabled={usernameLocked}
      />

      {/* Mobile: rail horizontal arriba, scrolleable, en el flujo normal.
          Desktop (md:): el rail vertical fijo de siempre, sin cambios. */}
      <aside className="theme-sidebar tkc-mobile-flush flex flex-row md:flex-col items-center gap-2 w-full md:w-[72px] min-h-0 md:min-h-screen py-2 px-2 md:py-4 md:px-0 flex-shrink-0 overflow-x-auto md:overflow-visible z-50">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSidebarMode(s.id)}
            className={[
              'theme-nav-btn w-[52px] h-[52px] rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200 flex-shrink-0',
              sidebarMode === s.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-xl leading-none">{s.icon}</span>
            <span className={[ 'text-[8px] font-bold uppercase tracking-wider text-center leading-tight', sidebarMode === s.id ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
              {s.label}
            </span>
          </button>
        ))}

        {session?.isAdmin && (
          <button
            onClick={() => setSidebarMode('licenses')}
            title="Administrar licencias"
            className={[
              'theme-nav-btn w-[52px] h-[52px] rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200 flex-shrink-0',
              sidebarMode === 'licenses' ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-xl leading-none">🔑</span>
            <span className={[ 'text-[8px] font-bold uppercase tracking-wider', sidebarMode === 'licenses' ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
              Licencias
            </span>
          </button>
        )}

        <div className="hidden md:block flex-1" />
        {session && (
          <button onClick={logout} title="Cerrar sesión"
            className="w-[52px] h-[52px] rounded-[14px] border border-transparent hover:bg-red-950/40 hover:border-red-900/50 flex flex-col items-center justify-center gap-1 transition-all duration-200 flex-shrink-0">
            <span className="text-xl leading-none">🚪</span>
            <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500">Salir</span>
          </button>
        )}
      </aside>

      <main className="flex-1 flex flex-col md:flex overflow-y-auto md:overflow-hidden">
        {sidebarMode === 'overlay' && <OverlayLink socket={socket} tapTapState={tapTapState} gifterState={gifterState} />}

        {sidebarMode === 'events' && (
          <>
            {/* Subsidebar de TikTokEvents: horizontal y scrolleable para que
                entre igual de bien en mobile que el rail principal. */}
            <div className="flex flex-row items-center gap-2 w-full px-3 py-3 overflow-x-auto flex-shrink-0 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
              {EVENT_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setEventsTab(t.id);
                    // Avisamos al backend que cambiamos de modo (solo si ese
                    // modo tiene overlay y hay socket — sin sesión no hay
                    // nada que avisar)
                    if (socket && OVERLAY_APPS.includes(t.id)) socket.emit('set_active_app', t.id);
                  }}
                  className={[
                    'theme-nav-btn h-9 px-4 rounded-full border flex items-center gap-2 transition-all duration-200 flex-shrink-0',
                    eventsTab === t.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
                  ].join(' ')}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  <span className={[ 'text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', eventsTab === t.id ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>

            {eventsTab === 'king' && (
              needsAccess('king') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Rey del Trono." />
              ) : (
                <>
                  <AdminPanel
                    state={state} socket={socket}
                    username={username} connectionStatus={connectionStatus} giftsList={giftsList}
                    prize={prizes.king}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />
                </>
              )
            )}
            {eventsTab === 'zub' && (
              needsAccess('zub') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Zubastinis." />
              ) : (
                <>
                  <Zubastinis
                    state={zubState} socket={socket}
                    username={username} connectionStatus={connectionStatus}
                    prize={prizes.zub}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />
                </>
              )
            )}
            {eventsTab === 'elim' && (
              needsAccess('elim') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Eliminación." />
              ) : (
                <>
                  <Elimination
                    state={elimState} socket={socket}
                    username={username} connectionStatus={connectionStatus} giftsList={giftsList}
                    prize={prizes.elim}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />
                </>
              )
            )}
            {eventsTab === 'roulette' && (
              needsAccess('roulette') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Ruleta." />
              ) : (
                <>
                  <Roulette
                    state={rouletteState} socket={socket}
                    username={username} connectionStatus={connectionStatus} giftsList={giftsList}
                    prize={prizes.roulette}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />
                </>
              )
            )}
            {eventsTab === 'extensible' && (
              needsAccess('extensible') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Modo Extensible." />
              ) : (
                <Extensible
                  state={extensibleState} socket={socket}
                  username={username} connectionStatus={connectionStatus}
                />
              )
            )}
            {/* TTS también requiere sesión — se muestra el login embebido en
                su lugar sin desmontar TtsChat (ver comentario de "visible"
                más abajo, fuera de esta sección para que no se desmonte al
                cambiar de pestaña). */}
            {eventsTab === 'tts' && needsAccess('tts') && (
              <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar TTS (BETA)." />
            )}
          </>
        )}
        {/* Permanece montado siempre (no solo dentro de "events") para que la
            lectura activa no se interrumpa si el streamer se va a otra
            sección mientras TTS sigue leyendo el chat en voz alta. */}
        <TtsChat socket={socket} connectionStatus={connectionStatus} visible={sidebarMode === 'events' && eventsTab === 'tts' && !needsAccess('tts')} />

        {/* Color Says es de acceso libre: no necesita sesión ni socket para
            jugar (la lógica es 100% local), y con sesión sincroniza el
            estado con el overlay especial de Colores. `tier` (regular/pro/
            vip/admin, ver dice_tier en la licencia) gatea el WIN BONUS y el
            Modo Seguro — es un nivel de Color Says independiente de
            session.isAdmin (que sigue siendo exclusivo del panel de
            Licencias, no algo que se compre). Sin sesión, tier es 'regular'
            (probabilidades limpias). `isGuest` (sin sesión) es lo que gatea
            los ads dentro del propio componente — ver Colorsays.jsx. */}
        {sidebarMode === 'color' && <ColorSays tier={session?.diceTier || 'regular'} socket={socket} isGuest={!session} />}
        {sidebarMode === 'theme' && <ThemeSwitcher />}
        {/* A diferencia de king/zub/elim/tts, Membership NO pide sesión para
            verse: los planes y precios son públicos, y recién pide un alias
            al momento de pagar (ver Membership.jsx/ensureSession) — así
            alguien sin cuenta también puede llegar a comprar directo. */}
        {sidebarMode === 'membership' && (
          <Membership session={session} onSessionUpdate={setSession} />
        )}
        {sidebarMode === 'licenses' && session?.isAdmin && <LicenseManager />}
      </main>
    </div>
    <InterstitialAd open={trialAdOpen} onDone={() => setTrialAdOpen(false)} title="Gracias por probar TikTok Concurso" />
    </ThemedShell>
  );
}
