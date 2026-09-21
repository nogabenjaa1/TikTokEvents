import { useEffect, useMemo, useState } from 'react';
import iconFollow from './assets/alert-follow.png';
import iconSticker from './assets/alert-sticker.png';
import {
  FEED_FILTERS, BIG_GIFT_COINS, feedCounts, filterFeed, feedCoins, relativeTime, feedDescription,
} from './feedLogic';

// El "ahora" para los tiempos relativos ("hace 5 s"): se refresca cada pocos
// segundos, no con cada evento.
function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// El ícono de la fila: la imagen del regalo, o el de seguidor / sticker. Si la
// imagen de TikTok no carga, se muestra 🎁 en su lugar.
function FeedIcon({ item }) {
  const [failed, setFailed] = useState(false);
  let content;
  if (item.type === 'follow') content = <img src={iconFollow} alt="" className="w-7 h-7 object-contain" />;
  else if (item.type === 'sticker') content = <img src={iconSticker} alt="" className="w-7 h-7 object-contain" />;
  else if (item.icon && !failed) content = <img src={item.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="w-8 h-8 object-contain" />;
  else content = <span className="text-xl leading-none" aria-hidden="true">🎁</span>;
  return (
    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)' }}>
      {content}
    </div>
  );
}

// Cuántos, cuántas monedas y hace cuánto. En pantallas anchas va a la derecha
// de la fila; en angostas baja debajo del texto para no quitarle ancho al nombre.
function FeedMeta({ item, now, compact }) {
  return (
    <>
      {item.type === 'gift' && (
        <span className="text-white font-black px-2 py-0.5 rounded-full text-[11px] flex-shrink-0" style={{ background: 'color-mix(in oklch, var(--accent) 30%, transparent)' }} title={`${item.count} ${item.count === 1 ? 'regalo' : 'regalos'} en la racha`}>
          ×{item.count}
        </span>
      )}
      {item.type === 'gift' && item.coins > 0 && (
        <span className="text-white text-[11px] font-bold flex-shrink-0 whitespace-nowrap">{item.coins.toLocaleString('es-MX')} 🪙</span>
      )}
      <time className={`text-[10px] text-gray-500 whitespace-nowrap flex-shrink-0 ${compact ? '' : 'w-16 text-right'}`} dateTime={new Date(item.at).toISOString()}>
        {relativeTime(item.at, now)}
      </time>
    </>
  );
}

function FeedRow({ item, now }) {
  const { who, action, what } = feedDescription(item);
  const big = item.type === 'gift' && item.coins >= BIG_GIFT_COINS;
  return (
    <li className={`tkc-feed-in theme-input flex items-center gap-3 px-3 py-2 ${big ? 'ring-2 ring-[var(--accent)]' : ''}`}>
      <FeedIcon item={item} />
      <div className="min-w-0 flex-1">
        {/* El nombre se recorta si es larguísimo, y "envió X" pasa a la línea de abajo: lo importante nunca queda fuera de la vista. */}
        <p className="text-sm leading-snug flex flex-wrap items-baseline gap-x-1.5">
          <strong className="font-black truncate max-w-full">{who}</strong>
          <span className="text-gray-400">{action}</span>
          {what && <strong className="font-black theme-accent-text break-words max-w-full">{what}</strong>}
        </p>
        {item.nickname && item.nickname !== item.username && <p className="text-[10px] text-gray-500 truncate">@{item.username}</p>}
        <div className="flex items-center gap-2 mt-1 sm:hidden"><FeedMeta item={item} now={now} compact /></div>
      </div>
      <div className="hidden sm:flex items-center gap-3 flex-shrink-0"><FeedMeta item={item} now={now} /></div>
    </li>
  );
}

// Actividad en vivo (Dashboard): lo último que pasó en el directo, con lo más
// reciente arriba. No es un overlay: solo lo ve el streamer, y no lleva sonido.
export default function LiveFeed({ feed, connected }) {
  const now = useNow();
  const [filter, setFilter] = useState('all');
  // "Limpiar" esconde lo anterior a este momento; lo nuevo sigue llegando.
  const [clearedAt, setClearedAt] = useState(0);

  const visibleBase = useMemo(() => feed.filter((item) => item.at > clearedAt), [feed, clearedAt]);
  const counts = useMemo(() => feedCounts(visibleBase), [visibleBase]);
  const coins = useMemo(() => feedCoins(visibleBase), [visibleBase]);
  const rows = useMemo(() => filterFeed(visibleBase, filter), [visibleBase, filter]);

  return (
    <section className="w-full max-w-4xl theme-surface p-4 flex flex-col gap-3" aria-labelledby="live-feed-title">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <h2 id="live-feed-title" className="theme-heading text-lg font-black">Actividad en vivo</h2>
          <span role="status" className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} aria-hidden="true" />
            {connected ? 'Recibiendo' : 'Sin conexión'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-500">
            {visibleBase.length} {visibleBase.length === 1 ? 'evento' : 'eventos'}{coins > 0 ? ` · ${coins.toLocaleString('es-MX')} 🪙` : ''}
          </span>
          {visibleBase.length > 0 && (
            <button type="button" onClick={() => setClearedAt(Date.now())} className="text-[10px] font-bold text-gray-400 hover:text-white underline py-2">
              Limpiar
            </button>
          )}
        </div>
      </div>

      <div role="group" aria-label="Filtrar la actividad" className="flex flex-wrap gap-1.5">
        {FEED_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full font-black uppercase tracking-widest border transition-colors theme-btn-sm ${filter === f.id ? 'theme-btn-primary border-transparent' : 'text-white border-[var(--surface-border-color)] hover:border-[var(--accent)]'}`}
            style={filter === f.id ? undefined : { background: 'color-mix(in oklch, var(--accent) 12%, transparent)' }}
          >
            {f.label} <span>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="theme-input px-4 py-8 text-center">
          <p className="text-2xl mb-1" aria-hidden="true">📡</p>
          <p className="text-sm font-bold">
            {visibleBase.length > 0 ? 'No hay nada de este tipo todavía.' : connected ? 'Esperando actividad…' : 'Aquí verás lo que pase en tu directo.'}
          </p>
          <p className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto leading-snug">
            {connected
              ? 'Los regalos, los seguidores nuevos y los stickers del club de fans aparecen aquí en cuanto llegan, con lo más reciente arriba.'
              : 'Conecta tu cuenta de TikTok y empieza tu LIVE: cada regalo (con su imagen y cuántos), seguidor y sticker se irá mostrando aquí.'}
          </p>
        </div>
      ) : (
        <ul aria-label="Últimos eventos del directo" tabIndex={0} className="flex flex-col gap-2 max-h-[24rem] overflow-y-auto pr-1">
          {rows.map((item) => <FeedRow key={item.id} item={item} now={now} />)}
        </ul>
      )}
    </section>
  );
}
