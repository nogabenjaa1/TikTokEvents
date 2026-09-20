// Funciones puras del feed de actividad en vivo del Dashboard (sin React), para
// poder probarlas. El servidor manda cada evento (regalo, seguidor, sticker) por
// el socket; ver backend/lib/tenant/feed.js.

export const FEED_MAX = 50;

export const FEED_FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'gift', label: 'Regalos' },
  { id: 'follow', label: 'Seguidores' },
  { id: 'sticker', label: 'Stickers' },
];

// Un regalo de al menos estas monedas se destaca en la lista.
export const BIG_GIFT_COINS = 500;

// Agrega un evento al principio (lo más reciente va primero), sin repetir el
// mismo id (el servidor puede reenviar lo que ya vino en el resumen) y solo con
// los últimos FEED_MAX.
export function addFeedItem(list, item, max = FEED_MAX) {
  if (!item || item.id == null) return list;
  if (list.some((existing) => existing.id === item.id)) return list;
  return [item, ...list].slice(0, max);
}

// Cuántos hay de cada tipo, para las etiquetas de los filtros.
export function feedCounts(list) {
  const counts = { all: list.length, gift: 0, follow: 0, sticker: 0 };
  for (const item of list) if (item.type in counts) counts[item.type] += 1;
  return counts;
}

export function filterFeed(list, filter) {
  return filter === 'all' ? list : list.filter((item) => item.type === filter);
}

// Monedas que llevan los regalos de la lista (para el resumen de arriba).
export function feedCoins(list) {
  return list.reduce((sum, item) => sum + (item.type === 'gift' ? item.coins || 0 : 0), 0);
}

// "ahora", "hace 5 s", "hace 3 min", "hace 2 h". Nunca negativo.
export function relativeTime(at, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

// Lo que dice cada fila: quién y qué hizo. `nickname` es el nombre público (puede
// traer espacios o emojis); `username` es el @ de TikTok.
export function feedDescription(item) {
  const who = item.nickname || item.username;
  if (item.type === 'gift') return { who, action: 'envió', what: item.giftName || 'un regalo' };
  if (item.type === 'follow') return { who, action: 'empezó a seguirte', what: '' };
  return { who, action: 'envió un sticker del club de fans', what: '' };
}
