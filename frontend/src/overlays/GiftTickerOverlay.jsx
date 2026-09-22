import { useEffect, useState } from 'react';
import { resolveBackgroundStyle, getUsernameOverride, FONT_SCALES } from '../overlayCustomization';

// Cuántos segundos tarda la tira en dar una vuelta completa, por ítem -- así
// la VELOCIDAD (no la duración total) se siente pareja sin importar cuántas
// alertas de regalo tenga configuradas el streamer. MIN_LOOP_SECONDS evita
// que con dos o tres ítems la vuelta sea tan rápida que no se llegue a leer.
const SECONDS_PER_ITEM = 2.2;
const MIN_LOOP_SECONDS = 12;

// Contenido puro (sin socket) -- separado de GiftTickerOverlay para poder
// reusarlo tal cual en la vista previa del modal de personalización (ver
// OverlayPreviewBox.jsx), con datos de prueba en vez de esperar un socket
// real. Mismo criterio que AlertVisual/AlertOverlay en AlertOverlays.jsx.
export function GiftTickerVisual({ items, customize }) {
  const textOverride = getUsernameOverride(customize, { scale: false });
  const textScale = FONT_SCALES[customize?.usernameColor?.fontSize] ?? 1;

  if (!items || items.length === 0) {
    return (
      <div className="theme-die-frame w-[960px] h-[200px] flex items-center justify-center font-sans" style={resolveBackgroundStyle(customize)}>
        <p className="text-gray-500 text-sm italic">Todavía no hay alertas de un regalo específico configuradas.</p>
      </div>
    );
  }

  const loopSeconds = Math.max(MIN_LOOP_SECONDS, items.length * SECONDS_PER_ITEM);
  // La lista se dibuja DOS veces seguidas -- @keyframes tkc-ticker-scroll
  // (index.css) corre el track exactamente la mitad de su ancho, así el
  // final de la primera copia encastra con el principio de la segunda y el
  // bucle no se nota.
  const track = [...items, ...items];

  return (
    <div className="theme-die-frame w-[960px] h-[200px] overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      <div className="flex items-center h-full" style={{ width: 'max-content', animation: `tkc-ticker-scroll ${loopSeconds}s linear infinite` }}>
        {track.map((item, i) => (
          <div key={`${item.id}-${i}`} className="flex flex-col items-center gap-2 px-8 flex-shrink-0">
            {item.giftIcon ? (
              <img src={item.giftIcon} className="w-20 h-20 object-contain drop-shadow-lg" />
            ) : (
              <span className="w-20 h-20 flex items-center justify-center text-5xl" role="img" aria-label="Regalo">🎁</span>
            )}
            <p
              className={`text-sm font-black text-center max-w-[160px] truncate ${textOverride.className}`}
              style={{ ...textOverride.cssVars, fontSize: `${Math.round(16 * textScale)}px` }}
            >
              {item.apodo}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Overlay "tira" (ticker): en bucle, de a una imagen de regalo + su apodo,
// para TODAS las alertas de UN regalo puntual que el streamer tenga
// configuradas (ni las generales por mínimo, ni follow/sticker -- no tienen
// una sola imagen). No depende de estar conectado a un LIVE: es publicidad
// de "estos regalos tienen algo especial", siempre visible mientras la
// fuente de OBS esté activa. La lista la manda el servidor ya resuelta (ver
// ticker_alerts_update en backend/lib/tenant/alerts.js) -- este overlay no
// tiene sesión ni el catálogo de regalos en vivo, así que no podría armarla
// por su cuenta.
export function GiftTickerOverlay({ socket, customize }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!socket) return undefined;
    const onUpdate = (list) => setItems(Array.isArray(list) ? list : []);
    socket.on('ticker_alerts_update', onUpdate);
    return () => socket.off('ticker_alerts_update', onUpdate);
  }, [socket]);

  return <GiftTickerVisual items={items} customize={customize} />;
}
