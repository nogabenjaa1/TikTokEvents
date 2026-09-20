import { playThroneSteal, playSelecting, playEliminate, playWinner } from './sounds';
import { routeToSink } from './alertMonitor';

// Reproduce el sonido de un evento (ids de eventSoundRules.js). Nunca lanza:
// si el navegador bloquea el audio no se rompe nada.
//   throneSteal / selecting / eliminate / winner: efectos sintetizados (sounds.js)
//   goalAudio: el audio que el streamer subió para "Objetivo completado"
export function playEventSound(id, { audioUrl = '', sinkId = '' } = {}) {
  try {
    switch (id) {
      case 'throneSteal': playThroneSteal(); break;
      case 'selecting': playSelecting(); break;
      case 'eliminate': playEliminate(); break;
      case 'winner': playWinner(); break;
      case 'goalAudio':
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          routeToSink(audio, sinkId);
          audio.play().catch(() => {});
        }
        break;
      default: break;
    }
  } catch { /* sin sonido, pero el resto sigue */ }
}
