import Overlay from '../Overlay';

// La tarjeta del overlay mide 380x700 fijo (pensada para el recorte de OBS)
// — se achica a este factor para que entre en un celular sin desbordar.
const OVERLAY_PREVIEW_SCALE = 0.75;

// Vista previa del overlay embebida, solo mobile: desde el celular no se
// puede tener a la vez el panel y una ventana aparte de OBS para chequear
// cómo se ve en vivo (a diferencia de desktop, donde el streamer sí puede
// tener las dos ventanas abiertas), así que se resuelve deslizando hacia
// abajo del panel de King/Zub/Elim. Reusa el mismo Overlay.jsx que corre en
// OBS, con el `activeApp` REAL (lo que de verdad está en el aire) — nunca
// forzado al modo que se esté mirando, porque la idea es confirmar qué ve
// la audiencia ahora mismo, no simular un modo que no está activo.
export default function MobileOverlayPreview({ state, zubState, elimState, rouletteState, activeApp, prize, theme, customization }) {
  return (
    <div className="md:hidden flex-shrink-0 border-t flex flex-col items-center gap-3 py-5" style={{ borderColor: 'var(--surface-border-color)' }}>
      <p className="theme-label text-[10px] uppercase tracking-widest font-semibold">Vista previa del overlay</p>
      <div style={{ width: 380 * OVERLAY_PREVIEW_SCALE, height: 700 * OVERLAY_PREVIEW_SCALE, overflow: 'hidden' }}>
        <div style={{ width: 380, height: 700, transform: `scale(${OVERLAY_PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
          <Overlay embedded state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={theme} customization={customization} />
        </div>
      </div>
    </div>
  );
}
