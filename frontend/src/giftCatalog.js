// Regalos que llegan en el directo, sumados a la lista de TikTok.
//
// La lista de regalos que TikTok entrega viene incompleta (le faltan algunos,
// como "Super GG") y no se pueden inventar regalos: el catálogo es SOLO lo que
// TikTok devuelve. Pero un regalo que llega en un evento existe sí o sí, así que
// se muestra en los selectores en cuanto llega (el servidor lo avisa con
// gift_seen) y además queda guardado allá con su id e ícono, para que el
// siguiente directo ya lo traiga en la lista (ver lib/giftDirectoryCore.js).

// Sin mayúsculas, acentos ni espacios de más: "Súper  GG" y "super gg" son el mismo.
export function giftKey(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Agrega un regalo recibido a los ya vistos en esta sesión, sin repetirlo por
// nombre. Si ya estaba pero sin ícono o sin monedas y ahora llegan, se completa.
// Devuelve la lista nueva, o la MISMA si no cambió nada (para no repintar).
export function addSeenGift(list, gift) {
  const name = String(gift?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return list;
  const coins = Math.trunc(Number(gift?.coins));
  const clean = {
    id: gift?.id ?? null,
    name,
    coins: Number.isFinite(coins) && coins >= 0 ? coins : 0,
    icon: typeof gift?.icon === 'string' ? gift.icon : '',
  };
  const key = giftKey(name);
  const index = list.findIndex((g) => giftKey(g.name) === key);
  if (index === -1) return [...list, clean];
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

// Une la lista de TikTok con los regalos vistos. Con la lista de TikTok todavía
// vacía (sin LIVE) no agrega nada: los selectores siguen pidiendo conectarse, y
// los juegos no preseleccionan un regalo suelto. El primer elemento (el
// "Ninguno" del Insta-Win) se queda primero; el resto va por monedas y nombre.
export function mergeCatalog(base, seen) {
  if (!Array.isArray(base) || base.length === 0) return base;
  const present = new Set(base.map((g) => giftKey(g.name)));
  const missing = seen.filter((g) => !present.has(giftKey(g.name)));
  if (missing.length === 0) return base;
  const [first, ...rest] = base;
  const byCoinsThenName = (a, b) => (a.coins || 0) - (b.coins || 0) || String(a.name).localeCompare(String(b.name));
  return [first, ...[...rest, ...missing].sort(byCoinsThenName)];
}
