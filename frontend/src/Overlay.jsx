// Punto de entrada de los overlays: elige cuál de los cuatro juegos (Rey del Trono, Zubastinis,
// Eliminación, Ruleta) se ve y reexporta los demás para que nadie tenga que saber en qué archivo
// vive cada uno. El código de cada overlay está en ./overlays/, un archivo por overlay.
import { accentStyleVars } from './ThemeContext';
import { EliminationOverlay } from './overlays/EliminationOverlay';
import { KingOverlay } from './overlays/KingOverlay';
import { RouletteOverlay } from './overlays/RouletteOverlay';
import { ZubastinisOverlay } from './overlays/ZubastinisOverlay';
export { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay } from './overlays/LeaderboardOverlays';
export { GoalOverlay } from './overlays/GoalOverlay';
export { ChatOverlay } from './overlays/ChatOverlay';
export { SpotifyQueueOverlay } from './overlays/SpotifyQueueOverlay';
export { AlertVisual, AlertOverlay, AlertSoundListener } from './overlays/AlertOverlays';
export { GiftTickerOverlay, GiftTickerVisual } from './overlays/GiftTickerOverlay';

// El overlay refleja el skin (material + acento) elegido en el panel — le
// llega por socket en `theme` (ver App.jsx/tenant.js), nunca de su propio
// localStorage: esta ventana corre aparte, en OBS, y la idea es justamente
// que la audiencia vea el mismo skin que el streamer eligió para representarse.
//
// `embedded`: además del uso normal como página completa de OBS
// (min-h-screen), este mismo componente se reusa como vista previa dentro
// del panel en mobile — ver App.jsx, donde no hay forma de tener OBS y el
// panel abiertos a la vez en un solo teléfono — y en el modal de
// personalización (ver OverlayPreviewBox.jsx). En esos casos no debe
// reservar el viewport entero, solo el tamaño real de la tarjeta (380x700).
// OJO: sacar la clase `min-h-screen` NO alcanza — `.themed-app` (index.css)
// tiene su PROPIO `min-height: 100vh` incondicional, así que sin este
// `style` inline el "grid place-items-center" seguía centrando la tarjeta
// dentro de un alto de pantalla completa en vez del alto real del
// contenedor — en el modal (mucho más chico que 100vh) esto empujaba la
// tarjeta varios píxeles hacia abajo del punto de anclaje esperado.
export default function Overlay({ state, zubState, elimState, rouletteState, activeApp, prize = null, theme = { style: 'default', accent: 'purple' }, embedded = false, customization }) {
  // Rey del Trono/Zubastinis/Eliminación/Ruleta comparten UNA sola URL/
  // fuente de OBS (?screen=games) — así que también comparten una sola
  // personalización de fondo/nombre de usuario, la de id "games" (ver
  // OVERLAY_CUSTOMIZE_LABELS en overlayCustomization.js).
  const gamesCustomize = customization?.games;
  return (
    <div className={`themed-app grid place-items-center ${embedded ? '' : 'min-h-screen'}`} style={{ ...(embedded ? { minHeight: 0 } : null), ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
      <div className="relative grid">
        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'king' ? 1 : 0, visibility: activeApp === 'king' ? 'visible' : 'hidden', transform: activeApp === 'king' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <KingOverlay state={state} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'zub' ? 1 : 0, visibility: activeApp === 'zub' ? 'visible' : 'hidden', transform: activeApp === 'zub' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <ZubastinisOverlay state={zubState} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'elim' ? 1 : 0, visibility: activeApp === 'elim' ? 'visible' : 'hidden', transform: activeApp === 'elim' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <EliminationOverlay state={elimState} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'roulette' ? 1 : 0, visibility: activeApp === 'roulette' ? 'visible' : 'hidden', transform: activeApp === 'roulette' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <RouletteOverlay state={rouletteState} prize={prize} customize={gamesCustomize} />
        </div>
      </div>
    </div>
  );
}
