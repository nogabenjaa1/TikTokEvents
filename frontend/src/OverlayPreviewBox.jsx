import React from 'react';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay, SpotifyQueueOverlay } from './Overlay';
import DiceOverlay from './DiceOverlay';
import { useTheme, accentStyleVars } from './ThemeContext';
import { buildPreviewMock } from './overlayPreviewMocks';

// Tamaño real (sin escalar) de cada overlay — mismos valores que sus
// propios w-[...]/h-[...] en Overlay.jsx/DiceOverlay.jsx, ya estandarizados
// (pedido explícito): 380x700 para todos los verticales, 960x260 para los
// dos horizontales (Colores y Extensible ya compartían esa medida entre
// sí — se mantiene, cambiarla implicaría rediseñar su layout interno, que
// está pensado para una franja ancha y baja tipo "barra de subathon", no
// para una proporción más cuadrada). Se usan para escalar la vista previa
// a un tamaño que entre en el modal sin dejar espacio en blanco de más ni
// recortar nada.
const NATURAL_SIZE = {
  games: { w: 380, h: 700 },
  colors: { w: 960, h: 260 },
  extensible: { w: 960, h: 260 },
  taptap: { w: 380, h: 700 },
  gifter: { w: 380, h: 700 },
  musicqueue: { w: 380, h: 700 },
};

const PREVIEW_SCALE = 0.42;

// Contenido real de cada overlay, alimentado con datos de prueba (ver
// overlayPreviewMocks.js) — es el MISMO componente que corre en OBS, así
// que cualquier bug visual de la personalización (fondo, color de texto,
// etc.) se ve acá exactamente igual que en el directo, sin necesitar una
// conexión real a TikTok.
// `style={{ minHeight: 0 }}` en cada wrapper de acá abajo: bug real
// encontrado con medición de posición real (no solo mirando el CSS) —
// `.themed-app` (index.css) tiene un `min-height: 100vh` INCONDICIONAL, sin
// relación con la clase `h-full`/`h-screen` que se le agregue al lado.
// Dentro del recuadro chico del modal (mucho más bajo que 100vh de
// viewport real), ese mínimo ganaba igual y el contenido quedaba
// verticalmente centrado dentro de una caja del alto de TODA la pantalla
// en vez del alto real del contenedor — en King se notaba como "unos
// pocos píxeles más abajo" (700 vs ~720px de viewport, diferencia chica);
// en Extensible/Colores (260px de alto real) la tarjeta quedaba casi
// entera fuera del recorte visible del modal, dando la sensación de
// "vista previa vacía" cuando en realidad el contenido SÍ estaba ahí, solo
// que a un scroll de distancia hacia abajo.
function PreviewContent({ overlayId, entry, theme, liveState }) {
  const mock = buildPreviewMock(overlayId);
  switch (overlayId) {
    case 'games':
      return <Overlay embedded state={mock.king} activeApp="king" customization={{ games: entry }} theme={theme} />;
    case 'colors':
      // Colores no depende de una conexión en vivo a TikTok — mostrar el
      // dado que el streamer ya tiró de verdad (ver liveState en
      // OverlayLink.jsx), no uno inventado.
      return <DiceOverlay embedded diceState={liveState || mock.diceState} theme={theme} customize={entry} />;
    case 'taptap':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
          <TopTapTapOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'gifter':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
          <TopGifterOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'musicqueue':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
          <SpotifyQueueOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'extensible':
      // Mismo criterio que Colores: Extensible tampoco depende del LIVE —
      // el contador/segundos por follow-regalo que se ven acá son los que
      // el streamer YA configuró de verdad (ver liveState en
      // OverlayLink.jsx).
      return (
        <div className="themed-app grid place-items-center h-full" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
          <ExtensibleOverlay state={liveState || mock.state} customize={entry} />
        </div>
      );
    default:
      return null;
  }
}

// Vista previa en vivo dentro del propio modal de personalización — pedido
// explícito para poder detectar errores visuales (como el del fondo
// Rainbow) ANTES de salir al directo, sin depender de estar conectado a
// TikTok. Reusa los componentes reales del overlay (Overlay.jsx/
// DiceOverlay.jsx) con datos de prueba (Test1/Test2/Test3), escalados para
// entrar en el modal — se actualiza solo en cuanto `entry` cambia, porque
// es el mismo objeto que ya se está editando en vivo (ver
// OverlayCustomizePanel.jsx).
export default function OverlayPreviewBox({ overlayId, entry, liveState }) {
  const { style, accent, customColor } = useTheme();
  const theme = { style, accent, customColor };
  const natural = NATURAL_SIZE[overlayId] || { w: 380, h: 260 };
  const boxW = Math.round(natural.w * PREVIEW_SCALE);
  const boxH = Math.round(natural.h * PREVIEW_SCALE);

  return (
    <div className="rounded-xl overflow-hidden mx-auto" style={{ width: boxW, height: boxH, background: '#0A0614' }}>
      <div style={{ width: natural.w, height: natural.h, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
        <PreviewContent overlayId={overlayId} entry={entry} theme={theme} liveState={liveState} />
      </div>
    </div>
  );
}
