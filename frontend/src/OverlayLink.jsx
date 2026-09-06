import React, { useState } from 'react';
import { buildOverlayUrl } from './auth';
import AlertsAdmin from './AlertsAdmin';
import OverlayCustomizePanel from './OverlayCustomizePanel';
import { OVERLAY_CUSTOMIZE_LABELS } from './overlayCustomization';

function OverlayUrlCard({ title, description, url, onReset, resetLabel, resetConfirm, onCustomize }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <p className="text-gray-500 text-xs mb-5">{description}</p>

      {!url ? (
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">
          No pudimos recuperar tu clave de licencia de esta sesión. Cierra sesión y vuelve a entrar con tu clave para generar el enlace.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{url}</code>
          </div>
          <div className="flex gap-3">
            <button onClick={copyUrl} className="theme-btn-primary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest">
              {copied ? '✅ Copiado' : 'Copiar URL'}
            </button>
            {/* Enlace real (no window.open): un <a target="_blank"> nunca lo
                bloquea un bloqueador de ventanas emergentes, a diferencia de
                una ventana abierta por script. */}
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="theme-btn-secondary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-center">
              👁️ Preview
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

// Sub-navegación del panel de Overlays — mismo patrón visual que EVENT_TABS
// de App.jsx (fila horizontal de pestañas), pedido explícito para que la
// vitrina de enlaces deje de ser una sola página larga y quede agrupada por
// tipo de overlay.
const OVERLAY_TABS = [
  { id: 'events', label: 'Eventos de TikTok', icon: '🎉' },
  { id: 'alerts', label: 'Alertas', icon: '🔔' },
  { id: 'tops', label: 'Tops', icon: '🏆' },
  { id: 'playlist', label: 'Playlist y Extensible', icon: '🎵' },
];

const OBS_HELP = {
  events: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Agrega una fuente de tipo Navegador (OBS) o Web/Navegador (TikTok LIVE Studio).',
      'Pega la URL de "juegos" para Rey del Trono/Zubastinis/Eliminación/Ruleta, o la de "Colores" para Color Says — cada una en su propia fuente.',
      'Tamaño recomendado: 1920×1080 para el overlay de juegos (vertical); para Colores, ancho de al menos 960px con menos alto (es horizontal).',
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
      'Ancho de ~400px alcanza — son widgets angostos de alto libre, se acomodan solos a la cantidad de gente en el ranking.',
    ],
  },
  playlist: {
    title: 'En OBS Studio / TikTok LIVE Studio',
    steps: [
      'Modo Extensible: ancho de al menos 960px, con menos alto (es horizontal).',
      'Cola de Spotify: ancho de ~400px alcanza (widget angosto, de alto libre) — necesita tu cuenta de Spotify conectada desde la pestaña Spotify en TikTokEvents.',
    ],
  },
};

// Pantalla de ayuda para obtener las URLs de overlay (?overlay=true&key=...)
// y pegarlas como fuente de navegador en OBS/TikTok LIVE Studio. La key ya
// viene incluida (ver auth.buildOverlayUrl) — nunca se pide de nuevo acá.
export default function OverlayLink({ socket, tapTapState, gifterState, spotifyQueueState, giftsList, overlayCustomization, onCustomizeChange, onApplyToAll }) {
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

  const tapTapCount = (tapTapState?.leaderboard || []).length;
  const gifterCount = (gifterState?.leaderboard || []).length;
  const musicQueueCount = (spotifyQueueState?.queue || []).length;

  const help = OBS_HELP[tab];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Misma fila horizontal scrolleable que EVENT_TABS en App.jsx. */}
      <div className="flex flex-row items-center gap-2 w-full px-3 py-3 overflow-x-auto flex-shrink-0 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
        {OVERLAY_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'theme-nav-btn h-9 px-4 rounded-full border flex items-center gap-2 transition-all duration-200 flex-shrink-0',
              tab === t.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-base leading-none">{t.icon}</span>
            <span className={['text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', tab === t.id ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
              {t.label}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
        {tab === 'events' && (
          <>
            <OverlayUrlCard
              title="Overlay de juegos (Rey del Trono / Zubastinis / Eliminación / Ruleta)"
              description="Úsalo para estos cuatro modos. Ya incluye tu clave de licencia — es personal, no la compartas con nadie."
              url={gamesUrl}
              onCustomize={() => setCustomizingId('games')}
            />
            <OverlayUrlCard
              title="Overlay de Colores (dados)"
              description="Overlay horizontal aparte, exclusivo para Color Says — no sirve para los otros modos."
              url={colorsUrl}
              onCustomize={() => setCustomizingId('colors')}
            />
          </>
        )}

        {tab === 'alerts' && (
          <>
            <OverlayUrlCard
              title="Overlay de Alertas"
              description="Una sola URL para todas tus alertas — cada una aparece en la posición que le configures abajo. Pégala como una fuente que cubra toda tu escena."
              url={alertsUrl}
            />
            <div className="w-full max-w-xl">
              <AlertsAdmin giftsList={giftsList} />
            </div>
          </>
        )}

        {tab === 'tops' && (
          <>
            <OverlayUrlCard
              title="Top Tap-Tap (ranking de likes)"
              description={`Widget angosto aparte con quién más likes mandó en el directo${tapTapCount ? ` — ${tapTapCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
              url={tapTapUrl}
              onReset={() => socket?.emit('reset_taptap_leaderboard')}
              resetLabel="🗑️ Reiniciar ranking de likes"
              resetConfirm="¿Reiniciar el ranking de Top Tap-Tap? Se borra todo lo acumulado hasta ahora."
              onCustomize={() => setCustomizingId('taptap')}
            />
            <OverlayUrlCard
              title="Top Gifter (ranking de regalos)"
              description={`Widget angosto aparte con quién más regaló en el directo${gifterCount ? ` — ${gifterCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
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
              url={extensibleUrl}
              onCustomize={() => setCustomizingId('extensible')}
            />
            <OverlayUrlCard
              title="Cola de Spotify (canciones pedidas con !play)"
              description={`Widget angosto aparte con las próximas canciones pedidas por chat${musicQueueCount ? ` — ${musicQueueCount} en la cola ahora` : ''}. Conecta tu cuenta de Spotify desde la pestaña Spotify en TikTokEvents para que funcione.`}
              url={musicQueueUrl}
              onReset={() => socket?.emit('clear_spotify_queue')}
              resetLabel="🗑️ Vaciar cola de canciones"
              resetConfirm="¿Vaciar la cola de Spotify pedida por chat? Esto no afecta la reproducción real en Spotify, solo lo que se muestra acá."
              onCustomize={() => setCustomizingId('musicqueue')}
            />
          </>
        )}

        {help && (
          <div className="theme-surface w-full max-w-xl p-6 text-xs text-gray-400 space-y-2">
            <h3 className="theme-heading text-sm font-bold mb-2">{help.title}</h3>
            <ol className="list-decimal list-inside space-y-1">
              {help.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        )}
      </div>

      {customizingId && (
        <OverlayCustomizePanel
          title={OVERLAY_CUSTOMIZE_LABELS[customizingId]}
          entry={overlayCustomization?.[customizingId]}
          onChange={(entry) => onCustomizeChange?.(customizingId, entry)}
          onApplyToAll={() => onApplyToAll?.(customizingId)}
          onClose={() => setCustomizingId(null)}
        />
      )}
    </div>
  );
}
