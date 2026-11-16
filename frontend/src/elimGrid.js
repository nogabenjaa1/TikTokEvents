// Tamaño de las burbujas de participantes de Eliminación (overlay de juegos
// 380x700 y overlay cuadrado propio). Lógica pura para probarla con node --test.
//
// Pedido explícito: las burbujas se achican según el espacio REAL del
// overlay hasta volverse puntos, y si ni así caben (o son tantas que dibujar
// una por una ya no sirve), desaparecen y el overlay muestra solo el total.

// Interlineado del @ bajo cada burbuja (el normal del sitio).
export const LABEL_LINE_HEIGHT = 1.5;
// Desde este tamaño se ve el @ debajo de la burbuja.
export const LABEL_MIN_SIZE = 18;
// Debajo de este tamaño la burbuja es un punto de color (sin foto): con 6px
// una foto ya no se distingue y miles de <img> pesan en OBS.
export const DOT_MAX_SIZE = 9;
// La burbuja más chica que se dibuja.
export const MIN_BUBBLE_SIZE = 3;
// Más entradas que esto no se dibujan una por una: se muestra el total.
export const MAX_BUBBLES = 1500;

// Alto del @ para una burbuja de `size`: la letra (22% de la burbuja) por su
// interlineado, más el gap-0.5 (2px) entre la foto y el texto.
export function labelFontSize(size) {
  return Math.max(4, Math.round(size * 0.22));
}

function labelSpace(size) {
  return size >= LABEL_MIN_SIZE ? Math.ceil(labelFontSize(size) * LABEL_LINE_HEIGHT) + 2 : 0;
}

function gapFor(size) {
  if (size >= LABEL_MIN_SIZE) return 6;
  if (size > DOT_MAX_SIZE) return 3;
  return 1;
}

// La burbuja más grande (hasta `maxSize`) con la que TODAS las entradas
// caben en `width` x `height` px. `hidden: true` si no caben ni con la más
// chica, o si son más de MAX_BUBBLES.
export function computeElimGrid(width, height, count, { maxSize = 64 } = {}) {
  const base = { size: maxSize, gap: gapFor(maxSize), showLabel: maxSize >= LABEL_MIN_SIZE, dot: false, hidden: false };
  if (count <= 0 || width <= 0 || height <= 0) return base;
  if (count > MAX_BUBBLES) return { ...base, hidden: true };
  for (let size = maxSize; size >= MIN_BUBBLE_SIZE; size -= size > 40 ? 2 : 1) {
    const gap = gapFor(size);
    const cols = Math.max(1, Math.floor((width + gap) / (size + gap)));
    const rows = Math.ceil(count / cols);
    // La última fila no lleva separación debajo.
    const neededHeight = rows * (size + labelSpace(size)) + (rows - 1) * gap;
    if (neededHeight <= height) {
      return { size, gap, showLabel: size >= LABEL_MIN_SIZE, dot: size <= DOT_MAX_SIZE, hidden: false };
    }
  }
  return { ...base, hidden: true };
}
