import { overlayAudioAllowed } from '../overlayAudio';
import { playEventSound } from '../eventSounds';

// El sonido de los eventos lo reproduce el PANEL (ver overlayAudio.js): un
// overlay de OBS es solo visual y queda en silencio, salvo que su URL lleve
// &audio=1. En el panel y en sus vistas previas esto nunca suena.
export function playOverlaySounds(ids, options) {
  if (!overlayAudioAllowed()) return;
  ids.forEach((id, index) => setTimeout(() => playEventSound(id, options), index * 150));
}

export const MEDALS = ['🥇', '🥈', '🥉'];

// Tope de cuántos eliminados se dibujan en la fase de "resultado" (1
// grande + hasta 4 burbujas), pedido explícito. No limita cuántos se pueden
// eliminar por ronda de verdad (eliminationsPerRound), solo cuántos se dibujan:
// el resto se resume como texto "y N más...".
export const RESULT_DISPLAY_CAP = 5;
