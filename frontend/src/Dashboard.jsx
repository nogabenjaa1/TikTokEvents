import { useState, useEffect } from 'react';
import TikTokLoginBar from './TikTokLoginBar';
import SystemHealth from './SystemHealth';
import LiveFeed from './LiveFeed';
import NavIcon from './app/NavIcon';
import LegalLinks from './LegalLinks';

// Mismos ids/labels que SECTIONS/EVENT_TABS en App.jsx -- duplicados acá
// nada más para no importar de vuelta (App.jsx ya importa Dashboard, un
// import circular). Si algún día se agrega/saca una sección, hay que
// actualizar las listas.
const SECTION_SHORTCUTS = [
  { id: 'overlay', label: 'Overlays', hint: 'Los enlaces que pegas en OBS', free: true },
  { id: 'color', label: 'ColorDice', hint: 'Dados y colores', free: true },
  { id: 'downloader', label: 'Downloader', hint: 'Descarga videos sin marca de agua', free: false },
  { id: 'theme', label: 'Tema', hint: 'Cambia el estilo del panel', free: true },
  { id: 'membership', label: 'Membresía', hint: 'Planes y precios', free: true },
];

// Los eventos van agrupados por lo que hacen, para que alguien nuevo
// entienda de un vistazo qué es cada cosa (antes eran 8 tarjetas iguales).
const EVENT_GROUPS = [
  {
    id: 'games',
    title: 'Juegos para tu directo',
    items: [
      { id: 'king', label: 'Rey del Trono', hint: 'Quien regala último se queda con el trono' },
      { id: 'zub', label: 'Zubastinis', hint: 'Gana quien más monedas regale' },
      { id: 'elim', label: 'Eliminación', hint: 'Los participantes van saliendo hasta que queda uno' },
      { id: 'roulette', label: 'Ruleta', hint: 'Sortea un ganador entre los participantes' },
    ],
  },
  {
    id: 'counters',
    title: 'Contadores y metas',
    items: [
      { id: 'extensible', label: 'Extensible', hint: 'Un tiempo que crece con seguidores y regalos' },
      { id: 'goal', label: 'Objetivo', hint: 'Barra de meta de monedas o seguidores' },
    ],
  },
  {
    id: 'chat',
    title: 'Interacción con tu chat',
    items: [
      { id: 'alerts', label: 'Alertas', hint: 'Imagen, sonido y texto cuando llega un regalo' },
      { id: 'tts', label: 'TTS', hint: 'Lee el chat en voz alta' },
      { id: 'spotify', label: 'Spotify', hint: 'Cola de canciones para tu directo' },
    ],
  },
];

const ONBOARDING_KEY = 'tkc_dashboard_onboarding';

function loadOnboarding() {
  try {
    return { dismissed: false, connect: false, overlays: false, alerts: false, game: false, ...JSON.parse(localStorage.getItem(ONBOARDING_KEY) || '{}') };
  } catch {
    return { dismissed: false, connect: false, overlays: false, alerts: false, game: false };
  }
}

function saveOnboarding(value) {
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify(value)); } catch { /* sin storage: la guía igual funciona en esta sesión */ }
}

// Acceso directo a una herramienta (Overlays, ColorDice...): ícono, nombre y
// una línea de ayuda. Si necesita licencia lo dice en su propia línea, debajo
// (antes era una etiqueta encimada en la esquina que chocaba con el título).
function ShortcutCard({ icon, label, hint, onClick, locked }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={locked ? `${label} (requiere licencia)` : label}
      className="theme-surface tkc-card-link p-3 flex items-start gap-3 text-left"
    >
      {icon && <NavIcon name={icon} size={20} className="theme-accent-text mt-0.5" />}
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-black text-white leading-tight">{label}</span>
        {hint && <span className="tkc-hint">{hint}</span>}
        {locked && <span className="tkc-label theme-label mt-0.5">Con licencia</span>}
      </span>
    </button>
  );
}

// Un grupo de eventos (Juegos, Contadores, Chat) en UNA tarjeta, con una fila
// por evento. Antes era una tarjeta por evento repartida en una grilla de 4
// columnas: los grupos de 2 o 3 dejaban huecos y cada tarjeta repetía "Con
// licencia" (10 veces). Ahora se dice una sola vez, encima de los grupos.
function EventGroupCard({ group, locked, onGo }) {
  const titleId = `dash-group-${group.id}`;
  return (
    <section className="theme-surface p-2 flex flex-col" aria-labelledby={titleId}>
      <h2 id={titleId} className="tkc-label theme-label px-3 pt-2 pb-1.5">{group.title}</h2>
      <ul className="flex flex-col">
        {group.items.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onGo(t.id)}
              aria-label={locked ? `${t.label} (requiere licencia)` : t.label}
              className="tkc-row-link w-full text-left px-3 py-2 flex flex-col gap-0.5"
            >
              <span className="text-sm font-black text-white leading-tight">{t.label}</span>
              <span className="tkc-hint">{t.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Página principal (pedido explícito: "una página con shortcuts") -- punto
// de entrada por default con sesión (ver sectionFromPath en App.jsx). Sin
// sesión muestra una versión reducida: bienvenida + los shortcuts que de
// todos modos son de acceso libre (Overlays/ColorDice/Tema/Membresía), el
// resto queda con el candado 🔒 -- clickearlos igual navega a esa sección,
// que ya sabe mostrar su propio login embebido (mismo comportamiento que
// clickear esos botones desde la sidebar).
// Con sesión, arriba muestra una guía de "Primeros pasos" pensada para
// quien es nuevo (se puede ocultar, y recuerda lo que ya hiciste).
export default function Dashboard({
  session, connectionStatus, username, setUsername, connectionError, usernameLocked, onDisconnectTikTok,
  anyGameActive, ttsEnabled, ttsLocked, onToggleTts, onGoSection, onGoEventTab,
  socketConnected, ttsEngine, onResetVoice, onReconnectTikTok, feed = [],
}) {
  const connected = connectionStatus === 'connected';
  const daysLeft = session?.expiresAt
    ? Math.ceil((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  const [onboarding, setOnboarding] = useState(loadOnboarding);
  const updateOnboarding = (patch) => {
    setOnboarding((prev) => {
      const next = { ...prev, ...patch };
      saveOnboarding(next);
      return next;
    });
  };

  // Recordar que ya se conectó alguna vez (no hace falta estado: el paso se
  // marca hecho con `connected || onboarding.connect`, esto solo lo persiste).
  useEffect(() => {
    if (connected && !onboarding.connect) saveOnboarding({ ...onboarding, connect: true });
  }, [connected, onboarding]);

  const steps = [
    {
      id: 'connect', done: connected || onboarding.connect,
      title: 'Conecta tu TikTok',
      text: 'Escribe tu usuario en la tarjeta de conexión y entra en vivo. Es lo único que necesitas para que los eventos funcionen.',
      action: null,
    },
    {
      id: 'overlays', done: onboarding.overlays,
      title: 'Pon tus overlays en OBS',
      text: 'Copia el enlace de cada overlay y pégalo como fuente de navegador en OBS.',
      action: { label: 'Ir a Overlays', run: () => { updateOnboarding({ overlays: true }); onGoSection('overlay'); } },
    },
    {
      id: 'alerts', done: onboarding.alerts,
      title: 'Crea tu primera alerta',
      text: 'Elige un regalo y qué mostrar cuando lo reciban. Puedes hacerlo sin estar en vivo.',
      action: { label: 'Crear alerta', run: () => { updateOnboarding({ alerts: true }); onGoEventTab('alerts'); } },
    },
    {
      id: 'game', done: onboarding.game,
      title: 'Prueba un juego',
      text: 'Empieza por Rey del Trono: elige un regalo, ajusta los tiempos y ponlo a correr.',
      action: { label: 'Ver Rey del Trono', run: () => { updateOnboarding({ game: true }); onGoEventTab('king'); } },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const showOnboarding = !!session && !onboarding.dismissed && doneCount < steps.length;

  return (
    <div className="min-h-screen text-white flex flex-col items-center px-4 py-6 sm:px-6 sm:pt-8 font-sans flex-1 overflow-y-auto gap-6">
      <header className="w-full max-w-5xl flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="theme-accent-text tkc-eyebrow">Dashboard</p>
          <h1 className="theme-heading text-2xl font-black">
            {session ? `Hola, @${session.username}` : 'Bienvenido a BenjaApis'}
          </h1>
          <p className="text-sm text-gray-500">
            {session
              ? 'Todo tu panel en un solo lugar. Empieza por lo que necesites.'
              : 'Inicia sesión o prueba gratis para desbloquear todo el panel.'}
          </p>
        </div>
        {session && connected && (
          <span role="status" className="tkc-label inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full border text-green-300 border-green-500/40 bg-green-500/10">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            En vivo
          </span>
        )}
        {session && !connected && (
          <span role="status" className="tkc-label inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full border border-gray-600/50 text-gray-400">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            Sin conexión en vivo
          </span>
        )}
      </header>

      {/* Una sola llamada a la acción para quien llega sin licencia: probar
          gratis (en Membresía, donde vive la prueba). Iniciar sesión queda
          como enlace secundario, para quien ya tiene clave. */}
      {!session && (
        <div className="w-full max-w-5xl theme-surface-featured p-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="theme-heading text-lg font-black">Desbloquea todo tu panel</h2>
            <p className="tkc-hint mt-1 max-w-lg">Juegos con regalos, alertas, TTS del chat, Spotify y overlays para OBS. Pruébalo gratis, sin pagar nada.</p>
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-1 flex-shrink-0">
            <button type="button" onClick={() => onGoSection('membership')} className="theme-btn-primary theme-btn-lg font-black uppercase tracking-widest shadow-lg">
              Probar gratis
            </button>
            <button type="button" onClick={() => onGoEventTab('king')} className="theme-link self-center sm:self-end">
              Ya tengo licencia: iniciar sesión
            </button>
          </div>
        </div>
      )}

      {showOnboarding && (
        <section className="w-full max-w-5xl theme-surface-featured p-5 sm:px-6" aria-labelledby="onboarding-title">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h2 id="onboarding-title" className="theme-heading text-lg font-black">Primeros pasos</h2>
              <p className="tkc-hint mt-0.5">{doneCount} de {steps.length} listos — sigue el orden o salta al que quieras.</p>
            </div>
            <button type="button" onClick={() => updateOnboarding({ dismissed: true })} className="theme-link whitespace-nowrap">
              Ocultar guía
            </button>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden mb-4 bg-black/25" aria-hidden="true">
            <div className="h-full theme-accent-bg transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {steps.map((step, i) => (
              <li key={step.id} className="theme-input p-3 flex gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${step.done ? 'bg-green-500 text-black' : 'theme-chip'}`} aria-label={step.done ? 'Listo' : `Paso ${i + 1}`}>
                  {step.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-black leading-tight ${step.done ? 'text-gray-400 line-through' : 'text-white'}`}>{step.title}</p>
                  <p className="tkc-hint mt-1">{step.text}</p>
                  {step.action && !step.done && (
                    <button type="button" onClick={step.action.run} className="theme-btn-primary theme-btn-sm mt-2 font-black uppercase tracking-widest">
                      {step.action.label}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Lo último que pasó en el directo: regalos (con su imagen y cuántos), seguidores y stickers. */}
      {session && <LiveFeed feed={feed} connected={connected} />}

      {session && (
        <section className="w-full max-w-5xl" aria-label="Estado de tu cuenta">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="theme-surface p-4 flex flex-col gap-2">
              <h2 className="tkc-label theme-label">Conexión a TikTok</h2>
              <TikTokLoginBar
                username={username} setUsername={setUsername}
                connectionStatus={connectionStatus} connectionError={connectionError}
                disabled={usernameLocked} onDisconnect={onDisconnectTikTok}
              />
              {!connected && connectionStatus !== 'connecting' && connectionStatus !== 'checking' && (
                <p className="tkc-hint">Conéctate cuando vayas a empezar tu directo. Puedes dejar todo configurado antes.</p>
              )}
              {anyGameActive && <p className="text-xs text-amber-500 font-bold">Hay un juego activo ahora mismo</p>}
            </div>

            <div className="theme-surface p-4 flex flex-col gap-2">
              <h2 className="tkc-label theme-label">TTS del chat</h2>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black">{ttsEnabled ? 'Activado' : 'Apagado'}</span>
                <button
                  type="button"
                  onClick={onToggleTts}
                  disabled={ttsLocked || (!ttsEnabled && !connected)}
                  className={`font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed theme-btn-sm ${ttsEnabled ? 'theme-btn-danger' : 'theme-btn-primary'}`}
                >
                  {ttsEnabled ? 'Apagar' : 'Prender'}
                </button>
              </div>
              <p className="tkc-hint">
                {ttsLocked
                  ? 'El TTS no está incluido en tu plan actual.'
                  : !connected && !ttsEnabled
                    ? 'Necesitas estar conectado a un LIVE para prenderlo.'
                    : 'Por seguridad se apaga solo cada vez que recargas la página.'}
              </p>
            </div>

            <div className="theme-surface p-4 flex flex-col gap-1">
              <h2 className="tkc-label theme-label">Tu plan</h2>
              <p className="text-sm font-black capitalize">{session.licenseType === 'trial' ? 'Prueba gratis' : session.licenseType || '—'}</p>
              {daysLeft !== null ? (
                <p className={`text-xs font-bold ${daysLeft <= 3 ? 'text-red-700' : 'text-gray-500'}`}>
                  {daysLeft <= 0 ? 'Vence hoy' : `Vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}
                </p>
              ) : (
                <p className="tkc-hint">Sin fecha de vencimiento</p>
              )}
              <button type="button" onClick={() => onGoSection('membership')} className="theme-link theme-link-info text-left self-start">
                Ver planes
              </button>
            </div>

            <div className="theme-surface p-4 flex flex-col gap-2 md:col-span-3">
              <h2 className="tkc-label theme-label">Estado del sistema</h2>
              <SystemHealth
                socketConnected={socketConnected} connectionStatus={connectionStatus}
                ttsEnabled={ttsEnabled} ttsEngine={ttsEngine}
                onResetVoice={onResetVoice} onReconnectTikTok={onReconnectTikTok}
              />
            </div>
          </div>
        </section>
      )}

      <section className="w-full max-w-5xl" aria-labelledby="dash-events">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-2 px-1">
          <h2 id="dash-events" className="tkc-label theme-label">Eventos</h2>
          {!session && <p className="text-xs font-bold text-gray-500">Requieren licencia o la prueba gratis</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {EVENT_GROUPS.map((group) => (
            <EventGroupCard key={group.id} group={group} locked={!session} onGo={onGoEventTab} />
          ))}
        </div>
      </section>

      <section className="w-full max-w-5xl" aria-labelledby="dash-tools">
        <h2 id="dash-tools" className="tkc-label theme-label mb-2 px-1">Herramientas y ajustes</h2>
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {SECTION_SHORTCUTS.map((s) => (
            <ShortcutCard
              key={s.id} icon={s.id} label={s.label} hint={s.hint}
              locked={!session && !s.free}
              onClick={() => onGoSection(s.id)}
            />
          ))}
        </div>
      </section>

      <LegalLinks onNavigate={onGoSection} className="w-full max-w-5xl" />
    </div>
  );
}
