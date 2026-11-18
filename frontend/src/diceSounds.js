// Sonidos de Color Says, generados en el navegador (Web Audio), sin archivos.
// Pedido explícito: más cómodos para el oído que el pitido de onda cuadrada
// de antes. Son propios (no copiados de otro sitio):
// - Al girar: un repiqueteo de dados — golpes muy cortos de ruido filtrado,
//   a volumen bajo, cada vez más espaciados, como cuando los dados se asientan.
// - Al mostrar la tirada: un "pop" suave y dos notas cálidas (onda triangular
//   con ataque suave y filtro de agudos).

let audioCtx = null;
let noiseBuffer = null;

export function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function getNoise(ctx) {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.25), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Un golpe de dado: ruido corto por un filtro de banda (tono de madera/plástico).
function playClack(ctx, when, strength = 1) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800 + Math.random() * 1400;
  band.Q.value = 6;
  const gain = ctx.createGain();
  const peak = 0.2 * strength;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(when, Math.random() * 0.15, 0.06);
}

// Programa el repiqueteo completo de una tirada de `durationMs`: empieza
// rápido (~55 ms entre golpes) y se va espaciando hasta ~190 ms al final.
export function playRollClatter(durationMs) {
  const ctx = ensureAudioCtx();
  const start = ctx.currentTime + 0.01;
  const total = durationMs / 1000;
  let t = 0;
  while (t < total) {
    const progress = t / total;
    playClack(ctx, start + t, 1 - progress * 0.45);
    // A veces dos dados chocan casi juntos.
    if (Math.random() < 0.3) playClack(ctx, start + t + 0.018, 0.6 - progress * 0.3);
    t += 0.055 + progress * progress * 0.135 + Math.random() * 0.02;
  }
}

// Resultado: un pop suave y dos notas cálidas que suben.
export function playRevealSound() {
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  playClack(ctx, now, 1.1);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2400;
  lowpass.connect(ctx.destination);
  [[587.33, 0.05], [880, 0.14]].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = now + delay;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(lowpass);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}
