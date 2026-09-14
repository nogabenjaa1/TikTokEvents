import React from 'react';

// Mismos ids/labels que SECTIONS/EVENT_TABS en App.jsx -- duplicados acá
// nada más para no importar de vuelta (App.jsx ya importa Dashboard, un
// import circular). Si algún día se agrega/saca una sección, hay que
// actualizar las dos listas.
const SECTION_SHORTCUTS = [
  { id: 'overlay', label: 'Overlays', icon: '🖥️', hint: 'URLs para pegar en OBS', free: true },
  { id: 'color', label: 'ColorDice', icon: '🎲', hint: 'Dados y colores', free: true },
  { id: 'downloader', label: 'Downloader', icon: '⬇️', hint: 'Descarga videos sin marca de agua', free: false },
  { id: 'theme', label: 'Tema', icon: '🎨', hint: 'Cambia el skin del panel', free: true },
  { id: 'membership', label: 'Membresía', icon: '💳', hint: 'Planes y precios', free: true },
];

const EVENT_SHORTCUTS = [
  { id: 'king', label: 'Rey del Trono', icon: '👑' },
  { id: 'zub', label: 'Zubastinis', icon: '🏆' },
  { id: 'elim', label: 'Eliminación', icon: '💀' },
  { id: 'roulette', label: 'Ruleta', icon: '🎡' },
  { id: 'extensible', label: 'Extensible', icon: '⏱️' },
  { id: 'spotify', label: 'Spotify', icon: '🎵' },
  { id: 'alerts', label: 'Alertas', icon: '🔔' },
  { id: 'tts', label: 'TTS (BETA)', icon: '🔊' },
];

function ShortcutCard({ icon, label, hint, onClick, locked }) {
  return (
    <button
      onClick={onClick}
      className="theme-surface p-4 flex flex-col items-start gap-1 text-left hover:opacity-90 transition-opacity relative"
    >
      {locked && <span className="absolute top-3 right-3 text-xs">🔒</span>}
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-sm font-black text-white mt-1">{label}</span>
      {hint && <span className="text-[10px] text-gray-500 leading-snug">{hint}</span>}
    </button>
  );
}

// Página principal (pedido explícito: "una página con shortcuts") -- punto
// de entrada por default con sesión (ver sectionFromPath en App.jsx). Sin
// sesión muestra una versión reducida: bienvenida + los shortcuts que de
// todos modos son de acceso libre (Overlays/ColorDice/Tema/Membresía), el
// resto queda con el candado 🔒 -- clickearlos igual navega a esa sección,
// que ya sabe mostrar su propio login embebido (mismo comportamiento que
// clickear esos botones desde la sidebar).
export default function Dashboard({ session, connectionStatus, username, anyGameActive, ttsEnabled, ttsLocked, onToggleTts, onGoSection, onGoEventTab }) {
  const connected = connectionStatus === 'connected';
  const daysLeft = session?.expiresAt
    ? Math.ceil((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <div className="w-full max-w-4xl flex flex-col gap-1">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🏠 Dashboard</p>
        <h1 className="theme-heading text-2xl font-black">
          {session ? `Hola, @${session.username}` : 'Bienvenido a BenjaApis'}
        </h1>
        <p className="text-xs text-gray-500">
          {session
            ? 'Accesos directos a todo tu panel -- lo que más uses, a un clic.'
            : 'Inicia sesión o prueba gratis para desbloquear todo el panel.'}
        </p>
      </div>

      {/* Resumen en vivo -- pedido explícito de shortcuts tipo "activar/
          desactivar el TTS desde ahí". */}
      {session && (
        <div className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="theme-surface p-4 flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Conexión a TikTok</p>
            <p className="text-sm font-black">
              {connected ? `🟢 @${username || '—'} en vivo` : username ? '🟡 Conectando...' : '⚪ Sin conectar'}
            </p>
            {anyGameActive && <p className="text-[10px] text-amber-500 font-bold mt-1">Hay un juego activo ahora mismo</p>}
          </div>

          <div className="theme-surface p-4 flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">TTS del chat</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black">{ttsEnabled ? '🔊 Activado' : '🔇 Apagado'}</span>
              <button
                type="button"
                onClick={onToggleTts}
                disabled={ttsLocked || (!ttsEnabled && !connected)}
                title={!connected && !ttsEnabled ? 'Necesitas estar conectado a un LIVE para activarlo' : ''}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${ttsEnabled ? 'bg-red-950/70 border border-red-700/60 text-red-300' : 'theme-btn-primary'}`}
              >
                {ttsEnabled ? 'Apagar' : 'Prender'}
              </button>
            </div>
          </div>

          <div className="theme-surface p-4 flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Tu plan</p>
            <p className="text-sm font-black capitalize">{session.licenseType === 'trial' ? 'Prueba gratis' : session.licenseType || '—'}</p>
            {daysLeft !== null && (
              <p className={`text-[10px] font-bold ${daysLeft <= 3 ? 'text-red-400' : 'text-gray-500'}`}>
                {daysLeft <= 0 ? 'Vence hoy' : `Vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}
              </p>
            )}
            <button onClick={() => onGoSection('membership')} className="text-[10px] font-bold text-sky-400 hover:text-sky-300 underline mt-1 text-left">
              Ver planes
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl">
        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Secciones</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {SECTION_SHORTCUTS.map((s) => (
            <ShortcutCard
              key={s.id} icon={s.icon} label={s.label} hint={s.hint}
              locked={!session && !s.free}
              onClick={() => onGoSection(s.id)}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-4xl">
        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">TikTokEvents</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {EVENT_SHORTCUTS.map((t) => (
            <ShortcutCard
              key={t.id} icon={t.icon} label={t.label}
              locked={!session}
              onClick={() => onGoEventTab(t.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
