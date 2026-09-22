import { useEffect } from 'react';
import Overlay, { TopTapTapOverlay, TopGifterOverlay, ExtensibleOverlay, GoalOverlay, ChatOverlay, SpotifyQueueOverlay, AlertOverlay, GiftTickerOverlay } from '../Overlay';
import DiceOverlay from '../DiceOverlay';
import { accentStyleVars } from '../ThemeContext';
import { getOverlayScreen } from '../auth';

// Lo que se ve cuando la página se abre como fuente de navegador de OBS (?overlay=true&screen=...): la pantalla
// elegida con el estado que llega por el socket. Esa URL ya está pegada en OBS de streamers reales: no
// cambiar cómo se elige la pantalla ni qué recibe cada una.
export default function OverlayModeView({
  socket, state, zubState, elimState, rouletteState, activeApp, prize, overlayTheme, overlayCustomization,
  diceState, tapTapState, gifterState, spotifyQueueState, extensibleState, goalState, viewerCount,
}) {
  // TODOS los overlays se componen sobre la escena real de OBS — acá NO debe
  // quedar ningún fondo sólido detrás del recuadro/fila además del que elija
  // la personalización de cada uno (ver overlayCustomization.js). `body`
  // tiene un color de fondo fijo (ver index.css) que de otra forma se
  // colaría por fuera del recuadro/fila — se anula siempre que la página se
  // abre como overlay (`?overlay=true`), sin excepción.
  // BUG corregido (pedido explícito, dos veces sobre esta misma lista):
  // primero faltaba "colors" (Extensible ya lo tenía, Colores no pese a
  // compartir el mismo patrón de tarjeta única `theme-die-frame` 960x260);
  // después seguía faltando "games" (Rey del Trono/Zubastinis/Eliminación/
  // Ruleta) — a ese, a diferencia de los demás, se lo dejó a propósito
  // pintando el fondo temático de página completo, así que elegir
  // "Transparente" en su personalización solo volvía invisible el propio
  // recuadro de 380x700 (y sus filas internas) pero el `.themed-app` que lo
  // envuelve seguía mostrando un rectángulo sólido del color del tema
  // (--page-bg, un tono más oscuro que --surface-bg) por detrás y
  // alrededor -- exactamente lo mismo que le pasaba a Colores antes de
  // agregarlo acá. Ya no hay ningún overlay con este comportamiento
  // especial: se simplifica a "siempre transparente" en vez de mantener una
  // lista de excepciones que hay que recordar actualizar cada vez que se
  // agrega un overlay nuevo.
  useEffect(() => {
    document.body.classList.add('tkc-overlay-transparent');
    return () => document.body.classList.remove('tkc-overlay-transparent');
  }, []);

  if (!socket) {
    return (
      <div className="min-h-screen bg-[#05030A] text-red-400 flex items-center justify-center font-sans text-sm">
        Falta la clave de licencia en la URL del overlay (?overlay=true&amp;key=...)
      </div>
    );
  }
  const screen = getOverlayScreen();
  if (screen === 'colors') {
    return <DiceOverlay diceState={diceState} theme={overlayTheme} customize={overlayCustomization.colors} />;
  }
  // Sin `grid place-items-center` a propósito — el recuadro (380x700
  // fijo, ver Overlay.jsx) queda anclado arriba con `h-screen flex` en
  // vez de centrado, para que agregar o perder una fila del ranking
  // nunca lo reubique en la pantalla (pedido explícito: "posición
  // estática").
  if (screen === 'taptap') {
    return (
      <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <TopTapTapOverlay state={tapTapState} customize={overlayCustomization.taptap} />
      </div>
    );
  }
  if (screen === 'gifter') {
    return (
      <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <TopGifterOverlay state={gifterState} customize={overlayCustomization.gifter} />
      </div>
    );
  }
  if (screen === 'musicqueue') {
    return (
      <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <SpotifyQueueOverlay state={spotifyQueueState} customize={overlayCustomization.musicqueue} />
      </div>
    );
  }
  if (screen === 'alerts') {
    return (
      <div className="themed-app min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <AlertOverlay socket={socket} customize={overlayCustomization.alerts} />
      </div>
    );
  }
  if (screen === 'ticker') {
    return (
      <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <GiftTickerOverlay socket={socket} customize={overlayCustomization.ticker} />
      </div>
    );
  }
  if (screen === 'extensible') {
    return (
      <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <ExtensibleOverlay state={extensibleState} customize={overlayCustomization.extensible} />
      </div>
    );
  }
  if (screen === 'goal') {
    return (
      <div className="themed-app grid place-items-center min-h-screen" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <GoalOverlay state={goalState} customize={overlayCustomization.goal} />
      </div>
    );
  }
  if (screen === 'chat') {
    return (
      <div className="themed-app h-screen flex" data-theme-style={overlayTheme.style} data-accent={overlayTheme.accent} style={accentStyleVars(overlayTheme)}>
        <ChatOverlay socket={socket} viewerCount={viewerCount} customize={overlayCustomization.chat} />
      </div>
    );
  }
  return <Overlay state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />;
}
