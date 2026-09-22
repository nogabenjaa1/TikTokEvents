import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertSoundListener } from './Overlay';
import Login from './Login';
import { lazyPanel } from './lazyPanel';
import Dashboard from './Dashboard';
import ExpiryBanner from './ExpiryBanner';
import useAutoLabels from './useAutoLabels';
import { loadSoundEnabled, saveSoundEnabled, loadMonitorSink, saveMonitorSink } from './alertMonitor';
import useEventSounds from './useEventSounds';
import AudioUnlockBanner from './AudioUnlockBanner';
import { addSeenGift, mergeCatalog } from './giftCatalog';
import { addFeedItem, FEED_MAX } from './feedLogic';
import TtsChat from './TtsChat';
import InterstitialAd from './InterstitialAd';
import { ThemedShell, useTheme } from './ThemeContext';
import { isOverlayMode, loadSession, clearSession, buildAuthenticatedSocket, logoutSession } from './auth';
import AppSidebar from './app/AppSidebar';
import EventsSection from './app/EventsSection';
import OverlayModeView from './app/OverlayModeView';
import useGiftCatalog from './app/useGiftCatalog';
import useSectionRouting from './app/useSectionRouting';
import { FREE_MODES, OVERLAY_APPS, sectionFromPath } from './app/navigation';
import { TRIAL_AD_INTERVAL_MS } from './adConfig';
import { loadOverlayCustomization, saveOverlayCustomization, defaultOverlayCustomizationMap, OVERLAY_CUSTOMIZE_IDS } from './overlayCustomization';

// Paneles pesados cargados bajo demanda (ver lazyPanel.jsx): el overlay de
// OBS y el primer render del panel ya no descargan pagos, Downloader,
// licencias, etc. hasta que se abren.
const ColorSays = lazyPanel(() => import('./Colorsays'));
const Downloader = lazyPanel(() => import('./Downloader'));
const LicenseManager = lazyPanel(() => import('./LicenseManager'));
const AdminSystem = lazyPanel(() => import('./AdminSystem'));
const Membership = lazyPanel(() => import('./Membership'));
const ThemeSwitcher = lazyPanel(() => import('./ThemeSwitcher'));
const OverlayLink = lazyPanel(() => import('./OverlayLink'));



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
  //
  // Bug real reportado: el panel de Licencias "peleaba" con el scroll
  // (subía y bajaba solo) hasta llegar arriba del todo. Causa: esta
  // función era un closure NUEVO en cada render de App -- y App re-renderiza
  // muy seguido en vivo (decenas de listeners de socket, ver más abajo).
  // LicenseManager.jsx la recibe como `onSessionInvalid` y la mete en la
  // dependencia de un useCallback/useEffect propio que vuelve a pedir la
  // lista de licencias cada vez que esta identidad cambia -- con `useCallback`
  // (todo lo que usa adentro es estable: clearSession es una función de
  // módulo, setKickedOutMessage/setSession son setters de React) esta
  // función ahora mantiene la MISMA identidad entre renders, así que ya no
  // dispara ese refetch en cadena que hacía crecer y encoger la lista
  // (por el "Cargando licencias...") mientras el streamer scrolleaba.
  const handleSessionInvalid = useCallback((message) => {
    clearSession();
    setKickedOutMessage(message);
    setSession(null);
  }, []);

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
  // Objetivo (meta de regalos en monedas o de seguidores nuevos, pedido
  // explícito) — acumulador simple sin paso del tiempo, con su propio
  // overlay horizontal (?screen=goal), no participa del selector activeApp.
  const [goalState, setGoalState] = useState({ isActive: false, finished: false, targetType: 'coins', target: 0, current: 0, title: '' });
  // Espectadores en vivo (para el overlay de chat, ?screen=chat) — un solo
  // número centralizado, mismo criterio que gifterState/tapTapState.
  const [viewerCount, setViewerCount] = useState(0);
  // Cola de canciones pedidas por chat con !play (ver Spotify.jsx) — mismo
  // patrón que tapTapState/gifterState: un solo estado centralizado que
  // sirve tanto al panel como al overlay propio (?screen=musicqueue).
  const [spotifyQueueState, setSpotifyQueueState] = useState({ queue: [], nowPlaying: null });
  // Quién puede usar !play/!skip — vive en el backend (no en localStorage
  // como TTS) porque acá el permiso lo tiene que aplicar el SERVIDOR antes
  // de llamar a la API real de Spotify, no el navegador de cada espectador.
  const [spotifySettingsState, setSpotifySettingsState] = useState({ enabled: true, allUsers: false, moderators: true, fanMembers: false, minFanLevel: 1, maxQueueSize: 8 });

  // Arranca en la sección que indique la URL (pedido explícito de URLs
  // reales, ver SECTION_PATHS/sectionFromPath más arriba) -- sin sesión y
  // sin una ruta reconocida, cae en Color Says (de acceso libre, con ads)
  // en vez de Rey del Trono (bloqueado sin sesión), mismo criterio de
  // siempre: así cualquiera que abre el sitio a secas cae directo donde se
  // muestran los anuncios. Se calcula UNA vez acá (no en un efecto) para
  // que no haya un parpadeo mostrando la sección por defecto antes de
  // corregirse a la de la URL real. EXCEPCIÓN: si venimos de la vuelta del
  // OAuth de Spotify (?spotify=connected|not_registered|not_registered_own|error), Spotify.jsx redirige aquí
  // con un GET normal del navegador — no hay forma de "recordar" en qué
  // pestaña estaba el streamer antes de irse a autorizar, así que en vez de
  // respetar la URL arrancamos directo en TikTokEvents -> Spotify, que es
  // donde ese aviso se muestra (ver el banner en Spotify.jsx).
  const cameFromSpotifyOAuth = new URLSearchParams(window.location.search).has('spotify');
  // El resultado en sí (connected|not_registered|error) hay que guardarlo
  // ACÁ, en el primer render: el efecto de "estado -> URL" de más abajo
  // reescribe la URL sin la query antes de que el panel de Spotify (carga
  // perezosa, ver lazyPanel.jsx) llegue a montarse, así que leerla desde
  // window.location dentro de Spotify.jsx ya no encontraba nada y ningún
  // aviso de la vuelta del OAuth se mostraba jamás. Spotify.jsx lo consume
  // una sola vez (onOAuthResultConsumed) para no repetirlo al volver a esa
  // pestaña.
  const [spotifyOAuthResult, setSpotifyOAuthResult] = useState(() => new URLSearchParams(window.location.search).get('spotify'));
  const consumeSpotifyOAuthResult = useCallback(() => setSpotifyOAuthResult(null), []);
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
  // Nombre accesible para los campos que solo tienen un texto vecino (ver useAutoLabels.js).
  useAutoLabels(!overlayMode);

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

  // Refs con el valor MÁS RECIENTE de tema/personalización -- declaradas
  // ACÁ (antes del listener de sockets de más abajo, que solo depende de
  // [socket] y por lo tanto ve una foto vieja de panelThemeStyle/
  // panelOverlayDraft en su closure) para poder comparar, en el momento
  // exacto en que llega un eco del backend, "¿esto que emití hace un rato
  // sigue siendo lo que el streamer tiene ahora, o ya cambió algo más
  // nuevo mientras tanto?".
  const panelThemeRef = useRef({ style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor });
  useEffect(() => { panelThemeRef.current = { style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor }; }, [panelThemeStyle, panelThemeAccent, panelThemeCustomColor]);
  const panelOverlayDraftRef = useRef(panelOverlayDraft);
  useEffect(() => { panelOverlayDraftRef.current = panelOverlayDraft; }, [panelOverlayDraft]);

  // Bug real reportado: cambiar rápido varias veces un ajuste del modal de
  // personalizar overlays (o un swatch de tema) podía "pisarse" con el eco
  // que el backend reenvía de un cambio anterior (mismo tab incluido, ver
  // Tenant.broadcast en tenant.js) -- como el efecto que emite depende del
  // propio estado, ese pisado encima disparaba un reenvío del valor viejo,
  // dejando el panel trabado en algo distinto de lo último elegido. Mismo
  // arreglo que TtsChat.jsx: debounce en el emit (ver más abajo) + ignorar
  // un eco si no coincide con lo último que mandamos (=> hay un cambio
  // local más nuevo que ese eco todavía no vio).
  const themeEmitTimeoutRef = useRef(null);
  const lastEmittedThemeRef = useRef(null);
  const overlayEmitTimeoutRef = useRef(null);
  const lastEmittedOverlayRef = useRef(null);

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
  // El catálogo es lo que TikTok devuelve (`giftsList`) más los regalos que
  // van llegando en el directo y que su lista no traía (`seenGifts`, ver
  // giftCatalog.js). `allGifts` es lo que ven todos los selectores. No hay
  // forma de crear regalos a mano.
  const [seenGifts, setSeenGifts]                 = useState([]);
  // Actividad en vivo del Dashboard (regalos, seguidores, stickers): el servidor
  // manda un resumen al conectar y luego cada evento (ver LiveFeed.jsx).
  const [feed, setFeed]                           = useState([]);
  // Versión anterior: regalos escritos a mano en este navegador. Ya no existen.
  useEffect(() => { try { localStorage.removeItem('tkc_extra_gifts'); } catch { /* sin almacenamiento */ } }, []);
  // Sonido en ESTA pestaña (ver alertMonitor.js y overlayAudio.js): el panel
  // reproduce todo el sonido y los overlays de OBS son solo visuales. Activado,
  // salida de audio elegida y si hay un overlay de alertas abierto (lo avisa el
  // servidor).
  const [soundEnabled, setSoundEnabledState]      = useState(loadSoundEnabled);
  const [monitorSink, setMonitorSinkState]        = useState(loadMonitorSink);
  const [alertsOverlayConnected, setAlertsOverlayConnected] = useState(false);
  const setSoundEnabled = (on) => { setSoundEnabledState(on); saveSoundEnabled(on); };
  const setMonitorSink = (id, label) => { const sink = { id, label }; setMonitorSinkState(sink); saveMonitorSink(sink); };
  // Salud del sistema (ver SystemHealth.jsx): estado real del socket con el
  // servidor y del motor de voz, más el aviso de "el servidor se reinició".
  const [socketConnected, setSocketConnected]  = useState(false);
  // Efectos de los juegos y sonido de Objetivo: los reproduce el panel. "Listo"
  // llega un momento después de conectar, para que el estado que entra de golpe
  // al conectar (o tras un reinicio del servidor) no dispare efectos viejos.
  const [soundsReady, setSoundsReady]             = useState(false);
  useEffect(() => {
    if (!socketConnected) { setSoundsReady(false); return undefined; }
    const timer = setTimeout(() => setSoundsReady(true), 2500);
    return () => clearTimeout(timer);
  }, [socketConnected]);
  useEventSounds(
    { king: state, zub: zubState, elim: elimState, roulette: rouletteState, goal: goalState },
    { enabled: soundEnabled && !overlayMode, ready: soundsReady, sinkId: monitorSink.id },
  );
  const [ttsEngine, setTtsEngine]              = useState('idle');
  const [serverRestarted, setServerRestarted]  = useState(false);
  const bootIdRef = useRef(null);
  useSectionRouting({ overlayMode, sidebarMode, setSidebarMode, eventsTab, setEventsTab });

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
    socket.on('goal_state_update', setGoalState);
    socket.on('viewer_count_update', ({ viewerCount: count }) => setViewerCount(count || 0));
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
      // Ver comentario de themeEmitTimeoutRef/lastEmittedThemeRef más
      // arriba: mientras haya un envío pendiente, o este eco no coincida
      // con lo último que mandamos, hay un cambio local más nuevo en
      // camino -- se ignora, el propio debounce va a mandar (y confirmar)
      // el valor final en un momento.
      if (themeEmitTimeoutRef.current) return;
      const sent = lastEmittedThemeRef.current;
      const current = panelThemeRef.current;
      if (sent && (sent.style !== current.style || sent.accent !== current.accent || sent.customColor !== current.customColor)) return;
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
      if (overlayEmitTimeoutRef.current) return;
      const sent = lastEmittedOverlayRef.current;
      const current = panelOverlayDraftRef.current;
      if (sent && JSON.stringify(sent) !== JSON.stringify(current)) return;
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
      setConnectionStatus(connected ? 'connected' : desiredUsername ? 'connecting' : 'idle');
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
    // overlayMode no cambia en toda la vida de la página, y handleSessionInvalid y setSkin no usan estado viejo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // Emite el skin del panel al backend cada vez que cambia (y una vez al
  // conectar, para sincronizar de entrada) — nunca en modo overlay, que solo
  // debe RECIBIR el tema, jamás pisarlo con el suyo propio. Debounce a
  // propósito (ver comentario de themeEmitTimeoutRef más arriba): colapsa
  // una racha de clicks/cambios en un solo envío con el valor final, en
  // vez de uno por cambio.
  useEffect(() => {
    if (overlayMode || !socket) return;
    if (themeEmitTimeoutRef.current) clearTimeout(themeEmitTimeoutRef.current);
    themeEmitTimeoutRef.current = setTimeout(() => {
      const payload = { style: panelThemeStyle, accent: panelThemeAccent, customColor: panelThemeCustomColor };
      socket.emit('set_theme', payload);
      lastEmittedThemeRef.current = payload;
      themeEmitTimeoutRef.current = null;
    }, 300);
    return () => { if (themeEmitTimeoutRef.current) clearTimeout(themeEmitTimeoutRef.current); };
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
    if (overlayEmitTimeoutRef.current) clearTimeout(overlayEmitTimeoutRef.current);
    overlayEmitTimeoutRef.current = setTimeout(() => {
      socket.emit('set_overlay_customization', panelOverlayDraft);
      lastEmittedOverlayRef.current = panelOverlayDraft;
      overlayEmitTimeoutRef.current = null;
    }, 300);
    return () => { if (overlayEmitTimeoutRef.current) clearTimeout(overlayEmitTimeoutRef.current); };
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
  // no se vuelven a disparar si el streamer no cambió nada. Usamos los
  // refs declarados arriba (panelThemeRef/panelOverlayDraftRef) para
  // mandar siempre el valor más reciente, sin importar cuándo llegue el
  // evento 'connect'.
  // Estado de la conexión con el servidor + detección de reinicios: cada
  // arranque del backend tiene un id distinto; si un panel que seguía abierto
  // recibe un id nuevo, el servidor se reinició y todo lo que vivía en
  // memoria (partidas, rankings, conexión con TikTok) se perdió.
  useEffect(() => {
    if (overlayMode || !socket) return;
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onBoot = ({ bootId } = {}) => {
      if (!bootId) return;
      if (bootIdRef.current && bootIdRef.current !== bootId) setServerRestarted(true);
      bootIdRef.current = bootId;
    };
    setSocketConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('server_boot', onBoot);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('server_boot', onBoot);
    };
  }, [socket, overlayMode]);

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

    if (isAdoptingRef.current) {
      isAdoptingRef.current = false;
      return;
    }

    setConnectionStatus('checking');

    const timeoutId = setTimeout(() => {
      // Socket.io guarda el emit incluso si todavía está terminando su propio
      // handshake. El tenant se encarga de reintentar cada 3 segundos.
      setConnectionStatus('connecting');
      setConnectionError('');
      socket.emit('set_desired_username', normalizedUsername);
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [username, socket, overlayMode]);

  const giftsList = useGiftCatalog({ session, socketConnected, overlayMode, connectionStatus, username });
  const allGifts = useMemo(() => mergeCatalog(giftsList, seenGifts), [giftsList, seenGifts]);

  // Avisos del servidor: si hay un overlay de alertas abierto, y los regalos que
  // van llegando en el directo (que la lista que bajó TikTok puede no traer):
  // se agregan a los selectores sin recargar nada.
  useEffect(() => {
    if (!socket || overlayMode) return undefined;
    const onOverlayStatus = (status) => setAlertsOverlayConnected(!!status?.connected);
    const onGiftSeen = (gift) => setSeenGifts((prev) => addSeenGift(prev, gift));
    socket.on('alerts_overlay_status', onOverlayStatus);
    socket.on('gift_seen', onGiftSeen);
    const onFeedSnapshot = (items) => setFeed(Array.isArray(items) ? items.slice(0, FEED_MAX) : []);
    const onFeedItem = (item) => setFeed((prev) => addFeedItem(prev, item));
    socket.on('feed_snapshot', onFeedSnapshot);
    socket.on('feed_item', onFeedItem);
    return () => {
      socket.off('alerts_overlay_status', onOverlayStatus);
      socket.off('gift_seen', onGiftSeen);
      socket.off('feed_snapshot', onFeedSnapshot);
      socket.off('feed_item', onFeedItem);
    };
  }, [socket, overlayMode]);


  if (overlayMode) {
    return (
      <OverlayModeView
        socket={socket} state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize}
        overlayTheme={overlayTheme} overlayCustomization={overlayCustomization} diceState={diceState}
        tapTapState={tapTapState} gifterState={gifterState} spotifyQueueState={spotifyQueueState}
        extensibleState={extensibleState} goalState={goalState} viewerCount={viewerCount}
      />
    );
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

  // Cambio de pestaña dentro de TikTokEvents: además del estado, avisamos al backend que cambiamos de modo (solo si
  // ese modo tiene overlay y hay socket — sin sesión no hay nada que avisar).
  const selectEventsTab = (tabId) => {
    setEventsTab(tabId);
    if (socket && OVERLAY_APPS.includes(tabId)) socket.emit('set_active_app', tabId);
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
      <a href="#contenido-principal" className="tkc-skip-link">Saltar al contenido</a>
      {kickedOutMessage && (
        <div className="w-full bg-red-500/10 border-b border-red-500/40 text-red-700 text-[11px] font-bold text-center py-1.5 tracking-wide flex-shrink-0">
          {kickedOutMessage}
        </div>
      )}
      {serverRestarted && (
        <div role="alert" className="w-full bg-amber-500/10 border-b border-amber-500/40 text-amber-700 text-[11px] font-bold text-center py-1.5 px-3 tracking-wide flex-shrink-0 flex items-center justify-center gap-3">
          <span>El servidor se reinició. Tus partidas, rankings y cola de Spotify se restauraron (los juegos quedan en PAUSA: revísalos y reanúdalos). Tu conexión con TikTok se restablece sola; lo ocurrido en los últimos segundos antes del reinicio puede faltar.</span>
          <button type="button" onClick={() => setServerRestarted(false)} aria-label="Cerrar aviso" className="flex-shrink-0 leading-none">✕</button>
        </div>
      )}
      {/* Recordatorio de vencimiento (ver expiry.js): lleva directo a renovar. */}
      <ExpiryBanner session={session} hidden={sidebarMode === 'membership'} onRenew={() => setSidebarMode('membership')} />
      {/* El sonido de alertas y eventos lo pone este panel: hay que avisar si el navegador aún lo bloquea. */}
      <AudioUnlockBanner enabled={soundEnabled} />
    <div className="flex flex-col md:flex-row flex-1 min-h-0">
      <AppSidebar
        sidebarMode={sidebarMode} onNavigate={setSidebarMode} session={session}
        gameRunning={state.isActive || zubState.isActive || elimState.isActive || rouletteState.isActive}
        onEnter={() => goToEventTab('king')} onLogout={logout}
      />

      <main id="contenido-principal" tabIndex={-1} className="flex-1 flex flex-col md:flex overflow-y-auto md:overflow-hidden focus:outline-none">
        {/* Pedido explicito: página principal con accesos directos. Sin
            sesión igual se ve (versión reducida, ver Dashboard.jsx) -- no
            hace falta needsAccess acá porque cada shortcut ya lleva a una
            sección que sabe mostrar su propio login embebido si hace falta. */}
        {sidebarMode === 'dashboard' && (
          <Dashboard
            session={session} connectionStatus={connectionStatus} username={username}
            setUsername={handleSetUsername} connectionError={connectionError}
            usernameLocked={usernameLocked} onDisconnectTikTok={() => handleSetUsername('')}
            anyGameActive={state.isActive || zubState.isActive || elimState.isActive || rouletteState.isActive}
            ttsEnabled={ttsEnabled} ttsLocked={needsAccess('tts')}
            onToggleTts={() => ttsRef.current?.toggleEnabled()}
            socketConnected={socketConnected} ttsEngine={ttsEngine} feed={feed}
            onResetVoice={() => ttsRef.current?.resetEngine()}
            onReconnectTikTok={() => socket?.emit('force_reconnect')}
            onGoSection={setSidebarMode}
            onGoEventTab={goToEventTab}
          />
        )}
        {sidebarMode === 'overlay' && (
          <OverlayLink
            socket={socket} tapTapState={tapTapState} tapTapDiagnostics={tapTapDiagnostics} gifterState={gifterState} spotifyQueueState={spotifyQueueState}
            extensibleState={extensibleState} diceState={diceState}
            goalState={goalState} viewerCount={viewerCount}
            overlayCustomization={panelOverlayDraft} onCustomizeChange={updateOverlayCustomization} onApplyToAll={applyOverlayCustomizationToAll}
          />
        )}

        {sidebarMode === 'events' && (
          <EventsSection
            eventsTab={eventsTab} onSelectTab={selectEventsTab} socketConnected={socketConnected} connectionStatus={connectionStatus}
            ttsEnabled={ttsEnabled} ttsEngine={ttsEngine} needsAccess={needsAccess} onLoggedIn={onLoggedIn} onGoMembership={() => setSidebarMode('membership')}
            socket={socket} username={username} giftsList={allGifts} prize={prize} activeApp={activeApp}
            overlayTheme={overlayTheme} overlayCustomization={overlayCustomization}
            state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} extensibleState={extensibleState} goalState={goalState}
            spotifyQueueState={spotifyQueueState} spotifySettingsState={spotifySettingsState}
            spotifyOAuthResult={spotifyOAuthResult} onOAuthResultConsumed={consumeSpotifyOAuthResult}
            panelOverlayDraft={panelOverlayDraft} onCustomizeChange={updateOverlayCustomization} onApplyToAll={applyOverlayCustomizationToAll}
            soundEnabled={soundEnabled} onSoundEnabledChange={setSoundEnabled} alertsOverlayConnected={alertsOverlayConnected}
            monitorSink={monitorSink} onMonitorSinkChange={setMonitorSink}
          />
        )}
        {/* Permanece montado siempre (no solo dentro de "events") para que la
            lectura activa no se interrumpa si el streamer se va a otra
            sección mientras TTS sigue leyendo el chat en voz alta. */}
        <TtsChat ref={ttsRef} socket={socket} connectionStatus={connectionStatus} visible={sidebarMode === 'events' && eventsTab === 'tts' && !needsAccess('tts')} onEnabledChange={setTtsEnabled} onEngineStatusChange={setTtsEngine} />

        {/* Pedido explicito: el streamer no escuchaba sus propias alertas de
            sonido (solo llegaban a los espectadores por OBS) -- esto suena
            en SU navegador sin importar en qué pestaña del panel esté, no
            solo en la de Alertas. El visual lo sigue viendo en OBS (ahí
            tiene pegada esa URL aparte). SIEMPRE montado (antes era
            `{soundEnabled && (...)}`): desmontarlo tira la cola entera (ver
            el comentario en AlertSoundListener) y perdía alertas ya
            encoladas cada vez que se apagaba el sonido un momento -- ahora
            solo se le pasa `muted` y la cola sigue viva. */}
        <AlertSoundListener socket={socket} customize={overlayCustomization.alerts} sinkId={monitorSink.id} muted={!soundEnabled} />

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
        {sidebarMode === 'system' && session?.isAdmin && <AdminSystem onSessionInvalid={handleSessionInvalid} />}
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
