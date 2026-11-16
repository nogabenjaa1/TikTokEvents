import { useEffect, useRef } from 'react';
import { elimSnapshot, elimSounds } from '../eventSoundRules';
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

// Sonidos de Eliminación (solo con &audio=1, ver playOverlaySounds): arranca
// el sorteo ('revealing'), se resuelve la ronda ('revealing' -> 'result') y el
// mismo sonido de ganador que King/Zub. Lo comparten el overlay de juegos y el
// overlay cuadrado de Eliminación.
export function useElimSounds(state) {
  const prevRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    const sounds = elimSounds(prevRef.current, state);
    prevRef.current = elimSnapshot(state);
    playOverlaySounds(sounds);
    // Solo cuando cambia el modo o el ganador: el resto del estado llega a cada rato y no debe repetir el sonido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mode, state?.winner]);
}
