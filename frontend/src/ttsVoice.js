// Reglas puras del TTS (sin React ni la Web Speech API), para poder probarlas.

// Voces entre las que sortea la "voz aleatoria". Antes eran TODAS las del
// navegador: salían voces de otros idiomas (el chat se leía en chino) o voces
// remotas que a veces no responden y dejaban la cola trabada. Ahora:
//   1. Español instalado en el equipo (localService), si hay al menos dos.
//   2. Cualquier voz en español.
//   3. Si el navegador no trae ninguna en español, todas (mejor eso que nada).
export function randomVoicePool(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const spanish = list.filter((v) => String(v?.lang || '').toLowerCase().startsWith('es'));
  const local = spanish.filter((v) => v.localService);
  if (local.length >= 2) return local;
  if (spanish.length > 0) return spanish;
  return list;
}

// Cuánto esperar a que termine de leerse un mensaje antes de darlo por
// trabado. Antes era un tope fijo de 15 s: un comentario largo con la voz
// lenta se cortaba a la mitad, y uno corto tardaba en dar por muerto al motor.
// Se estima ~13 caracteres por segundo a velocidad 1 (la velocidad divide) más
// un margen fijo, con piso de 8 s y techo de 90 s.
export const TTS_MIN_TIMEOUT_MS = 8000;
export const TTS_MAX_TIMEOUT_MS = 90000;
export function utteranceTimeoutMs(text, rate = 1) {
  const chars = String(text || '').length;
  const speed = Math.min(3, Math.max(0.5, Number(rate) || 1));
  const estimate = 4000 + (chars * 75) / speed;
  return Math.round(Math.min(TTS_MAX_TIMEOUT_MS, Math.max(TTS_MIN_TIMEOUT_MS, estimate)));
}
