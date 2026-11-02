// Reglas del overlay de chat (overlays/ChatOverlay.jsx), sin React: los
// ajustes por defecto (los mismos que el servidor, ver
// backend/lib/chatOverlay.js) y qué mensajes se ven en un momento dado.

export const CHAT_DEFAULT_SETTINGS = {
  fadeSeconds: 30, newestOnTop: false, maxMessages: 12, fontSize: 24,
  showAvatars: true, showBadges: true, showFollows: true, showGifts: true, showShares: true, showSubscribes: true, showChests: true, showLevelUps: true, showPinned: true, showViewerCount: true,
};

// Tamaño del overlay: horizontal (con el ancho de los banners horizontales),
// 960 x 480, y vertical, 540 x 960, la medida que se recomienda para OBS
// vertical. Ver chatFrameSize.
export const CHAT_OVERLAY_SIZE = { w: 960, h: 480 };
export const CHAT_OVERLAY_SIZE_VERTICAL = { w: 540, h: 960 };

// El tamaño del overlay en OBS según la fuente de navegador. Antes medía
// siempre 960 x 480: en un lienzo vertical, OBS lo achicaba hasta que la letra
// no se leía. Ahora, en una fuente VERTICAL (más alta que ancha) ocupa toda la
// fuente. En una horizontal sigue midiendo 960 x 480 arriba a la izquierda,
// exactamente como antes: así no cambia nada para quien ya lo tiene puesto
// (por ejemplo, en una fuente de 1920 x 1080 usando solo esa esquina).
// Devuelve el tamaño fijo, o null para ocupar toda la fuente.
export function chatFrameSize(width, height) {
  return height > width ? null : CHAT_OVERLAY_SIZE;
}

// Lo que dura la animación de desvanecido, después de vencer el tiempo.
export const CHAT_FADE_OUT_MS = 700;

const KIND_SETTING = { follow: 'showFollows', gift: 'showGifts', share: 'showShares', subscribe: 'showSubscribes', chest: 'showChests', levelup: 'showLevelUps' };

// Lo que se ve ahora: filtra por tipo y por tiempo, y corta al máximo
// (quedan los más recientes). Lo vencido se queda mientras se desvanece.
export function visibleChatItems(items, settings, now) {
  const fadeMs = (settings.fadeSeconds || 0) * 1000;
  const shown = (items || []).filter((item) => {
    const setting = KIND_SETTING[item.kind];
    if (setting && settings[setting] === false) return false;
    return fadeMs <= 0 || now - (item.at || now) < fadeMs + CHAT_FADE_OUT_MS;
  });
  return shown.slice(-Math.max(1, settings.maxMessages || CHAT_DEFAULT_SETTINGS.maxMessages));
}

// Las insignias de un usuario como íconos, en un orden fijo: rol (moderador),
// membresía (club de fans, con su nivel), reconocimientos (top gifter,
// Superfan) y al final las imágenes de TikTok que no son ninguno de
// esos (`others`, ver badgesFrom en backend/lib/chatOverlay.js). Solo lo que
// TikTok manda: sin datos no hay insignia. Solo el club de fans lleva número
// (pedido explícito); el resto es solo el ícono, con su nombre para lectores
// de pantalla. Un mensaje de antes de `others` (solo `images`) muestra esas
// imágenes tal cual: no se sabe cuál es el moderador, y repetirlo sería peor.
export function chatBadgeIcons(badges) {
  if (!badges) return [];
  if (!Array.isArray(badges.others) && badges.images?.length) {
    return badges.images.map((url) => ({ kind: 'image', url, label: 'Insignia' }));
  }
  const icons = [];
  if (badges.moderator) icons.push({ kind: 'moderator', label: 'Moderador' });
  if (badges.fanLevel > 0) icons.push({ kind: 'member', level: badges.fanLevel, elite: isEliteFan(badges), label: `Miembro nivel ${badges.fanLevel}` });
  if (badges.topGifterRank) icons.push({ kind: 'topGifter', rank: badges.topGifterRank, label: `Top ${badges.topGifterRank} en regalos` });
  // El nivel de donador (gifterLevel) ya no se dibuja (pedido explícito), ni
  // se reemplaza por otra insignia; el dato se sigue recibiendo igual.
  // Superfan: así llama TikTok hoy a quien está suscrito.
  if (badges.subscriber) icons.push({ kind: 'subscriber', label: 'Superfan' });
  for (const url of badges.others || []) icons.push({ kind: 'image', url, label: 'Insignia' });
  return icons;
}

// Nivel del club de fans a partir del cual un miembro se destaca (pedido
// explícito: el 20 ya cuenta; el 19 no).
export const ELITE_FAN_LEVEL = 20;
const isEliteFan = (badges) => (badges?.fanLevel || 0) >= ELITE_FAN_LEVEL;

// Cómo se destaca el mensaje de alguien, con el borde que gira con brillo:
// 'elite' (club de fans de nivel 20 o más: rojo y rosa), 'superfan' (su
// propio borde violeta y dorado), 'both' (los dos colores en un solo borde, y
// las dos insignias se ven) o null. Cada condición basta sola.
export function chatHighlight(badges) {
  const elite = isEliteFan(badges);
  const superfan = Boolean(badges?.subscriber);
  if (elite && superfan) return 'both';
  if (elite) return 'elite';
  if (superfan) return 'superfan';
  return null;
}

// Monedas con separador de miles, o null si no se conoce el valor (el chat no
// muestra un 0 inventado).
export function formatCoins(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString('es-MX') : null;
}

// Destacado de una fila del chat (ver chatHighlight). Un mensaje de chat usa
// las insignias de quien escribe. Los eventos que celebran algo del club o de
// Superfan siempre llevan el borde, sin importar el nivel:
// - subida de nivel del club: el de nivel alto (combinado si es Superfan);
// - suscripción, renovación o "se hizo Superfan": el de Superfan (combinado
//   si además es de nivel 20 o más).
// Los demás eventos conservan su marca de color. Con las insignias apagadas,
// nada.
export function chatItemHighlight(item, settings = {}) {
  if (!item || settings.showBadges === false) return null;
  const badges = item.user?.badges;
  if (item.kind === 'chat') return chatHighlight(badges);
  if (item.kind === 'levelup') return badges?.subscriber ? 'both' : 'elite';
  if (item.kind === 'subscribe') return isEliteFan(badges) ? 'both' : 'superfan';
  return null;
}

// Lo que dice una subida de nivel del club de fans: solo el nivel al que llegó
// (pedido explícito: sin el anterior, aunque se conozca; ese solo se usa para
// no repetir una subida, ver handleFansLevelUp en el backend). Desde el 20,
// "alcanzó" (es un logro: el mismo nivel que activa el borde de nivel alto).
export function levelUpText({ level } = {}) {
  return level >= ELITE_FAN_LEVEL ? `alcanzó el nivel ${level} del club de fans` : `subió al nivel ${level} del club de fans`;
}
