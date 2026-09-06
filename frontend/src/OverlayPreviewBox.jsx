import React from 'react';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay, SpotifyQueueOverlay } from './Overlay';
import DiceOverlay from './DiceOverlay';
import { useTheme } from './ThemeContext';
import { buildPreviewMock } from './overlayPreviewMocks';

// Tamaño real (sin escalar) de cada overlay — mismos valores que sus
// propios w-[...]/h-[...] en Overlay.jsx/DiceOverlay.jsx. Se usan para
// escalar la vista previa a un tamaño que entre en el modal sin dejar
// espacio en blanco de más ni recortar nada.
const NATURAL_SIZE = {
  games: { w: 400, h: 700 },
  colors: { w: 960, h: 260 },
  extensible: { w: 960, h: 260 },
  taptap: { w: 380, h: 280 },
  gifter: { w: 380, h: 280 },
  musicqueue: { w: 380, h: 280 },
};

const PREVIEW_SCALE = 0.42;

// Contenido real de cada overlay, alimentado con datos de prueba (ver
// overlayPreviewMocks.js) — es el MISMO componente que corre en OBS, así
// que cualquier bug visual de la personalización (fondo, color de texto,
// etc.) se ve acá exactamente igual que en el directo, sin necesitar una
// conexión real a TikTok.
function PreviewContent({ overlayId, entry, theme }) {
  const mock = buildPreviewMock(overlayId);
  switch (overlayId) {
    case 'games':
      return <Overlay embedded state={mock.king} activeApp="king" customization={{ games: entry }} theme={theme} />;
    case 'colors':
      return <DiceOverlay diceState={mock.diceState} theme={theme} customize={entry} />;
    case 'taptap':
      return (
        <div className="themed-app h-full flex" data-theme-style={theme.style} data-accent={theme.accent}>
          <TopTapTapOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'gifter':
      return (
        <div className="themed-app h-full flex" data-theme-style={theme.style} data-accent={theme.accent}>
          <TopGifterOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'musicqueue':
      return (
        <div className="themed-app h-full flex" data-theme-style={theme.style} data-accent={theme.accent}>
          <SpotifyQueueOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'extensible':
      return (
        <div className="themed-app grid place-items-center h-full" data-theme-style={theme.style} data-accent={theme.accent}>
          <ExtensibleOverlay state={mock.state} customize={entry} />
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
export default function OverlayPreviewBox({ overlayId, entry }) {
  const { style, accent } = useTheme();
  const theme = { style, accent };
  const natural = NATURAL_SIZE[overlayId] || { w: 400, h: 260 };
  const boxW = Math.round(natural.w * PREVIEW_SCALE);
  const boxH = Math.round(natural.h * PREVIEW_SCALE);

  return (
    <div className="rounded-xl overflow-hidden mx-auto" style={{ width: boxW, height: boxH, background: '#0A0614' }}>
      <div style={{ width: natural.w, height: natural.h, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
        <PreviewContent overlayId={overlayId} entry={entry} theme={theme} />
      </div>
    </div>
  );
}
