// Regalos "extra" del navegador: los que la lista de TikTok no trae.
//
// La lista que TikTok entrega sin sesión está incompleta a propósito (viene
// marcada is_full_gift_data: false; por ejemplo no incluye "Super GG"), y ninguna
// consulta gratuita la completa. Por eso el catálogo se complementa con dos
// fuentes que sí son fiables:
//   - los regalos que llegan en el directo (el servidor los avisa con
//     gift_seen), que se recuerdan en este navegador para la próxima vez;
//   - los que el propio streamer escribe a mano en el selector.
// Todo queda en localStorage (por navegador) y se une a la lista de TikTok sin
// repetir nada.

const STORAGE_KEY = 'tkc_extra_gifts';
const MAX_EXTRA_GIFTS = 200;

// Sin mayúsculas, acentos ni espacios de más: "Súper  GG" y "super gg" son el mismo.
export function giftKey(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Un regalo escrito o recibido -> { id, name, coins, icon }, o null si no sirve.
export function cleanGift(gift) {
  const name = String(gift?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name.length < 2) return null;
  const coins = Math.trunc(Number(gift?.coins));
  return {
    id: gift?.id ?? null,
    name,
    coins: Number.isFinite(coins) && coins >= 0 ? Math.min(coins, 9_999_999) : 0,
    icon: typeof gift?.icon === 'string' ? gift.icon : '',
  };
}

export function loadExtraGifts(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    return (Array.isArray(parsed) ? parsed : []).map(cleanGift).filter(Boolean).slice(-MAX_EXTRA_GIFTS);
  } catch {
    return [];
  }
}

export function saveExtraGifts(list, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_EXTRA_GIFTS))); } catch { /* sin almacenamiento: dura solo esta sesión */ }
}

// Agrega un regalo a la lista de extras (sin repetir por nombre). Si ya estaba
// pero sin ícono o sin monedas y ahora llegan, se completa. Devuelve la lista
// nueva (o la misma si no cambió nada).
export function addExtraGift(list, gift) {
  const clean = cleanGift(gift);
  if (!clean) return list;
  const key = giftKey(clean.name);
  const index = list.findIndex((g) => giftKey(g.name) === key);
  if (index === -1) return [...list, clean].slice(-MAX_EXTRA_GIFTS);
  const current = list[index];
  const completed = {
    id: current.id ?? clean.id,
    name: current.name,
    coins: current.coins || clean.coins,
    icon: current.icon || clean.icon,
  };
  if (completed.id === current.id && completed.coins === current.coins && completed.icon === current.icon) return list;
  const next = [...list];
  next[index] = completed;
  return next;
}

// Busca un regalo por nombre (sin mayúsculas, acentos ni espacios de más).
// Sirve para que escribir a mano un regalo que YA está en el catálogo elija el
// real (con su id e ícono) en vez de crear una copia con lo que se tecleó.
export function findGiftByName(list, name) {
  const key = giftKey(name);
  if (!key) return null;
  return list.find((g) => giftKey(g.name) === key) || null;
}

// Une la lista de TikTok con los extras. Con la lista de TikTok todavía vacía
// (sin LIVE) no agrega nada: los selectores siguen pidiendo conectarse, y los
// juegos no preseleccionan un regalo suelto. El primer elemento (el "Ninguno"
// del Insta-Win) se queda primero; el resto va por monedas y nombre.
export function mergeCatalog(base, extras) {
  if (!Array.isArray(base) || base.length === 0) return base;
  const present = new Set(base.map((g) => giftKey(g.name)));
  const missing = extras.filter((g) => !present.has(giftKey(g.name)));
  if (missing.length === 0) return base;
  const [first, ...rest] = base;
  const byCoinsThenName = (a, b) => (a.coins || 0) - (b.coins || 0) || String(a.name).localeCompare(String(b.name));
  return [first, ...[...rest, ...missing].sort(byCoinsThenName)];
}
