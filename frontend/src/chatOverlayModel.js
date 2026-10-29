// Reglas del overlay de chat (overlays/ChatOverlay.jsx), sin React: los
// ajustes por defecto (los mismos que el servidor, ver
// backend/lib/chatOverlay.js) y qué mensajes se ven en un momento dado.

export const CHAT_DEFAULT_SETTINGS = {
  fadeSeconds: 30, newestOnTop: true, maxMessages: 12, fontSize: 16,
  showAvatars: true, showBadges: true, showFollows: true, showGifts: true, showShares: true, showPinned: true, showViewerCount: true,
};

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
