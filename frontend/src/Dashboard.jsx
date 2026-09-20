import React, { useState, useEffect } from 'react';
import TikTokLoginBar from './TikTokLoginBar';
import SystemHealth from './SystemHealth';
import LiveFeed from './LiveFeed';

// Mismos ids/labels que SECTIONS/EVENT_TABS en App.jsx -- duplicados acá
// nada más para no importar de vuelta (App.jsx ya importa Dashboard, un
// import circular). Si algún día se agrega/saca una sección, hay que
// actualizar las listas.
const SECTION_SHORTCUTS = [
  { id: 'overlay', label: 'Overlays', icon: '🖥️', hint: 'Los enlaces que pegas en OBS', free: true },
  { id: 'color', label: 'ColorDice', icon: '🎲', hint: 'Dados y colores', free: true },
  { id: 'downloader', label: 'Downloader', icon: '⬇️', hint: 'Descarga videos sin marca de agua', free: false },
  { id: 'theme', label: 'Tema', icon: '🎨', hint: 'Cambia el estilo del panel', free: true },
  { id: 'membership', label: 'Membresía', icon: '💳', hint: 'Planes y precios', free: true },
];

// Los eventos van agrupados por lo que hacen, para que alguien nuevo
// entienda de un vistazo qué es cada cosa (antes eran 8 tarjetas iguales).
const EVENT_GROUPS = [
  {
    title: 'Juegos para tu directo',
    items: [
      { id: 'king', label: 'Rey del Trono', icon: '👑', hint: 'Quien regala último se queda con el trono' },
      { id: 'zub', label: 'Zubastinis', icon: '🏆', hint: 'Gana quien más monedas regale' },
      { id: 'elim', label: 'Eliminación', icon: '💀', hint: 'Los participantes van saliendo hasta que queda uno' },
      { id: 'roulette', label: 'Ruleta', icon: '🎡', hint: 'Sortea un ganador entre los participantes' },
    ],
  },
  {
    title: 'Contadores y metas',
    items: [
      { id: 'extensible', label: 'Extensible', icon: '⏱️', hint: 'Un tiempo que crece con seguidores y regalos' },
      { id: 'goal', label: 'Objetivo', icon: '🎯', hint: 'Barra de meta de monedas o seguidores' },
    ],
  },
  {
    title: 'Interacción con tu chat',
    items: [
      { id: 'alerts', label: 'Alertas', icon: '🔔', hint: 'Imagen, sonido y texto cuando llega un regalo' },
      { id: 'tts', label: 'TTS', icon: '🔊', hint: 'Lee el chat en voz alta' },
      { id: 'spotify', label: 'Spotify', icon: '🎵', hint: 'Cola de canciones para tu directo' },
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

function ShortcutCard({ icon, label, hint, onClick, locked }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={locked ? `${label} (requiere iniciar sesión)` : label}
      className="theme-surface p-4 flex flex-col items-start gap-1 text-left hover:opacity-90 hover:-translate-y-0.5 transition-all relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      {locked && <span className="absolute top-3 right-3 text-xs" aria-hidden="true">🔒</span>}
      <span className="text-2xl leading-none" aria-hidden="true">{icon}</span>
      <span className="text-sm font-black text-white mt-1">{label}</span>
      {hint && <span className="text-[11px] text-gray-500 leading-snug">{hint}</span>}
    </button>
  );
}

function SectionTitle({ children, hint }) {
  return (
    <div className="mb-3">
      <h2 className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">{children}</h2>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
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
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-8">
      <header className="w-full max-w-4xl flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🏠 Dashboard</p>
          <h1 className="theme-heading text-2xl font-black">
            {session ? `Hola, @${session.username}` : 'Bienvenido a BenjaApis'}
          </h1>
          <p className="text-xs text-gray-500">
            {session
              ? 'Todo tu panel en un solo lugar. Empieza por lo que necesites.'
              : 'Inicia sesión o prueba gratis para desbloquear todo el panel.'}
          </p>
        </div>
        {session && connected && (
          <span role="status" className="inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border text-green-300 border-green-500/40 bg-green-500/10">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            En vivo
          </span>
        )}
        {session && !connected && (
          <span role="status" className="inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-600/50 text-gray-400">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            Sin conexión en vivo
          </span>
        )}
      </header>

      {!session && (
        <div className="w-full max-w-4xl theme-surface-featured p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="theme-heading text-lg font-black">Desbloquea todo tu panel</h2>
            <p className="text-xs text-gray-400 mt-1 max-w-lg">Con una licencia (o la prueba gratis) accedes a los juegos, las alertas, el TTS y más. Los accesos con candado te llevan directo a iniciar sesión.</p>
          </div>
          <button type="button" onClick={() => onGoEventTab('king')} className="theme-btn-primary px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg flex-shrink-0">
            Iniciar sesión
          </button>
        </div>
      )}

      {showOnboarding && (
        <section className="w-full max-w-4xl theme-surface-featured p-6" aria-labelledby="onboarding-title">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 id="onboarding-title" className="theme-heading text-lg font-black">Primeros pasos</h2>
              <p className="text-xs text-gray-400 mt-0.5">{doneCount} de {steps.length} listos — sigue el orden o salta al que quieras.</p>
            </div>
            <button type="button" onClick={() => updateOnboarding({ dismissed: true })} className="text-[10px] font-bold text-gray-400 hover:text-white underline whitespace-nowrap py-2">
              Ocultar guía
            </button>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden mb-4 bg-black/25" aria-hidden="true">
            <div className="h-full theme-accent-bg transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {steps.map((step, i) => (
              <li key={step.id} className="theme-input p-4 flex gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${step.done ? 'bg-green-500 text-black' : 'theme-chip'}`} aria-label={step.done ? 'Listo' : `Paso ${i + 1}`}>
                  {step.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-black ${step.done ? 'text-gray-400 line-through' : 'text-white'}`}>{step.title}</p>
                  <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{step.text}</p>
                  {step.action && !step.done && (
                    <button type="button" onClick={step.action.run} className="theme-btn-primary mt-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest">
                      {step.action.label} →
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
        <section className="w-full max-w-4xl" aria-label="Estado de tu cuenta">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="theme-surface p-4 flex flex-col gap-2">
              <h2 className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Conexión a TikTok</h2>
              <TikTokLoginBar
                username={username} setUsername={setUsername}
                connectionStatus={connectionStatus} connectionError={connectionError}
                disabled={usernameLocked} onDisconnect={onDisconnectTikTok}
              />
              {!connected && connectionStatus !== 'connecting' && connectionStatus !== 'checking' && (
                <p className="text-[11px] text-gray-500 leading-snug">Conéctate cuando vayas a empezar tu directo. Puedes dejar todo configurado antes.</p>
              )}
              {anyGameActive && <p className="text-[11px] text-amber-500 font-bold">Hay un juego activo ahora mismo</p>}
            </div>

            <div className="theme-surface p-4 flex flex-col gap-2">
              <h2 className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">TTS del chat</h2>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black">{ttsEnabled ? '🔊 Activado' : '🔇 Apagado'}</span>
                <button
                  type="button"
                  onClick={onToggleTts}
                  disabled={ttsLocked || (!ttsEnabled && !connected)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${ttsEnabled ? 'bg-red-950/70 border border-red-700/60 text-red-300' : 'theme-btn-primary'}`}
                >
                  {ttsEnabled ? 'Apagar' : 'Prender'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 leading-snug">
                {ttsLocked
                  ? 'El TTS no está incluido en tu plan actual.'
                  : !connected && !ttsEnabled
                    ? 'Necesitas estar conectado a un LIVE para prenderlo.'
                    : 'Por seguridad se apaga solo cada vez que recargas la página.'}
              </p>
            </div>

            <div className="theme-surface p-4 flex flex-col gap-1">
              <h2 className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Tu plan</h2>
              <p className="text-sm font-black capitalize">{session.licenseType === 'trial' ? 'Prueba gratis' : session.licenseType || '—'}</p>
              {daysLeft !== null ? (
                <p className={`text-[11px] font-bold ${daysLeft <= 3 ? 'text-red-700' : 'text-gray-500'}`}>
                  {daysLeft <= 0 ? 'Vence hoy' : `Vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}
                </p>
              ) : (
                <p className="text-[11px] text-gray-500">Sin fecha de vencimiento</p>
              )}
              <button type="button" onClick={() => onGoSection('membership')} className="text-[11px] font-bold text-sky-400 hover:text-sky-300 underline text-left py-1.5">
                Ver planes
              </button>
            </div>

            <div className="theme-surface p-4 flex flex-col gap-2 md:col-span-3">
              <h2 className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Estado del sistema</h2>
              <SystemHealth
                socketConnected={socketConnected} connectionStatus={connectionStatus}
                ttsEnabled={ttsEnabled} ttsEngine={ttsEngine}
                onResetVoice={onResetVoice} onReconnectTikTok={onReconnectTikTok}
              />
            </div>
          </div>
        </section>
      )}

      {EVENT_GROUPS.map((group) => (
        <section key={group.title} className="w-full max-w-4xl" aria-label={group.title}>
          <SectionTitle>{group.title}</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {group.items.map((t) => (
              <ShortcutCard
                key={t.id} icon={t.icon} label={t.label} hint={t.hint}
                locked={!session}
                onClick={() => onGoEventTab(t.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="w-full max-w-4xl" aria-label="Herramientas y ajustes">
        <SectionTitle>Herramientas y ajustes</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {SECTION_SHORTCUTS.map((s) => (
            <ShortcutCard
              key={s.id} icon={s.icon} label={s.label} hint={s.hint}
              locked={!session && !s.free}
              onClick={() => onGoSection(s.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
