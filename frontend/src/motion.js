// Tiempos del movimiento de la interfaz que también necesita el código (no
// solo el CSS): ver DESIGN.md › Motion y MorphButton.jsx.
export const MORPH_MIN_LOADING_MS = 450; // lo que tarda el botón en encogerse: antes de esto, la palomita no se alcanza a ver
export const MORPH_SUCCESS_HOLD_MS = 650;

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Espera pensada para una animación: con movimiento reducido no espera nada.
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));
