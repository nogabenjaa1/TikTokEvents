// Reglas del overlay de chat (overlays/ChatOverlay.jsx), sin React: los
// ajustes por defecto (los mismos que el servidor, ver
// backend/lib/chatOverlay.js) y qué mensajes se ven en un momento dado.

export const CHAT_DEFAULT_SETTINGS = {
  fadeSeconds: 30, newestOnTop: false, maxMessages: 12, fontSize: 24,
  showAvatars: true, showBadges: true, showFollows: true, showGifts: true, showShares: true, showPinned: true, showViewerCount: true,
};

// El overlay ocupa toda la fuente de navegador de OBS, del tamaño que tenga:
// antes medía siempre 960 x 480 y, en un lienzo vertical, OBS lo achicaba
// hasta que la letra no se leía. Estas medidas son solo las de referencia
// para las vistas previas: horizontal (la de siempre, con el ancho de los
// banners horizontales) y vertical (la que se recomienda para OBS vertical).
export const CHAT_OVERLAY_SIZE = { w: 960, h: 480 };
export const CHAT_OVERLAY_SIZE_VERTICAL = { w: 540, h: 960 };

// Lo que dura la animación de desvanecido, después de vencer el tiempo.
export const CHAT_FADE_OUT_MS = 700;

const KIND_SETTING = { follow: 'showFollows', gift: 'showGifts', share: 'showShares' };

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
// donador, suscriptor) y al final las imágenes de TikTok que no son ninguno de
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
  if (badges.fanLevel > 0) icons.push({ kind: 'member', level: badges.fanLevel, label: `Miembro nivel ${badges.fanLevel}` });
  if (badges.topGifterRank) icons.push({ kind: 'topGifter', rank: badges.topGifterRank, label: `Top ${badges.topGifterRank} en regalos` });
  if (badges.gifterLevel > 0) icons.push({ kind: 'gifter', label: `Donador nivel ${badges.gifterLevel}` });
  if (badges.subscriber) icons.push({ kind: 'subscriber', label: 'Suscriptor' });
  for (const url of badges.others || []) icons.push({ kind: 'image', url, label: 'Insignia' });
  return icons;
}
