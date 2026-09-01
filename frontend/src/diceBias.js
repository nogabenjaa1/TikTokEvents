// ==========================================
// Lógica pura del sesgo de Color Says — sin React, sin estado. Compartida
// entre el juego real (Colorsays.jsx) y la demo de preview de la pantalla
// de Membresía (Membership.jsx), para que la demo tire con la MISMA
// probabilidad real que el juego, en vez de una animación inventada aparte.
// ==========================================
import { COLORS } from './colorsData.jsx';

export function rollFair(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * COLORS.length));
}

export function hasRepeat(results) {
  const counts = {};
  results.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return Object.values(counts).some(c => c >= 2);
}

// Ver el comentario original en Colorsays.jsx: con 1-2 dados el sesgo no
// aplica (con 2, "forzar un par" es forzar el comodín de reroll automático).
export const ADMIN_DEFAULT_BIAS = 1.0;
export const PRO_WIN_BONUS = 0.2; // intensidad fija que compra el addon PRO

export function rollWithPairBias(n, biasChance = ADMIN_DEFAULT_BIAS) {
  const results = rollFair(n);
  if (n < 3) return results;
  if (results.every(r => r === results[0])) return results;

  if (!hasRepeat(results) && Math.random() < biasChance) {
    const idxA = Math.floor(Math.random() * n);
    let idxB = Math.floor(Math.random() * n);
    while (idxB === idxA) idxB = Math.floor(Math.random() * n);
    const adjusted = [...results];
    adjusted[idxB] = adjusted[idxA];
    return adjusted;
  }
  return results;
}
