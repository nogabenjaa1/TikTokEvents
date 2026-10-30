import { useLayoutEffect, useRef, useState } from 'react';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay, GoalOverlay, ChatOverlay, SpotifyQueueOverlay, GiftTickerVisual, VersusOverlay } from './Overlay';
import DiceOverlay from './DiceOverlay';
import { useTheme, accentStyleVars } from './ThemeContext';
import { buildPreviewMock } from './overlayPreviewMocks';
import { NATURAL_SIZE, PREVIEW_BACKDROPS } from './overlayPreview';

// La vista previa se escala para caber en el ancho que tenga (la columna del
// panel de personalización), sin pasar de un alto cómodo ni agrandarse de más.
const PREVIEW_MAX_SCALE = 0.6;
const PREVIEW_MAX_HEIGHT = 440;

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
// Sin regalos configurados, el estado real de Versus no muestra nada útil para
// juzgar colores y tamaños: se usan los de prueba.
const hasVersusGifts = (s) => !!s && ((s.heroes?.length || 0) + (s.villains?.length || 0)) > 0;

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
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <TopTapTapOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'gifter':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <TopGifterOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'musicqueue':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <SpotifyQueueOverlay state={mock.state} customize={entry} />
        </div>
      );
    case 'extensible':
      // Mismo criterio que Colores: Extensible tampoco depende del LIVE —
      // el contador/segundos por follow-regalo que se ven acá son los que
      // el streamer YA configuró de verdad (ver liveState en
      // OverlayLink.jsx).
      return (
        <div className="themed-app grid place-items-center h-full" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <ExtensibleOverlay state={liveState || mock.state} customize={entry} />
        </div>
      );
    case 'goal':
      // Mismo criterio que Extensible: el Objetivo tampoco depende del
      // LIVE para su configuración -- se muestra el progreso REAL que el
      // streamer ya tiene, no uno inventado (ver liveState en
      // OverlayLink.jsx).
      return (
        <div className="themed-app grid place-items-center h-full" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <GoalOverlay state={liveState || mock.state} customize={entry} />
        </div>
      );
    case 'chat':
      return (
        <div className="themed-app h-full flex" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <ChatOverlay viewerCount={mock.viewerCount} previewMessages={mock.messages} customize={entry} />
        </div>
      );
    case 'versus':
      // Mismo criterio que Extensible/Goal: no depende del LIVE, se muestra
      // la configuración REAL del streamer (regalos ya asignados y sus
      // contadores) en vez de una inventada (ver liveState en OverlayLink.jsx).
      return (
        <div className="themed-app grid place-items-center h-full" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <VersusOverlay state={hasVersusGifts(liveState) ? liveState : mock.state} customize={entry} />
        </div>
      );
    case 'ticker':
      // Igual que Chat: la tira depende de un socket real, así que la vista previa
      // usa datos de prueba en vez de intentar conectar uno (ver GiftTickerVisual).
      return (
        <div className="themed-app grid place-items-center h-full" style={{ minHeight: 0, ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent} data-mode="light">
          <GiftTickerVisual items={mock.items} customize={entry} />
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
export default function OverlayPreviewBox({ overlayId, entry, liveState, maxHeight = PREVIEW_MAX_HEIGHT, backdrop = 'dark' }) {
  const { style, accent, customColor } = useTheme();
  const theme = { style, accent, customColor };
  const natural = NATURAL_SIZE[overlayId] || { w: 380, h: 260 };
  const wrapRef = useRef(null);
  const [available, setAvailable] = useState(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const scale = Math.min(PREVIEW_MAX_SCALE, maxHeight / natural.h, available ? available / natural.w : 0.42);
  const boxW = Math.round(natural.w * scale);
  const boxH = Math.round(natural.h * scale);

  return (
    // `tkc-overlay-preview` (ver index.css): igual que la página real del overlay, este fondo
    // representa "lo que sea que haya detrás en OBS" -- el `.themed-app` que arma cada
    // PreviewContent trae su propio fondo temático de página (`--page-bg`) para el uso normal
    // del panel, así que esa clase lo anula acá, igual que `body.tkc-overlay-transparent` lo
    // anula en la página real (ver OverlayModeView.jsx). Sin esto, "Transparente" en el fondo
    // del overlay se veía bien en el recuadro/fila propios pero la vista previa entera seguía
    // mostrando un rectángulo sólido del color del tema alrededor -- exactamente el bug que
    // esto previene, pero adentro del modal en vez de en OBS.
    // aria-hidden: son datos de prueba (y títulos del overlay); quien la usa
    // pone su propio texto de "Vista previa".
    <div ref={wrapRef} className="w-full" aria-hidden="true">
      <div className="tkc-overlay-preview rounded-xl overflow-hidden mx-auto" style={{ width: boxW, height: boxH, ...(PREVIEW_BACKDROPS[backdrop] || PREVIEW_BACKDROPS.dark).style }}>
        <div style={{ width: natural.w, height: natural.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <PreviewContent overlayId={overlayId} entry={entry} theme={theme} liveState={liveState} />
        </div>
      </div>
    </div>
  );
}
