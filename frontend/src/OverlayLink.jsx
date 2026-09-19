import React, { useState } from 'react';
import { buildOverlayUrl } from './auth';
import OverlayCustomizePanel from './OverlayCustomizePanel';
import { OVERLAY_CUSTOMIZE_LABELS } from './overlayCustomization';

// La URL lleva la clave de licencia -- si el streamer comparte pantalla o
// hace directo con este panel a la vista, mostrarla completa filtra su
// clave. Por eso se muestra oculta por defecto ("Mostrar" la revela); copiar
// y abrir la vista previa siempre usan la URL real.
function maskOverlayUrl(url) {
  return url.replace(/(key=)[^&#]+/i, '$1••••••••••••');
}

function OverlayUrlCard({ title, description, dimensions, url, onReset, resetLabel, resetConfirm, onCustomize }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: se muestra la URL para copiarla a mano.
      setRevealed(true);
      setCopyFailed(true);
    }
  };

  const handleReset = () => {
    if (!onReset) return;
    if (resetConfirm && !window.confirm(resetConfirm)) return;
    onReset();
  };

  return (
    <div className="theme-surface w-full max-w-xl p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="theme-heading text-lg font-bold">{title}</h2>
        {onCustomize && (
          <button onClick={onCustomize} className="theme-btn-secondary px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex-shrink-0 whitespace-nowrap">
            🎨 Personalizar
          </button>
        )}
      </div>
      <p className="text-gray-400 text-xs mb-2">{description}</p>
      {/* Pedido explícito: el tamaño exacto de la fuente de navegador tiene
          que verse en CADA tarjeta, no solo en el cuadro de ayuda genérico
          de más abajo. */}
      {dimensions && (
        <p className="mb-3">
          <span className="theme-chip inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full" title="Tamaño exacto que debes poner en la fuente de navegador de OBS">📐 Tamaño en OBS: {dimensions}</span>
        </p>
      )}

      {!url ? (
        <p role="alert" className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">
          No pudimos recuperar tu clave de licencia de esta sesión. Cierra sesión y vuelve a entrar con tu clave para generar el enlace.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1">
            <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{revealed ? url : maskOverlayUrl(url)}</code>
            <button type="button" onClick={() => setRevealed((r) => !r)} className="theme-btn-secondary px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex-shrink-0" aria-pressed={revealed}>
              {revealed ? '🙈 Ocultar' : '👁️ Mostrar'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            {copyFailed ? 'No pudimos copiar automáticamente: selecciona la URL de arriba y cópiala a mano.' : 'La URL incluye tu clave de licencia, por eso se muestra oculta. "Copiar URL" copia la completa.'}
          </p>
          <div className="flex gap-3">
            <button onClick={copyUrl} className="theme-btn-primary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest">
              {copied ? '✅ Copiado' : '📋 Copiar URL'}
            </button>
            {/* Enlace real (no window.open): un <a target="_blank"> nunca lo
                bloquea un bloqueador de ventanas emergentes, a diferencia de
                una ventana abierta por script. */}
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="theme-btn-secondary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-center">
              👁️ Vista previa
            </a>
          </div>
          {onReset && (
            <button onClick={handleReset} className="mt-3 w-full px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 border border-red-900/50 hover:bg-red-950/30 transition-colors">
              {resetLabel || 'Reiniciar ranking'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Diagnóstico de Tap-Tap (pedido explícito, reporte de bug: "solo registra
// 1-2 usuarios de forma intermitente") — muestra cuántos 'like' CRUDOS llegó
// a recibir el servidor de TikTok, sin importar si terminaron en el
// ranking, para que el streamer pueda distinguir en el momento si el
// problema es que TikTok/la conexión no está mandando eventos de más
// gente (acá se vería un número bajo, o que no sube) o si los recibimos
// pero no llegan a asentarse (acá el total sí sube pero el ranking del
// overlay no refleja tantos usuarios).
function TapTapDiagnosticsBox({ diagnostics }) {
  const d = diagnostics || {};
  const fmt = (ts) => ts ? new Date(ts).toLocaleTimeString() : '—';
  return (
    // El redondeo de este recuadro (y de cualquier otra caja con `theme-input`)
    // lo modera el propio tema Cute (ver --radius-cute-box en index.css): ya no
    // hace falta pisar el radio a mano acá.
    <div className="theme-input w-full max-w-xl p-4 -mt-2 text-xs">
      <p className="text-[10px] uppercase tracking-widest font-black text-gray-400 mb-2">🩺 Diagnóstico (likes crudos recibidos de TikTok)</p>
      <div className="grid grid-cols-2 gap-2 text-gray-300">
        <p>Total recibidos: <span className="font-black text-white">{d.totalReceived ?? 0}</span></p>
        <p>Asentados al ranking: <span className="font-black text-white">{d.totalSettled ?? 0}</span></p>
        <p>Usuarios distintos: <span className="font-black text-white">{d.distinctUserCount ?? 0}</span></p>
        <p>Último recibido: <span className="font-black text-white">{fmt(d.lastEventAt)}</span></p>
      </div>
      {d.lastEventUsername && (
        <p className="text-gray-500 mt-1">Último usuario: @{d.lastEventUsername}</p>
      )}
      <p className="text-gray-600 mt-2 leading-snug">Si este número no sube aunque veas gente tocando la pantalla en tu directo, el problema es que TikTok no está mandando esos eventos (no depende de este panel). Si sube pero "usuarios distintos" queda bajo, avísanos con este dato.</p>
    </div>
  );
}

const INTRO_KEY = 'tkc_overlay_intro_closed';

// Guía corta para quien nunca agregó una fuente de navegador -- abierta por
// defecto; si el streamer la cierra, recuerda que la cerró.
function OverlayIntro() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(INTRO_KEY) !== '1'; } catch { return true; }
  });
  const onToggle = (e) => {
    const nowOpen = e.currentTarget.open;
    setOpen(nowOpen);
    try { localStorage.setItem(INTRO_KEY, nowOpen ? '0' : '1'); } catch { /* sin storage */ }
  };
  return (
    <details open={open} onToggle={onToggle} className="theme-surface-featured w-full max-w-xl p-5">
      <summary className="cursor-pointer text-sm font-black theme-heading">🚀 ¿Primera vez? Así agregas un overlay a tu stream</summary>
      <ol className="mt-3 text-xs text-gray-400 space-y-2 list-decimal list-inside">
        <li><span className="font-bold text-white">Copia la URL</span> del overlay que quieras con el botón "Copiar URL".</li>
        <li>En <span className="font-bold text-white">OBS</span> (o TikTok LIVE Studio) agrega una fuente nueva de tipo <span className="font-bold text-white">Navegador</span>.</li>
        <li><span className="font-bold text-white">Pega la URL</span> y escribe el ancho y el alto que indica la tarjeta (📐).</li>
        <li>Personaliza cómo se ve con <span className="font-bold text-white">🎨 Personalizar</span>: los cambios se aplican solos, sin volver a pegar nada.</li>
      </ol>
    </details>
  );
}

// Sub-navegación del panel de Overlays — mismo patrón visual que EVENT_TABS
// de App.jsx (fila horizontal de pestañas), pedido explícito para que la
// vitrina de enlaces deje de ser una sola página larga y quede agrupada por
// tipo de overlay.
const OVERLAY_TABS = [
  { id: 'events', label: 'Eventos de TikTok', icon: '🎉' },
  { id: 'alerts', label: 'Alertas', icon: '🔔' },
  { id: 'tops', label: 'Tops', icon: '🏆' },
  { id: 'playlist', label: 'Playlist y Extensible', icon: '🎵' },
  { id: 'goalchat', label: 'Objetivo y Chat', icon: '🎯' },
];

const OBS_HELP = {
  events: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Agrega una fuente de tipo Navegador (OBS) o Web/Navegador (TikTok LIVE Studio).',
      'Pega la URL de "juegos" para Rey del Trono/Zubastinis/Eliminación/Ruleta, o la de "Colores" para Color Says — cada una en su propia fuente.',
      'Tamaño exacto: 380×700 para el overlay de juegos (vertical); para Colores, 960×260 (es horizontal).',
    ],
  },
  alerts: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Agrega UNA fuente de Navegador con la URL de Alertas — cubre TODA tu escena (1920×1080), ya que cada alerta decide sola en qué parte de la pantalla aparece según la posición que le configuraste.',
      'Configúrala como fondo transparente, sin bordes — la alerta solo ocupa espacio mientras está sonando/mostrándose.',
    ],
  },
  tops: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Agrega una fuente de Navegador por cada widget que quieras mostrar (Top Tap-Tap, Top Gifter, o ambos).',
      'Tamaño exacto: 380×700 — igual que los demás overlays verticales.',
    ],
  },
  playlist: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Modo Extensible: 960×260 (es horizontal).',
      'Cola de Spotify: 380×700 (igual que los demás overlays verticales) — necesita tu cuenta de Spotify conectada desde la pestaña Spotify en TikTokEvents.',
    ],
  },
  goalchat: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Objetivo: 960×260 (es horizontal) — inícialo y ajústalo desde su propia pestaña en TikTokEvents.',
      'Chat en vivo + espectadores: 380×700 (igual que los demás overlays verticales) — no necesita configuración aparte, muestra el chat y el contador de espectadores apenas te conectes a un LIVE.',
    ],
  },
};

// Pantalla de ayuda para obtener las URLs de overlay (?overlay=true&key=...)
// y pegarlas como fuente de navegador en OBS/TikTok LIVE Studio. La key ya
// viene incluida (ver auth.buildOverlayUrl) — nunca se pide de nuevo acá.
export default function OverlayLink({ socket, tapTapState, tapTapDiagnostics, gifterState, spotifyQueueState, extensibleState, diceState, goalState, viewerCount, overlayCustomization, onCustomizeChange, onApplyToAll }) {
  const [tab, setTab] = useState('events');
  // Id del overlay que tiene abierto el modal de "Personalizar" ahora mismo
  // (uno de OVERLAY_CUSTOMIZE_IDS), o null si está cerrado.
  const [customizingId, setCustomizingId] = useState(null);

  const gamesUrl = buildOverlayUrl('games');
  const colorsUrl = buildOverlayUrl('colors');
  const alertsUrl = buildOverlayUrl('alerts');
  const tapTapUrl = buildOverlayUrl('taptap');
  const gifterUrl = buildOverlayUrl('gifter');
  const extensibleUrl = buildOverlayUrl('extensible');
  const musicQueueUrl = buildOverlayUrl('musicqueue');
  const goalUrl = buildOverlayUrl('goal');
  const chatUrl = buildOverlayUrl('chat');

  const tapTapCount = (tapTapState?.leaderboard || []).length;
  const gifterCount = (gifterState?.leaderboard || []).length;
  const musicQueueCount = (spotifyQueueState?.queue || []).length;

  const help = OBS_HELP[tab];

  // Le pide a TODAS las ventanas de overlay abiertas (OBS, TikTok LIVE
  // Studio, o una pestaña de preview) que recarguen — pensado para cuando
  // hace falta que tomen un cambio nuevo sin sacar y volver a poner la
  // fuente de navegador a mano. A propósito NO es un "reiniciar" (no borra
  // ningún ranking/cola/estado, ver processGiftGifterBoard etc en
  // tenant.js) — solo una recarga de página, por eso el confirm es más
  // liviano que el de los botones "Reiniciar ranking" de abajo.
  const refreshOverlays = () => {
    if (!window.confirm('¿Refrescar todos los overlays abiertos (OBS, TikTok LIVE Studio, previews)? Van a recargar la página por un instante.')) return;
    socket?.emit('refresh_overlays');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Misma fila horizontal scrolleable que EVENT_TABS en App.jsx — el
          botón de refresco YA NO vive acá (ver más abajo), en su propia
          franja aparte. */}
      <nav aria-label="Tipos de overlay" className="flex flex-row items-center gap-2 w-full px-3 py-3 overflow-x-auto flex-shrink-0 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
        {OVERLAY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={[
              'theme-nav-btn h-9 px-4 rounded-full border flex items-center gap-2 transition-all duration-200 flex-shrink-0',
              tab === t.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-base leading-none" aria-hidden="true">{t.icon}</span>
            <span className={['text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', tab === t.id ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
              {t.label}
            </span>
          </button>
        ))}
      </nav>

      {/* Franja propia, en el flujo normal del contenido (no fixed, no
          pegada a ningún borde de la ventana) — a propósito lejos de la
          banda superior donde flota la barra/botón "Off" de TikTok. */}
      <div className="flex justify-center px-6 pt-4 flex-shrink-0">
        <button
          onClick={refreshOverlays}
          title="Recarga todas las ventanas de overlay abiertas — no borra ningún ranking ni estado"
          className="theme-btn-secondary w-full max-w-xl h-10 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2"
        >
          🔄 Refrescar overlays
        </button>
      </div>

      <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-4 font-sans flex-1 overflow-y-auto">
        <OverlayIntro />

        {tab === 'events' && (
          <>
            <OverlayUrlCard
              title="Overlay de juegos (Rey del Trono / Zubastinis / Eliminación / Ruleta)"
              description="Úsalo para estos cuatro modos. Ya incluye tu clave de licencia — es personal, no la compartas con nadie."
              dimensions="380×700 px (vertical)"
              url={gamesUrl}
              onCustomize={() => setCustomizingId('games')}
            />
            <OverlayUrlCard
              title="Overlay de Colores (dados)"
              description="Overlay horizontal aparte, exclusivo para Color Says — no sirve para los otros modos."
              dimensions="960×260 px (horizontal)"
              url={colorsUrl}
              onCustomize={() => setCustomizingId('colors')}
            />
          </>
        )}

        {/* Pedido explicito: el panel de configuración (qué recurso va en
            cada disparador, editar, probar, etc.) se mudó a TikTokEvents
            (ver App.jsx) — acá queda solo la URL para pegar en OBS. */}
        {tab === 'alerts' && (
          <OverlayUrlCard
            title="Overlay de Alertas"
            description="Una sola URL para todas tus alertas — cada una aparece en la posición que le configures desde la pestaña Alertas, en TikTokEvents. Pégala como una fuente que cubra toda tu escena."
            dimensions="1920×1080 px (toda la escena)"
            url={alertsUrl}
          />
        )}

        {tab === 'tops' && (
          <>
            <OverlayUrlCard
              title="Top Tap-Tap (ranking de likes)"
              description={`Widget angosto aparte con quién más likes mandó en el directo${tapTapCount ? ` — ${tapTapCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
              dimensions="380×700 px (vertical)"
              url={tapTapUrl}
              onReset={() => socket?.emit('reset_taptap_leaderboard')}
              resetLabel="🗑️ Reiniciar ranking de likes"
              resetConfirm="¿Reiniciar el ranking de Top Tap-Tap? Se borra todo lo acumulado hasta ahora."
              onCustomize={() => setCustomizingId('taptap')}
            />
            <TapTapDiagnosticsBox diagnostics={tapTapDiagnostics} />
            <OverlayUrlCard
              title="Top Gifter (ranking de regalos)"
              description={`Widget angosto aparte con quién más regaló en el directo${gifterCount ? ` — ${gifterCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
              dimensions="380×700 px (vertical)"
              url={gifterUrl}
              onReset={() => socket?.emit('reset_gifter_leaderboard')}
              resetLabel="🗑️ Reiniciar ranking de regalos"
              resetConfirm="¿Reiniciar el ranking de Top Gifter? Se borra todo lo acumulado hasta ahora."
              onCustomize={() => setCustomizingId('gifter')}
            />
          </>
        )}

        {tab === 'playlist' && (
          <>
            <OverlayUrlCard
              title="Modo Extensible (contador que crece con follows/regalos)"
              description="Overlay horizontal aparte, pensado como franja tipo subathon — inícialo y ajústalo desde su propia pestaña en TikTokEvents."
              dimensions="960×260 px (horizontal)"
              url={extensibleUrl}
              onCustomize={() => setCustomizingId('extensible')}
            />
            <OverlayUrlCard
              title="Cola de Spotify (canciones pedidas con !play)"
              description={`Widget angosto aparte con las próximas canciones pedidas por chat${musicQueueCount ? ` — ${musicQueueCount} en la cola ahora` : ''}. Conecta tu cuenta de Spotify desde la pestaña Spotify en TikTokEvents para que funcione.`}
              dimensions="380×700 px (vertical)"
              url={musicQueueUrl}
              onReset={() => socket?.emit('clear_spotify_queue')}
              resetLabel="🗑️ Vaciar cola de canciones"
              resetConfirm="¿Vaciar la cola de Spotify pedida por chat? Esto no afecta la reproducción real en Spotify, solo lo que se muestra acá."
              onCustomize={() => setCustomizingId('musicqueue')}
            />
          </>
        )}

        {tab === 'goalchat' && (
          <>
            <OverlayUrlCard
              title="Objetivo (meta de regalos o de seguidores)"
              description={`Overlay horizontal aparte, con una barra de progreso${goalState?.isActive ? ` — ${(goalState.current || 0).toLocaleString('es-MX')} / ${(goalState.target || 0).toLocaleString('es-MX')} ahora` : ''}. Inícialo y ajústalo desde su propia pestaña en TikTokEvents.`}
              dimensions="960×260 px (horizontal)"
              url={goalUrl}
              onCustomize={() => setCustomizingId('goal')}
            />
            <OverlayUrlCard
              title="Chat en vivo + espectadores"
              description={`Widget angosto aparte con el chat en vivo y el contador de espectadores${typeof viewerCount === 'number' && viewerCount > 0 ? ` — ${viewerCount.toLocaleString('es-MX')} viendo ahora` : ''}. No necesita configuración: se activa solo apenas te conectes a un LIVE.`}
              dimensions="380×700 px (vertical)"
              url={chatUrl}
              onCustomize={() => setCustomizingId('chat')}
            />
          </>
        )}

        {help && (
          <div className="theme-surface w-full max-w-xl p-6 text-xs text-gray-400 space-y-2">
            <h3 className="theme-heading text-sm font-bold mb-2">Paso a paso — {help.title}</h3>
            <ol className="list-decimal list-inside space-y-1">
              {help.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        )}
      </div>

      {customizingId && (
        <OverlayCustomizePanel
          title={OVERLAY_CUSTOMIZE_LABELS[customizingId]}
          overlayId={customizingId}
          entry={overlayCustomization?.[customizingId]}
          onChange={(entry) => onCustomizeChange?.(customizingId, entry)}
          onApplyToAll={() => onApplyToAll?.(customizingId)}
          onClose={() => setCustomizingId(null)}
          // Colores y Extensible NO dependen de una conexión en vivo a
          // TikTok (el streamer los controla 100% desde su propio panel) —
          // pedido explícito: mostrar en la vista previa el estado REAL
          // actual (el dado que ya tiraron, los segundos por follow/regalo
          // que ya configuraron) en vez de datos inventados. El resto de
          // los overlays SÍ dependen del LIVE, así que siguen usando
          // espectadores de prueba (ver overlayPreviewMocks.js).
          liveState={customizingId === 'extensible' ? extensibleState : customizingId === 'colors' ? diceState : customizingId === 'goal' ? goalState : null}
        />
      )}
    </div>
  );
}
