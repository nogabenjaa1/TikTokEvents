// ==========================================
// Lógica pura de las tiradas de Color Says — sin React, sin estado, para
// poder probarla con node --test (ver diceBias.test.js).
//
// Reglas (actualizadas, pedido explícito): el espectador elige un color y
// gana o pierde según cuántas veces sale entre los dados:
//   0 veces = pierde · 1 = gana · 2 = pierde · 3 = se vuelve a tirar ·
//   4 = gana doble · dos re-tiros seguidos = pierde.
// El juego solo tira: el streamer aplica la regla al color de cada
// espectador. Por eso ya no hay re-tiro automático cuando todos los dados
// salen iguales (con 4 dados eso ahora es "gana doble").
// ==========================================
import { COLORS } from './colorPalette.js';

export function rollFair(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * COLORS.length));
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Una tirada donde ningún color sale 1 ni 4 veces: con dados pares, solo
// pares de colores distintos (cada color sale 0 o 2 veces: cualquier
// espectador pierde); con impares, pares y un trío (3 = re-tiro). Con 1 dado
// no hay forma: sale un color 1 vez.
export function streamerFavoredRoll(n) {
  if (n < 2) return rollFair(n);
  const groups = [];
  let left = n;
  if (n % 2 === 1) { groups.push(3); left -= 3; }
  while (left > 0) { groups.push(2); left -= 2; }
  const colors = shuffle(COLORS.map((_, i) => i));
  const dice = groups.flatMap((size, g) => Array(size).fill(colors[g % colors.length]));
  return shuffle(dice);
}

// WIN BONUS (a favor del streamer, pedido explícito): con probabilidad
// `chance` (0 a 1) la tirada sale sin ningún color 1 o 4 veces (ver
// streamerFavoredRoll); si no, es una tirada normal al azar.
export function rollWithWinBonus(n, chance = 1) {
  if (n >= 2 && Math.random() < chance) return streamerFavoredRoll(n);
  return rollFair(n);
}

// Modo Seguro: fuerza que `colorIdx` salga EXACTAMENTE `targetCount` veces;
// las demás posiciones llevan otros colores al azar.
export function rollWithExactCount(n, colorIdx, targetCount) {
  const clamped = Math.max(0, Math.min(n, targetCount));
  const otherColors = COLORS.map((_, i) => i).filter((i) => i !== colorIdx);
  const positions = shuffle(Array.from({ length: n }, (_, i) => i));
  const result = new Array(n);
  positions.forEach((pos, idx) => {
    result[pos] = idx < clamped ? colorIdx : otherColors[Math.floor(Math.random() * otherColors.length)];
  });
  return result;
}

// Modo Seguro con las reglas nuevas:
// - 'ensure' (Asegurar): el color sale exactamente 1 vez → el espectador gana.
// - 'block' (Bloquear): el color sale 2 veces (o 0) → el espectador pierde.
//   Nunca 3 (re-tiro) ni 4 (gana doble).
export function rollForSafeMode(n, colorIdx, action) {
  if (action === 'ensure') return rollWithExactCount(n, colorIdx, 1);
  if (action === 'block') return rollWithExactCount(n, colorIdx, n >= 2 && Math.random() < 0.7 ? 2 : 0);
  return rollFair(n);
}

// Qué le toca al espectador según cuántas veces salió su color (el
// segundo re-tiro seguido cuenta como "pierde", eso lo lleva el streamer).
export function outcomeForCount(count) {
  if (count === 1) return 'win';
  if (count === 3) return 'reroll';
  if (count >= 4) return 'double';
  return 'lose';
}
