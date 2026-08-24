// Efectos de sonido del overlay, sintetizados con Web Audio API — sin
// archivos de audio externos que cargar ni licenciar. El overlay corre
// dentro de un Browser Source de OBS, que SÍ reproduce/captura el audio de
// la página, así que esto se escucha en el stream, no solo localmente.
let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Un solo tono con rampa de frecuencia y envolvente de volumen (ataque
// rápido, caída exponencial) — el bloque básico con el que se arman todos
// los efectos de abajo.
function tone(freqStart, freqEnd, duration, { type = 'sine', gain = 0.3, delay = 0 } = {}) {
  try {
    const audioCtx = getCtx();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = type;
    const now = audioCtx.currentTime + delay;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + Math.min(0.02, duration / 4));
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gainNode).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch {
    // Si el navegador bloquea audio (autoplay policy) no rompemos el overlay
  }
}

// 👑 Alguien roba el lugar en Rey del Trono: un "whoosh" ascendente y corto.
export function playThroneSteal() {
  tone(320, 760, 0.18, { type: 'triangle', gain: 0.28 });
}

// 🎯 Empieza el sorteo de Eliminación (mientras se elige a quién le toca):
// dos blips rápidos ascendentes, como si arrancara una ruleta.
export function playSelecting() {
  tone(240, 480, 0.09, { type: 'square', gain: 0.18 });
  tone(300, 600, 0.09, { type: 'square', gain: 0.18, delay: 0.1 });
}

// 💀 Se resuelve una eliminación (perdió el slot, quede o no afuera del todo).
export function playEliminate() {
  tone(320, 70, 0.22, { type: 'sawtooth', gain: 0.32 });
}

// 🏆 Hay ganador — MISMO sonido en Rey del Trono, Zubastinis y Eliminación
// a propósito, para que el momento se sienta igual sin importar el modo.
export function playWinner() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => tone(freq, freq, 0.16, { type: 'triangle', gain: 0.3, delay: i * 0.12 }));
}
