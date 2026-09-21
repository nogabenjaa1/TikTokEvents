import { useEffect, useRef, useState } from 'react';
import { getUsernameOverride, resolveBackgroundStyle } from '../overlayCustomization';

// CHAT EN VIVO + ESPECTADORES (pedido explícito): reusa el mismo broadcast
// que ya alimenta al TTS (`tts_chat_message`, SIN filtrar por sus ajustes —
// esos filtros son 100% del lado de TtsChat.jsx, ver su comentario) para no
// duplicar tráfico de socket con un segundo evento idéntico. Cola propia
// (últimos N mensajes, se caen los viejos) — mismo criterio simple que
// TtsChat.jsx, pero acá es solo para MOSTRAR, no hay síntesis de voz.
const CHAT_OVERLAY_MAX_MESSAGES = 12;

// `previewMessages`: solo lo usa OverlayPreviewBox.jsx (modal de
// "Personalizar") -- ahí no hay un socket real conectado a un LIVE, así que
// se le pasan un par de mensajes de prueba fijos en vez de escuchar el
// socket, para poder ver el efecto de la personalización sobre filas reales
// en vez de la lista vacía.
export function ChatOverlay({ socket, viewerCount, customize, previewMessages }) {
  const [liveMessages, setLiveMessages] = useState([]);
  const seenIds = useRef(new Set());

  useEffect(() => {
    if (previewMessages || !socket) return;
    const onMessage = (message) => {
      if (message.comment.includes('@')) return; // mismo filtro que TTS: nunca @menciones
      if (seenIds.current.has(message.id)) return;
      seenIds.current.add(message.id);
      if (seenIds.current.size > 500) seenIds.current.clear();
      setLiveMessages((current) => [...current, message].slice(-CHAT_OVERLAY_MAX_MESSAGES));
    };
    socket.on('tts_chat_message', onMessage);
    return () => socket.off('tts_chat_message', onMessage);
  }, [socket, previewMessages]);

  const messages = previewMessages || liveMessages;
  const rowBg = resolveBackgroundStyle(customize, 'var(--surface-bg-alt)');
  const nameOverride = getUsernameOverride(customize);
  // Animación de entrada por mensaje (pedido explícito) -- mismas clases
  // que las Alertas (`.tkc-alert-anim-in-*`, ver index.css), reusadas tal
  // cual. Al ser CSS de animación (no JS), solo se dispara una vez cuando
  // React monta la fila por primera vez -- las filas viejas ya montadas
  // nunca la vuelven a reproducir cuando entra una nueva al fondo de la
  // lista, que es exactamente el efecto buscado.
  const messageAnim = customize?.messageAnimation || 'fade';
  const animClass = messageAnim !== 'none' ? `tkc-alert-anim-in-${messageAnim}` : '';

  return (
    <div className="w-[380px] h-[700px] p-5 flex flex-col gap-3 font-sans">
      <div className="flex items-center justify-between flex-shrink-0">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">💬 Chat en vivo</p>
        <span className="text-xs font-black text-white bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0">
          👁️ {Math.max(0, viewerCount || 0).toLocaleString('es-MX')}
        </span>
      </div>
      {messages.length > 0 ? (
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto justify-end">
          {messages.map((m) => (
            <div key={m.id} className={`flex items-start gap-2 rounded-xl px-3 py-2 border ${animClass}`} style={{ borderColor: 'var(--surface-border-color)', ...rowBg }}>
              {m.avatar ? (
                <img src={m.avatar} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className={`text-xs font-black truncate ${nameOverride.className}`} style={nameOverride.cssVars}>
                  {m.isModerator ? '🛡️ ' : ''}{m.isSuperFan ? '⭐ ' : ''}@{m.uniqueId || m.username}
                </p>
                <p className="text-sm text-white break-words">{m.comment}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs italic text-center">Esperando mensajes del chat...</p>
        </div>
      )}
    </div>
  );
}
