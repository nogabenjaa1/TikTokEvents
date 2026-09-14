import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminPanel from './AdminPanel';
import Zubastinis from './Zubastinis';
import Elimination from './Elimination';
import Roulette from './Roulette';
import Extensible from './Extensible';
import Spotify from './Spotify';
import ColorSays from './Colorsays';
import Downloader from './Downloader';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay, SpotifyQueueOverlay, AlertOverlay, AlertSoundListener } from './Overlay';
import DiceOverlay from './DiceOverlay';
import TikTokLoginBar from './TikTokLoginBar';
import Login from './Login';
import LicenseManager from './LicenseManager';
import Membership from './Membership';
import Dashboard from './Dashboard';
import ThemeSwitcher from './ThemeSwitcher';
import TtsChat from './TtsChat';
import OverlayLink from './OverlayLink';
import AlertsAdmin from './AlertsAdmin';
import InterstitialAd from './InterstitialAd';
import logoMark from './assets/logo-mark.png';
import { ThemedShell, useTheme, accentStyleVars } from './ThemeContext';
import { isOverlayMode, getOverlayScreen, loadSession, clearSession, buildAuthenticatedSocket, backendUrl, authHeaders, logoutSession } from './auth';
import { TRIAL_AD_INTERVAL_MS } from './adConfig';
import { loadOverlayCustomization, saveOverlayCustomization, defaultOverlayCustomizationMap, OVERLAY_CUSTOMIZE_IDS } from './overlayCustomization';

// Secciones de primer nivel de la sidebar. "events" agrupa los juegos de
// TikTok (antes eran botones sueltos de primer nivel) detrás de una
// subsidebar propia — ver EVENT_TABS. "dashboard" (pedido explícito: página
// principal con accesos directos, ver Dashboard.jsx) va primero porque es
// el nuevo destino por default al entrar con sesión.
const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard',   icon: '🏠' },
  { id: 'overlay', label: 'Overlays',     icon: '🖥️' },
  { id: 'events',  label: 'TikTokEvents', icon: '🎉' },
  { id: 'color',   label: 'ColorDice',    icon: '🎲' },
  { id: 'downloader', label: 'Downloader', icon: '⬇️' },
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
  { id: 'spotify',  label: 'Spotify',       icon: '🎵' },
  { id: 'alerts',   label: 'Alertas',       icon: '🔔' },
  { id: 'tts',      label: 'TTS (BETA)',    icon: '🔊' },
];

// Pedido explicito: URLs reales para cada sección (benjaapis.dev/overlays,
// /membership, /tiktokevents/kingthrone, etc.) en vez de todo colgado del
// estado de React sin reflejo en la barra de direcciones -- así se puede
// compartir/guardar un enlace directo a una sección y el botón
// atrás/adelante del navegador funciona. A propósito NO usa <Routes>/<Route>
// de react-router (el render de acá abajo sigue siendo 100% condicional,
// como siempre) -- solo se usa el router para LEER/ESCRIBIR el pathname y
// mantenerlo sincronizado con `sidebarMode`/`eventsTab`, sin tocar cómo se
// decide qué mostrar. OJO: esto NUNCA debe tocar el modo overlay (la URL
// que ya está pegada en OBS de streamers reales, ?overlay=true&screen=...)
// -- por eso el efecto de sincronización de más abajo corta temprano si
// `overlayMode` es true, y esta sección de rutas ni se evalúa en ese caso
// (ver el `if (overlayMode) return ...` bien arriba en el componente).
const SECTION_PATHS = {
  dashboard: 'dashboard',
  overlay: 'overlays',
  events: 'tiktokevents',
  color: 'colordice',
  downloader: 'downloader',
  theme: 'theme',
  membership: 'membership',
  licenses: 'licenses',
};
const PATH_TO_SECTION = Object.fromEntries(Object.entries(SECTION_PATHS).map(([id, path]) => [path, id]));

const EVENT_TAB_PATHS = {
  king: 'kingthrone',
  zub: 'zubastinis',
  elim: 'elimination',
  roulette: 'roulette',
  extensible: 'extensible',
  spotify: 'spotify',
  alerts: 'alerts',
  tts: 'tts',
};
const PATH_TO_EVENT_TAB = Object.fromEntries(Object.entries(EVENT_TAB_PATHS).map(([id, path]) => [path, id]));

// Deduce sección + pestaña de TikTokEvents (si aplica) a partir del
// pathname actual -- se usa tanto para el estado INICIAL (sin flash del
// contenido por defecto antes de corregirse, ver el useState de más abajo)
// como para reaccionar a atrás/adelante del navegador. Cualquier ruta
// desconocida (o la raíz "/") cae siempre en 'dashboard' -- es la página
// principal del sitio, con o sin sesión (Dashboard.jsx ya sabe mostrar una
// versión reducida para visitantes sin cuenta).
function sectionFromPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return { section: 'dashboard', tab: null };
  const section = PATH_TO_SECTION[segments[0]];
  if (!section) return { section: 'dashboard', tab: null };
  const tab = section === 'events' ? (PATH_TO_EVENT_TAB[segments[1]] || 'king') : null;
  return { section, tab };
}

// Título de pestaña dinámico (pedido explícito: "que sea visible siempre"
// en qué sección está) -- ver el useEffect que lo aplica más abajo. La
// marca del sitio es BenjaApis; "TikTokEvents" se conserva solo como
// prefijo dentro de esa sección puntual (el nombre de la funcionalidad en
// sí, no el nombre del producto -- pedido explícito de mantenerlo así).
function sectionTitle(sidebarMode, eventsTab) {
  if (sidebarMode === 'events') {
    const tab = EVENT_TABS.find((t) => t.id === eventsTab);
    return tab ? `TikTokEvents · ${tab.label}` : 'TikTokEvents';
  }
  const section = SECTIONS.find((s) => s.id === sidebarMode);
  return section ? `BenjaApis · ${section.label}` : 'BenjaApis';
}

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

// La tarjeta del overlay mide 380x700 fijo (pensada para el recorte de OBS)
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
function MobileOverlayPreview({ state, zubState, elimState, rouletteState, activeApp, prize, theme, customization }) {
  return (
    <div className="md:hidden flex-shrink-0 border-t flex flex-col items-center gap-3 py-5" style={{ borderColor: 'var(--surface-border-color)' }}>
      <p className="theme-label text-[10px] uppercase tracking-widest font-semibold">Vista previa del overlay</p>
      <div style={{ width: 380 * OVERLAY_PREVIEW_SCALE, height: 700 * OVERLAY_PREVIEW_SCALE, overflow: 'hidden' }}>
        <div style={{ width: 380, height: 700, transform: `scale(${OVERLAY_PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
          <Overlay embedded state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={theme} customization={customization} />
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

  // Único punto que cierra la sesión "de golpe" con un mensaje claro — lo
  // dispara tanto el socket (`session_replaced`, ver más abajo) como
  // cualquier fetch HTTP que reciba un 401 de sesión inválida (ver
  // LicenseManager.jsx). Antes SOLO el socket pasaba por acá, así que un
  // 401 en Licencias dejaba un cartel de error suelto ahí mientras el
  // resto de la app (socket ya conectado de antes) seguía funcionando —
  // ahora cualquiera de los dos casos lleva al mismo login limpio.
  const handleSessionInvalid = (message) => {
    clearSession();
    setKickedOutMessage(message);
    setSession(null);
  };

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
  // Diagnóstico de Tap-Tap (pedido explícito, reporte de bug: "solo
  // registra 1-2 usuarios") — cuenta cada 'like' crudo recibido de TikTok,
  // llegue o no a sumar al ranking, para poder ver en el panel si el
  // problema es de recepción o de procesamiento (ver tapTapDiagnostics en
  // tenant.js).
  const [tapTapDiagnostics, setTapTapDiagnostics] = useState({ totalReceived: 0, totalSettled: 0, distinctUserCount: 0, lastEventAt: null, lastEventUsername: null, lastSettledAt: null });
  const [gifterState, setGifterState] = useState({ leaderboard: [] });
  // Modo Extensible: cuenta regresiva que crece con follows/regalos, con su
  // propio overlay horizontal (?screen=extensible) — no participa del
  // selector activeApp.
  const [extensibleState, setExtensibleState] = useState({ isActive: false, finished: false, baseTime: 60, secondsPerFollow: 5, secondsPerGift: 3, timeLeft: 0 });
  // Cola de canciones pedidas por chat con !play (ver Spotify.jsx) — mismo
  // patrón que tapTapState/gifterState: un solo estado centralizado que
  // sirve tanto al panel como al overlay propio (?screen=musicqueue).
  const [spotifyQueueState, setSpotifyQueueState] = useState({ queue: [], nowPlaying: null });
  // Quién puede usar !play/!skip — vive en el backend (no en localStorage
  // como TTS) porque acá el permiso lo tiene que aplicar el SERVIDOR antes
  // de llamar a la API real de Spotify, no el navegador de cada espectador.
  const [spotifySettingsState, setSpotifySettingsState] = useState({ enabled: true, allUsers: false, moderators: true, fanMembers: false, minFanLevel: 1, maxQueueSize: 8 });
  const location = useLocation();
  const navigate = useNavigate();

  // Arranca en la sección que indique la URL (pedido explícito de URLs
  // reales, ver SECTION_PATHS/sectionFromPath más arriba) -- sin sesión y
  // sin una ruta reconocida, cae en Color Says (de acceso libre, con ads)
  // en vez de Rey del Trono (bloqueado sin sesión), mismo criterio de
  // siempre: así cualquiera que abre el sitio a secas cae directo donde se
  // muestran los anuncios. Se calcula UNA vez acá (no en un efecto) para
  // que no haya un parpadeo mostrando la sección por defecto antes de
  // corregirse a la de la URL real. EXCEPCIÓN: si venimos de la vuelta del
  // OAuth de Spotify (?spotify=connected|error), Spotify.jsx redirige acá
  // con un GET normal del navegador — no hay forma de "recordar" en qué
  // pestaña estaba el streamer antes de irse a autorizar, así que en vez de
  // respetar la URL arrancamos directo en TikTokEvents -> Spotify, que es
  // donde ese aviso se muestra (ver el banner en Spotify.jsx).
  const cameFromSpotifyOAuth = new URLSearchParams(window.location.search).has('spotify');
  const initialRoute = sectionFromPath(window.location.pathname);
  const [sidebarMode, setSidebarMode] = useState(() => (cameFromSpotifyOAuth ? 'events' : initialRoute.section));
  // Pestaña activa dentro de la sección "TikTokEvents" (ver EVENT_TABS).
  const [eventsTab, setEventsTab] = useState(() => (cameFromSpotifyOAuth ? 'spotify' : (initialRoute.tab || 'king')));

  // Estado para el Overlay
  const [activeApp, setActiveApp] = useState('king');
  // Skin (material + acento) que el overlay debe reflejar — le llega por
  // socket desde el tenant, nunca de su propio localStorage: el overlay
  // corre en la ventana de OBS, un navegador aparte que nunca comparte
  // sesión con el panel de control.
  const [overlayTheme, setOverlayTheme] = useState({ style: 'default', accent: 'purple', customColor: '#7C3AED' });
  // El panel SÍ tiene su propio tema local (useTheme, persistido en este
  // dispositivo); lo usamos acá solo para emitirlo al backend cada vez que
  // cambia, para que el overlay lo replique. `setSkin`: pedido explícito de
  // que el tema no se pierda al entrar desde otro navegador/computadora —
  // cuando llega la sincronización inicial del backend (ver theme_updated
  // más abajo), corrige TAMBIÉN el skin propio del panel en este
  // dispositivo, no solo `overlayTheme`. Es un no-op si ya coinciden (ver
  // el guard `sameSkin` dentro de setSkin, en ThemeContext.jsx).
  const { style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor, setSkin } = useTheme();

  // Personalización de fondo + color de usuario por overlay (ver
  // overlayCustomization.js) — MISMO patrón de dos estados que el tema de
  // arriba: `overlayCustomization` es lo que llega del backend y es lo que
  // de verdad se usa para pintar cada overlay (panel y OBS por igual);
  // `panelOverlayDraft` es la copia local, persistida en este dispositivo,
  // que edita el modal "Personalizar" de OverlayLink.jsx — cada cambio ahí
  // se re-emite al backend, que lo reenvía a todo el room (overlay de OBS
  // incluido) como `overlay_customization_update`.
  const [overlayCustomization, setOverlayCustomizationState] = useState(defaultOverlayCustomizationMap());
  const [panelOverlayDraft, setPanelOverlayDraft] = useState(() => loadOverlayCustomization());

  // Premio COMPARTIDO entre Rey del Trono/Zubastinis/Eliminación/Ruleta
  // (título + imagen opcional) — se setea desde cualquiera de los cuatro
  // paneles y se aplica a todos (ver PrizeEditor.jsx/tenant.js). El
  // backend es la fuente de verdad.
  const [prize, setPrize] = useState(null);

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

  // ── URLs reales para cada sección (pedido explícito) ──
  // sidebarMode/eventsTab siguen siendo el estado de siempre (todo el
  // render de más abajo sigue leyendo esas dos variables tal cual, sin
  // tocar ningún `setSidebarMode(...)`/`setEventsTab(...)` existente) --
  // estos dos efectos son los ÚNICOS que hablan con el router, en las dos
  // direcciones:
  //  1) estado -> URL: cada vez que cambian, empuja el pathname
  //     correspondiente (si no es ya ese) para que la barra de direcciones
  //     siempre refleje dónde está el streamer.
  //  2) URL -> estado: si el pathname cambia por afuera (atrás/adelante del
  //     navegador, un enlace externo), corrige sidebarMode/eventsTab para
  //     que coincidan.
  // Nunca se pisan en bucle: si ya coinciden, cada lado no hace nada (React
  // ya evita el re-render si el estado nuevo es idéntico al viejo). Se
  // corta temprano en modo overlay -- esa URL (?overlay=true&screen=...) es
  // la que ya está pegada en OBS de streamers reales, no se toca para nada.
  useEffect(() => {
    if (overlayMode) return;
    const targetPath = sidebarMode === 'events'
      ? `/${SECTION_PATHS.events}/${EVENT_TAB_PATHS[eventsTab] || EVENT_TAB_PATHS.king}`
      : `/${SECTION_PATHS[sidebarMode] || SECTION_PATHS.dashboard}`;
    if (location.pathname !== targetPath) navigate(targetPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayMode, sidebarMode, eventsTab]);

  useEffect(() => {
    if (overlayMode) return;
    const { section, tab } = sectionFromPath(location.pathname);
    setSidebarMode(section);
    if (section === 'events' && tab) setEventsTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayMode, location.pathname]);

  // Título de la pestaña del navegador (pedido explícito: que siempre sea
  // visible en qué sección está, no un "TikTokEvents" fijo sin importar
  // dónde navegue).
  useEffect(() => {
    if (overlayMode) return;
    document.title = sectionTitle(sidebarMode, eventsTab);
  }, [overlayMode, sidebarMode, eventsTab]);

  // Control remoto del TTS para el shortcut del Dashboard (ver
  // TtsChat.jsx/Dashboard.jsx) -- `ttsEnabled` es solo para MOSTRAR el
  // estado actual (TtsChat sigue siendo el dueño real, avisa cada cambio
  // vía onEnabledChange); `ttsRef` es cómo el Dashboard lo prende/apaga.
  const ttsRef = useRef(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  const usernameRef = useRef(username);
  useEffect(() => { usernameRef.current = username; }, [username]);
  // Se pone en `true` la PRIMERA vez que el streamer toca el campo a mano
  // (ver handleSetUsername) — hasta entonces, un `username` vacío significa
  // "todavía no sabemos si el backend ya tenía algo conectado", no "el
  // streamer quiere desconectar". Distinción clave para la persistencia de
  // la conexión (ver comentario grande más abajo, en el useEffect que
  // decide cuándo mandar `set_desired_username(null)`).
  const hasEditedUsernameRef = useRef(false);
  const handleSetUsername = (value) => {
    hasEditedUsernameRef.current = true;
    setForceUnlockUsername(false);
    setUsername(value);
  };
  // Se pone en `true` cuando el backend confirma que el LIVE terminó de
  // verdad (ver socket.on('live_stream_ended') más abajo) — pisa el
  // bloqueo normal de `usernameLocked` (que solo mira si algún modo sigue
  // "activo") para el caso puntual de una partida que quedó activa sin
  // ganador porque la conexión se cortó a mitad de camino: sin esto, el
  // campo se quedaba bloqueado para siempre y, como la conexión ahora
  // persiste solo (ver `set_desired_username`), cada F5 reintentaba con el
  // mismo usuario y repetía el mismo error sin parar.
  const [forceUnlockUsername, setForceUnlockUsername] = useState(false);
  const forceUnlockRef = useRef(false);
  useEffect(() => { forceUnlockRef.current = forceUnlockUsername; }, [forceUnlockUsername]);
  // Se pone en `true` justo antes de adoptar el username que ya tenía
  // conectado el backend (ver socket.on('live_status') más abajo) — el
  // useEffect de sincronización lo lee UNA vez para saltarse el flujo de
  // "checking..."/2s de debounce/set_desired_username de nuevo: eso es lo
  // que hacía que la conexión SE VIERA como si arrancara de cero en cada
  // F5 (el backend nunca la perdió, pero el panel igual mostraba
  // "Buscando..." -> "Conectando..." un rato largo antes de confirmar lo
  // que ya sabía por `live_status`).
  const isAdoptingRef = useRef(false);

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
    // Bug real (encontrado ahora, pedido explícito de que la ruleta gire
    // antes de cada eliminado): faltaba escuchar este evento — el backend
    // ya lo emitía en cada sub-giro (ver beginRouletteSubSpin en
    // tenant.js) con el currentSpinIndex al día, pero como nadie lo
    // escuchaba acá, el overlay nunca se enteraba de los sub-giros
    // intermedios, solo del arranque y del resultado final del batch.
    socket.on('roulette_step_started',    setRouletteState);
    socket.on('roulette_step',            setRouletteState);
    socket.on('roulette_winner_declared', setRouletteState);

    socket.on('taptap_state_update', setTapTapState);
    socket.on('taptap_diagnostics_update', setTapTapDiagnostics);
    socket.on('gifter_state_update', setGifterState);
    socket.on('extensible_state_update', setExtensibleState);
    socket.on('spotify_queue_update', setSpotifyQueueState);
    socket.on('spotify_settings_update', setSpotifySettingsState);

    // Escuchar cambios de app activa (para el overlay)
    socket.on('active_app_changed', setActiveApp);
    socket.on('prize_updated', setPrize);
    socket.on('dice_state_update', setDiceState);
    // El overlay se pinta con el skin que le llega acá — nunca con su
    // propio localStorage (ver comment de overlayTheme más arriba). Pedido
    // explícito: TAMBIÉN corrige el skin propio del panel en este
    // dispositivo (setSkin) para que no haga falta re-elegirlo al entrar
    // desde otro navegador/computadora.
    socket.on('theme_updated', (t) => {
      setOverlayTheme(t);
      if (t?.style) setSkin(t.style, t.accent, t.customColor);
    });
    // Ídem para la personalización de overlays: además de `overlayCustomization`
    // (con la que se pinta todo), corrige `panelOverlayDraft` (la copia que
    // edita el modal "Personalizar" y que se re-emite en cada reconexión,
    // ver el useEffect de abajo) — sin esto, un dispositivo nuevo pisaría en
    // silencio lo ya guardado con sus propios valores de fábrica apenas se
    // conectara.
    socket.on('overlay_customization_update', (map) => {
      setOverlayCustomizationState(map);
      setPanelOverlayDraft(map);
    });

    // Botón "Refrescar overlays" del panel (ver OverlayLink.jsx) — solo las
    // ventanas de overlay (OBS/TikTok LIVE Studio, o una pestaña de preview)
    // deben recargarse; el panel también recibe este evento (mismo room)
    // pero lo ignora a propósito, o se recargaría solo a mitad de una
    // edición cada vez que el streamer use el botón.
    socket.on('force_overlay_refresh', () => {
      if (overlayMode) window.location.reload();
    });

    // Un solo dispositivo activo por licencia: si nos desconectan por esto,
    // volvemos a la pantalla de login con un mensaje claro (el overlay,
    // autenticado con la key cruda, nunca recibe este evento).
    socket.on('session_replaced', () => {
      handleSessionInvalid('Cerraste la sesión aquí porque la licencia se usó desde otro dispositivo.');
    });

    // Estado real de la conexión live a TikTok. El backend reintenta solo
    // (cada 3s) mientras haya un username deseado, así que si se cae la
    // conexión mientras seguimos con el mismo username escrito, volvemos a
    // "connecting" en vez de "error" (el backend ya está reintentando).
    const onLiveConnected = () => { setConnectionError(''); setConnectionStatus('connected'); setForceUnlockUsername(false); };
    const onLiveDisconnected = () => {
      if (usernameRef.current.trim()) setConnectionStatus('connecting');
    };
    // Al conectar (o reconectar) el socket, el backend cuenta qué username
    // tiene REALMENTE conectado/intentando conectar ahora mismo (ver
    // attachSocket en tenant.js) — si el streamer todavía no tocó el campo
    // a mano esta vez (recién recargó la página, por ejemplo), adoptamos
    // ese valor en vez de dejar el campo vacío: así el efecto de más abajo
    // vuelve a mandar `set_desired_username` con el MISMO username en vez
    // de `null`, y la conexión real (que el backend nunca perdió) sigue
    // intacta — sin esto, cada F5 mataba la conexión de TikTok de verdad.
    // `isAdoptingRef`: sin esto, el panel VOLVÍA A MOSTRAR "Buscando..." /
    // "Conectando..." un rato largo en cada F5 (el efecto de sincronización
    // de más abajo siempre pasaba por su debounce de 2s + `checking` antes
    // de confirmar), dando la sensación de que se reconectaba de cero
    // aunque el backend nunca hubiera perdido nada — se refleja acá mismo
    // el estado que el backend YA confirmó, sin ese paso intermedio.
    socket.on('live_status', ({ desiredUsername, connected }) => {
      if (connected) setConnectionStatus('connected');
      if (desiredUsername && !hasEditedUsernameRef.current) {
        isAdoptingRef.current = true;
        setUsername(desiredUsername);
        setConnectionStatus(connected ? 'connected' : 'connecting');
      }
    });
    socket.on('live_connected', onLiveConnected);
    socket.on('live_disconnected', onLiveDisconnected);
    socket.on('live_connection_error', ({ message } = {}) => {
      setConnectionError(message || 'No se pudo conectar al LIVE.');
      setConnectionStatus('error');
    });
    // El backend confirma que el LIVE se cortó de verdad (no un bache
    // momentáneo) y ya dejó de reintentar solo (ver ensureTikTokConnection
    // en tenant.js) — libera el campo aunque algún modo haya quedado
    // "activo" sin ganador por la desconexión a mitad de partida, para
    // poder ingresar otro usuario o reintentar el mismo de forma
    // controlada, en vez de quedar bloqueado repitiendo el mismo error.
    socket.on('live_stream_ended', ({ username: endedUsername } = {}) => {
      setForceUnlockUsername(true);
      setConnectionStatus('error');
      setConnectionError(`El directo de @${endedUsername || usernameRef.current} terminó. Ingresa un usuario para iniciar una nueva sesión.`);
    });

    return () => socket.off();
  }, [socket]);

  // Emite el skin del panel al backend cada vez que cambia (y una vez al
  // conectar, para sincronizar de entrada) — nunca en modo overlay, que solo
  // debe RECIBIR el tema, jamás pisarlo con el suyo propio.
  useEffect(() => {
    if (overlayMode || !socket) return;
    socket.emit('set_theme', { style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor });
  }, [socket, overlayMode, panelThemeStyle, panelThemeAccent, panelThemeCustomColor]);

  // Mismo criterio que el efecto de arriba, para la personalización de
  // overlays: se persiste en este dispositivo y se re-emite cada vez que
  // cambia (y una vez al conectar) — nunca en modo overlay, que solo debe
  // RECIBIRLA (ver overlayCustomization arriba).
  useEffect(() => {
    saveOverlayCustomization(panelOverlayDraft);
  }, [panelOverlayDraft]);

  useEffect(() => {
    if (overlayMode || !socket) return;
    socket.emit('set_overlay_customization', panelOverlayDraft);
  }, [socket, overlayMode, panelOverlayDraft]);

  // Re-sincroniza tema + personalización de overlays cada vez que el socket
  // (re)conecta — no solo la primera vez. Sin esto, si el backend se
  // reinicia (p. ej. un redeploy) el tenant vuelve a arrancar con
  // theme/overlayCustomization en sus defaults en memoria (nunca se
  // persisten en disco, ver comentario de `this.theme` en tenant.js) y el
  // overlay de OBS se queda mostrando esos defaults hasta que el panel
  // vuelva a tocar CUALQUIER control — el socket.io-client reconecta solo
  // (comportamiento por defecto) pero, al ser el MISMO objeto socket, los
  // efectos de arriba (dependientes de panelThemeStyle/panelOverlayDraft)
  // no se vuelven a disparar si el streamer no cambió nada. Usamos refs
  // para mandar siempre el valor más reciente, sin importar cuándo llegue
  // el evento 'connect'.
  const panelThemeRef = useRef({ style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor });
  useEffect(() => { panelThemeRef.current = { style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor }; }, [panelThemeStyle, panelThemeAccent, panelThemeCustomColor]);
  const panelOverlayDraftRef = useRef(panelOverlayDraft);
  useEffect(() => { panelOverlayDraftRef.current = panelOverlayDraft; }, [panelOverlayDraft]);

  useEffect(() => {
    if (overlayMode || !socket) return;
    const resync = () => {
      socket.emit('set_theme', panelThemeRef.current);
      socket.emit('set_overlay_customization', panelOverlayDraftRef.current);
      // Mismo motivo que arriba, para la conexión de TikTok: si el backend
      // se reinició (a diferencia de un simple F5 del panel, ahí sí se
      // pierde la conexión real con TikTok — un reinicio del proceso no
      // hay forma de evitarlo) mientras esta pestaña seguía abierta, el
      // socket reconecta solo pero el Tenant nuevo arranca sin
      // desiredUsername. Reafirmarlo acá lo reconecta sin que el streamer
      // tenga que volver a escribir el usuario. EXCEPTO si el backend ya
      // confirmó que ese LIVE terminó (ver socket.on('live_stream_ended')):
      // reafirmarlo acá reiniciaría el mismo reintento infinito que se
      // acaba de cortar, con solo que el socket reconecte por cualquier
      // otro motivo (ej. un bache de red del lado del navegador).
      const current = usernameRef.current.trim().replace(/^@+/, '');
      if (current && !forceUnlockRef.current) socket.emit('set_desired_username', current);
    };
    socket.on('connect', resync);
    return () => socket.off('connect', resync);
  }, [socket, overlayMode]);

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
      // OJO: `username` arranca vacío en cada carga de la página, así que
      // este bloque también corre en el primer render de una sesión que en
      // realidad SÍ tiene una conexión real viva del lado del backend
      // (Tenant vive en memoria, sobrevive a un F5 aunque no a un reinicio
      // del proceso). Mandar `set_desired_username(null)` acá pisaría esa
      // conexión sin que el streamer lo haya pedido. Solo se manda de
      // verdad una vez que el streamer tocó el campo a mano (ver
      // handleSetUsername) — recién ahí un campo vacío significa
      // "desconectar", no "todavía no sabemos nada".
      if (hasEditedUsernameRef.current) {
        socket.emit('set_desired_username', null);
      }
      return;
    }

    // Este `username` vino de adoptar lo que el backend YA tenía conectado
    // (ver socket.on('live_status')), no de que el streamer lo haya
    // escrito ahora — saltarse el "checking..."/debounce de 2s/reemitir
    // set_desired_username: el backend ya sabe que este username está
    // conectado (o reintentando), no hace falta pasar por todo el flujo de
    // "recién estoy verificando esto" de nuevo. Solo falta recuperar la
    // lista de regalos, que sí se pierde al recargar (vive nada más en
    // este estado de React, no en el backend).
    if (isAdoptingRef.current) {
      isAdoptingRef.current = false;
      (async () => {
        try {
          const res = await fetch(`${backendUrl()}/api/setup/${encodeURIComponent(normalizedUsername)}`, { headers: authHeaders() });
          const data = await res.json();
          if (data.success && Array.isArray(data.gifts) && data.gifts.length > 0) {
            setGiftsList([NO_INSTA_WIN, ...data.gifts]);
          } else {
            setGiftsList([]);
          }
        } catch {
          setGiftsList([]);
        }
      })();
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

  // Todos los overlays MENOS "juegos" (Rey del Trono/Zubastinis/
  // Eliminación/Ruleta) se componen sobre la escena real de OBS — acá NO
  // debe quedar ningún fondo sólido detrás del recuadro además del que
  // elija la personalización de cada uno (ver overlayCustomization.js).
  // `body` tiene un color de fondo fijo (ver index.css) que de otra forma
  // se colaría por fuera del recuadro/fila — se anula solo mientras el
  // overlay activo es uno de estos, nunca en "juegos" (ahí el fondo
  // temático de página SÍ es parte del diseño de siempre).
  // BUG corregido (pedido explícito): "colors" faltaba en esta lista —
  // Extensible ya lo tenía pero Colores, aunque comparte exactamente el
  // mismo patrón de tarjeta única (`theme-die-frame` de 960x260), se había
  // quedado afuera. Sin esto, el `.themed-app` que envuelve a DiceOverlay
  // seguía pintando su fondo de página sólido por detrás/alrededor del
  // marco, así que "transparente" en la personalización nunca se veía
  // realmente transparente en OBS.
  useEffect(() => {
    if (!overlayMode) return;
    const transparent = ['taptap', 'gifter', 'extensible', 'musicqueue', 'alerts', 'colors'].includes(getOverlayScreen());
    document.body.classList.toggle('tkc-overlay-transparent', transparent);
    return () => document.body.classList.remove('tkc-overlay-transparent');
  }, [overlayMode]);

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
      return <DiceOverlay diceState={diceState} theme={overlayTheme} customize={overlayCustomization.colors} />;
    }
    // Sin `grid place-items-center` a propósito — el recuadro (380x700
    // fijo, ver Overlay.jsx) queda anclado arriba con `h-screen flex` en
    // vez de centrado, para que agregar o perder una fila del ranking
    // nunca lo reubique en la pantalla (pedido explícito: "posición
    // estática").
    if (screen === 'taptap') {
      return (
        <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
          <TopTapTapOverlay state={tapTapState} customize={overlayCustomization.taptap} />
        </div>
      );
    }
    if (screen === 'gifter') {
      return (
        <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
          <TopGifterOverlay state={gifterState} customize={overlayCustomization.gifter} />
        </div>
      );
    }
    if (screen === 'musicqueue') {
      return (
        <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
          <SpotifyQueueOverlay state={spotifyQueueState} customize={overlayCustomization.musicqueue} />
        </div>
      );
    }
    if (screen === 'alerts') {
      return (
        <div className="themed-app min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
          <AlertOverlay socket={socket} customize={overlayCustomization.alerts} />
        </div>
      );
    }
    if (screen === 'extensible') {
      return (
        <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
          <ExtensibleOverlay state={extensibleState} customize={overlayCustomization.extensible} />
        </div>
      );
    }
    return <Overlay state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />;
  }

  const logout = () => {
    if (session) logoutSession(); // best-effort, no bloquea el logout local
    socket?.disconnect();
    clearSession();
    setSession(null);
    setSidebarMode('color');
  };

  // El username queda bloqueado mientras cualquier módulo que dependa de la
  // conexión live esté activo (todos comparten la misma conexión) — salvo
  // que el backend ya haya confirmado que el LIVE terminó de verdad
  // (`forceUnlockUsername`, ver socket.on('live_stream_ended')): eso puede
  // pasar con un modo todavía "activo" sin ganador porque la conexión se
  // cortó a mitad de partida, y bloquear el campo en ese caso solo dejaba
  // al streamer sin forma de ingresar otro usuario ni de reintentar.
  const usernameLocked = !forceUnlockUsername && (state.isActive || zubState.isActive || elimState.isActive || rouletteState.isActive || extensibleState.isActive);

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

  // Handlers del modal "Personalizar" (ver OverlayCustomizePanel.jsx,
  // abierto desde OverlayLink.jsx) — actualizan el DRAFT local, nunca
  // `overlayCustomization` directo (ese solo lo escribe el socket, ver
  // comentario en su declaración más arriba).
  const updateOverlayCustomization = (id, entry) => {
    setPanelOverlayDraft((prev) => ({ ...prev, [id]: entry }));
  };
  const applyOverlayCustomizationToAll = (id) => {
    setPanelOverlayDraft((prev) => {
      const entry = prev[id];
      return Object.fromEntries(OVERLAY_CUSTOMIZE_IDS.map((oid) => [oid, entry]));
    });
  };

  // Shortcut del Dashboard: ir directo a una pestaña de TikTokEvents --
  // misma lógica que ya usan los botones de la subsidebar (ver EVENT_TABS
  // más abajo, `set_active_app` solo si esa pestaña tiene overlay propio).
  const goToEventTab = (tabId) => {
    setSidebarMode('events');
    setEventsTab(tabId);
    if (socket && OVERLAY_APPS.includes(tabId)) socket.emit('set_active_app', tabId);
  };

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
        username={username} setUsername={handleSetUsername}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        disabled={usernameLocked}
        onDisconnect={() => handleSetUsername('')}
      />

      {/* Mobile: rail horizontal arriba, scrolleable, en el flujo normal.
          Desktop (md:): el rail vertical fijo de siempre, sin cambios. */}
      <aside className="theme-sidebar tkc-mobile-flush flex flex-row md:flex-col items-center gap-2 w-full md:w-[72px] min-h-0 md:min-h-screen py-2 px-2 md:py-4 md:px-0 flex-shrink-0 overflow-x-auto md:overflow-visible z-50">
        {/* Logo + nombre de marca — chico y sin botón/borde a propósito
            (pedido explícito: "visible pero que no abrume"), primero en la
            fila/columna para que quede como una cabecera sutil del rail de
            navegación, no como un botón más. El nombre va acá porque este
            rail es lo único presente en TODOS los paneles (pedido
            explícito: "asegurate que benjaapis salga en todos los
            paneles"). */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 md:mb-1">
          <img src={logoMark} alt="" className="h-7 md:h-8 w-auto" />
          <span className="text-[7px] font-black uppercase tracking-wider text-gray-500 text-center leading-none">BenjaApis</span>
        </div>
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
        {/* Pedido explicito: página principal con accesos directos. Sin
            sesión igual se ve (versión reducida, ver Dashboard.jsx) -- no
            hace falta needsAccess acá porque cada shortcut ya lleva a una
            sección que sabe mostrar su propio login embebido si hace falta. */}
        {sidebarMode === 'dashboard' && (
          <Dashboard
            session={session} connectionStatus={connectionStatus} username={username}
            anyGameActive={state.isActive || zubState.isActive || elimState.isActive || rouletteState.isActive}
            ttsEnabled={ttsEnabled} ttsLocked={needsAccess('tts')}
            onToggleTts={() => ttsRef.current?.toggleEnabled()}
            onGoSection={setSidebarMode}
            onGoEventTab={goToEventTab}
          />
        )}
        {sidebarMode === 'overlay' && (
          <OverlayLink
            socket={socket} tapTapState={tapTapState} tapTapDiagnostics={tapTapDiagnostics} gifterState={gifterState} spotifyQueueState={spotifyQueueState}
            extensibleState={extensibleState} diceState={diceState}
            overlayCustomization={panelOverlayDraft} onCustomizeChange={updateOverlayCustomization} onApplyToAll={applyOverlayCustomizationToAll}
          />
        )}

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
                    prize={prize}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
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
                    prize={prize}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
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
                    prize={prize}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
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
                    prize={prize}
                  />
                  <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
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
            {eventsTab === 'spotify' && (
              needsAccess('spotify') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Spotify." />
              ) : (
                <Spotify socket={socket} queueState={spotifyQueueState} settingsState={spotifySettingsState} />
              )
            )}
            {/* Pedido explicito: el panel de configuración de Alertas se
                muda de "Overlays" (que ahora solo se queda con la URL/
                ayuda de OBS, ver OverlayLink.jsx) a TikTokEvents, junto al
                resto de los módulos que sí edita el streamer. */}
            {eventsTab === 'alerts' && (
              needsAccess('alerts') ? (
                <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar Alertas." />
              ) : (
                <AlertsAdmin
                  giftsList={giftsList} socket={socket}
                  customization={panelOverlayDraft.alerts}
                  onCustomizeChange={(entry) => updateOverlayCustomization('alerts', entry)}
                  onApplyToAll={() => applyOverlayCustomizationToAll('alerts')}
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
        <TtsChat ref={ttsRef} socket={socket} connectionStatus={connectionStatus} visible={sidebarMode === 'events' && eventsTab === 'tts' && !needsAccess('tts')} onEnabledChange={setTtsEnabled} />

        {/* Pedido explicito: el streamer no escuchaba sus propias alertas de
            sonido (solo llegaban a los espectadores por OBS) -- esto suena
            en SU navegador sin importar en qué pestaña del panel esté, no
            solo en la de Alertas. El visual lo sigue viendo en OBS (ahí
            tiene pegada esa URL aparte). */}
        <AlertSoundListener socket={socket} />

        {/* Color Says es de acceso libre: no necesita sesión ni socket para
            jugar (la lógica es 100% local), y con sesión sincroniza el
            estado con el overlay especial de Colores. `tier` (regular/pro/
            vip/admin, ver dice_tier en la licencia) solo gatea el Modo
            Seguro (exclusivo de Admin) — es un nivel de Color Says
            independiente de session.isAdmin (que sigue siendo exclusivo del
            panel de Licencias, no algo que se compre). El WIN BONUS ya NO
            lo otorga el tier: depende de `winBonusUnlocked`
            (session.diceWinBonusUnlocked), una excepción manual que un
            admin prende por licencia puntual desde el panel de Licencias —
            Admin lo tiene siempre, sin depender de este flag (ver
            Colorsays.jsx). Sin sesión, tier es 'regular' y sin bono
            (probabilidades limpias). `isGuest` (sin sesión) es lo que gatea
            los ads dentro del propio componente — ver Colorsays.jsx. */}
        {sidebarMode === 'color' && <ColorSays tier={session?.diceTier || 'regular'} winBonusUnlocked={!!session?.diceWinBonusUnlocked} socket={socket} isGuest={!session} />}
        {sidebarMode === 'downloader' && (
          needsAccess('downloader') ? (
            <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={() => setSidebarMode('membership')} notice="Necesitas una licencia o una prueba gratis para usar el Downloader." />
          ) : (
            <Downloader />
          )
        )}
        {sidebarMode === 'theme' && <ThemeSwitcher />}
        {/* A diferencia de king/zub/elim/tts, Membership NO pide sesión para
            verse: los planes y precios son públicos, y recién pide un alias
            al momento de pagar (ver Membership.jsx/ensureSession) — así
            alguien sin cuenta también puede llegar a comprar directo. */}
        {sidebarMode === 'membership' && (
          <Membership session={session} onSessionUpdate={setSession} />
        )}
        {sidebarMode === 'licenses' && session?.isAdmin && <LicenseManager onSessionInvalid={handleSessionInvalid} />}
      </main>
    </div>

    {/* Acceso directo a TikTokEvents desde CUALQUIER sección (pedido
        explícito) — a diferencia del botón de la sidebar, este queda fijo
        en pantalla y no se pierde de vista al hacer scroll dentro de una
        sección larga (Membresía, Licencias) en mobile. Se oculta solo
        mientras ya estás en "events", para no apuntar a donde ya estás.
        OJO: el botón NO puede ser hijo DIRECTO de .themed-app — esa clase
        fuerza `position: relative` a todos sus hijos directos (ver
        index.css, ".themed-app > *"), lo que pisaba el `fixed` de Tailwind
        y dejaba el botón mal ubicado dentro del flujo normal en vez de
        flotando sobre la pantalla. Este div envoltorio absorbe esa regla;
        el `fixed` de adentro sí queda intacto (un padre `position:
        relative` no crea un containing block para un hijo `fixed`). */}
    {sidebarMode !== 'events' && (
      <div>
        <button
          onClick={() => setSidebarMode('events')}
          title="Ir a TikTokEvents"
          className="theme-btn-primary fixed bottom-5 right-5 z-[60] w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-lg"
        >
          🎉
        </button>
      </div>
    )}

    <InterstitialAd open={trialAdOpen} onDone={() => setTrialAdOpen(false)} title="Gracias por probar BenjaApis" />
    </ThemedShell>
  );
}
