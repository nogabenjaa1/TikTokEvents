import React, { useState, useEffect, useRef } from 'react';
import AdminPanel from './AdminPanel';
import Zubastinis from './Zubastinis';
import Elimination from './Elimination';
import ColorSays from './Colorsays';
import Overlay from './Overlay';
import TikTokLoginBar from './TikTokLoginBar';
import Login from './Login';
import LicenseManager from './LicenseManager';
import ThemeSwitcher from './ThemeSwitcher';
import TtsChat from './TtsChat';
import OverlayLink from './OverlayLink';
import { ThemedShell, useTheme } from './ThemeContext';
import { isOverlayMode, loadSession, clearSession, buildAuthenticatedSocket, backendUrl, authHeaders, logoutSession } from './auth';

const MODES = [
  { id: 'overlay', label: 'Overlay',       icon: '🖥️' },
  { id: 'king',  label: 'Rey del\nTrono',  icon: '👑' },
  { id: 'zub',   label: 'Zubast\ninis',    icon: '🏆' },
  { id: 'elim',  label: 'Elimina\nción',   icon: '💀' },
  { id: 'color', label: 'Colores',         icon: '🎲' },
  { id: 'tts',   label: 'TTS\nChat',       icon: '🔊' },
];

// Modos que tienen representación en el overlay de OBS (Color Says no la
// tiene: se transmite directo desde su propia pantalla)
const OVERLAY_APPS = ['king', 'zub', 'elim'];

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'Ninguno',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

export default function App() {
  const overlayMode = isOverlayMode();
  const [session, setSession] = useState(() => loadSession());
  const [socket, setSocket] = useState(null);
  // Un solo dispositivo activo por licencia: si otro dispositivo se loguea
  // con la misma key, el backend nos desconecta y avisa por este evento.
  const [kickedOutMessage, setKickedOutMessage] = useState('');

  const [state, setState]         = useState({ isActive: false, mode: 'idle', timeLeft: 0 });
  const [zubState, setZubState]   = useState({ isActive: false, mode: 'idle', timeLeft: 0, top3: [], winner: null });
  const [elimState, setElimState] = useState({ isActive: false, mode: 'idle', timeLeft: 0, participants: [], lastEliminated: null, winner: null });
  const [sidebarMode, setSidebarMode] = useState('king');

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
  const [prizes, setPrizes] = useState({ king: null, zub: null, elim: null });

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

    // Escuchar cambios de app activa (para el overlay)
    socket.on('active_app_changed', setActiveApp);
    socket.on('prizes_updated', setPrizes);
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
    return <Overlay state={state} zubState={zubState} elimState={elimState} activeApp={activeApp} prizes={prizes} theme={overlayTheme} />;
  }

  if (!session) {
    return (
      <ThemedShell>
        <Login
          onLoggedIn={() => { setKickedOutMessage(''); setSession(loadSession()); }}
          notice={kickedOutMessage}
        />
      </ThemedShell>
    );
  }

  const logout = () => {
    logoutSession(); // best-effort, no bloquea el logout local
    socket?.disconnect();
    clearSession();
    setSession(null);
    setSidebarMode('king');
  };

  // El username queda bloqueado mientras cualquier módulo que dependa de la
  // conexión live esté activo (todos comparten la misma conexión).
  const usernameLocked = state.isActive || zubState.isActive || elimState.isActive;

  // Recordatorio de vencimiento in-app: licencias lifetime no tienen expiresAt.
  const daysLeft = session.expiresAt
    ? Math.ceil((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const showExpiryWarning = daysLeft !== null && daysLeft <= 3;

  return (
    <ThemedShell className="flex flex-col">
      {showExpiryWarning && (
        <div className="w-full bg-amber-950/80 border-b border-amber-700/50 text-amber-300 text-[11px] font-bold text-center py-1.5 tracking-wide flex-shrink-0">
          ⚠️ Tu licencia vence {daysLeft <= 0 ? 'hoy' : `en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`} — contacta al administrador para renovarla.
        </div>
      )}
    <div className="flex flex-1 min-h-0">
      <TikTokLoginBar
        username={username} setUsername={setUsername}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        disabled={usernameLocked}
      />

      <aside className="theme-sidebar flex flex-col items-center gap-2 w-[72px] min-h-screen py-4 flex-shrink-0 z-50">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setSidebarMode(m.id);
              // Avisamos al backend que cambiamos de modo (solo si ese modo
              // tiene overlay; Color Says se ve desde su propia pantalla)
              if (OVERLAY_APPS.includes(m.id)) socket.emit('set_active_app', m.id);
            }}
            className={[
              'theme-nav-btn w-[52px] h-[52px] rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200',
              sidebarMode === m.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-xl leading-none">{m.icon}</span>
            <span className={[ 'text-[8px] font-bold uppercase tracking-wider text-center leading-tight whitespace-pre-line', sidebarMode === m.id ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
              {m.label}
            </span>
          </button>
        ))}

        <div className="w-8 h-px my-1" style={{ background: 'var(--surface-border-color)' }} />
        <button
          onClick={() => setSidebarMode('theme')}
          title="Elegir tema"
          className={[
            'theme-nav-btn w-[52px] h-[52px] rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200',
            sidebarMode === 'theme' ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
          ].join(' ')}
        >
          <span className="text-xl leading-none">🎨</span>
          <span className={[ 'text-[8px] font-bold uppercase tracking-wider', sidebarMode === 'theme' ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
            Tema
          </span>
        </button>

        {session.isAdmin && (
          <button
            onClick={() => setSidebarMode('licenses')}
            title="Administrar licencias"
            className={[
              'theme-nav-btn w-[52px] h-[52px] rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200',
              sidebarMode === 'licenses' ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-xl leading-none">🔑</span>
            <span className={[ 'text-[8px] font-bold uppercase tracking-wider', sidebarMode === 'licenses' ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
              Licencias
            </span>
          </button>
        )}

        <div className="flex-1" />
        <button onClick={logout} title="Cerrar sesión"
          className="w-[52px] h-[52px] rounded-[14px] border border-transparent hover:bg-red-950/40 hover:border-red-900/50 flex flex-col items-center justify-center gap-1 transition-all duration-200">
          <span className="text-xl leading-none">🚪</span>
          <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500">Salir</span>
        </button>
      </aside>

      <main className="flex-1 flex overflow-hidden">
        {sidebarMode === 'overlay' && <OverlayLink />}
        {sidebarMode === 'king' && (
          <AdminPanel
            state={state} socket={socket}
            username={username} connectionStatus={connectionStatus} giftsList={giftsList}
            prize={prizes.king}
          />
        )}
        {sidebarMode === 'zub' && (
          <Zubastinis
            state={zubState} socket={socket}
            username={username} connectionStatus={connectionStatus}
            prize={prizes.zub}
          />
        )}
        {sidebarMode === 'elim' && (
          <Elimination
            state={elimState} socket={socket}
            username={username} connectionStatus={connectionStatus} giftsList={giftsList}
            prize={prizes.elim}
          />
        )}
        {/* Color Says no necesita socket: se transmite directo desde su pantalla.
            isAdmin gatea el sesgo de pares y el Safe Mode: solo notbenjaa1 los ve,
            el resto de licencias de pago siempre tira con probabilidades limpias. */}
        {sidebarMode === 'color' && <ColorSays isAdmin={session.isAdmin} />}
        {/* Permanece montado al cambiar de módulo para que la lectura activa no
            se interrumpa mientras el streamer controla uno de los juegos. */}
        <TtsChat socket={socket} connectionStatus={connectionStatus} visible={sidebarMode === 'tts'} />
        {sidebarMode === 'theme' && <ThemeSwitcher />}
        {sidebarMode === 'licenses' && session.isAdmin && <LicenseManager />}
      </main>
    </div>
    </ThemedShell>
  );
}
