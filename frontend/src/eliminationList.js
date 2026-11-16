// Lista paginada de participantes de Eliminación (overlay secundario,
// ?screen=elimlist). Lógica pura, sin React, para poder probarla con
// node --test.
//
// El backend guarda un "slot" por entrada (ver processGiftElim en
// backend/lib/tenant/elim.js): quien manda el regalo 3 veces aparece 3
// veces en `participants`. Aquí se agrupan por usuario para mostrar una fila
// por persona con su número de entradas.

// Una fila por usuario, con más entradas arriba; a igualdad de entradas,
// quien entró primero (id de slot más bajo) va antes. Así la lista no
// cambia de orden sola mientras nadie suma entradas.
export function groupElimEntries(participants) {
  const byUser = new Map();
  for (const p of participants || []) {
    if (!p || !p.username) continue;
    const row = byUser.get(p.username);
    if (row) {
      row.entries += 1;
      if (p.id < row.firstId) row.firstId = p.id;
    } else {
      byUser.set(p.username, { username: p.username, avatar: p.avatar, entries: 1, firstId: p.id });
    }
  }
  return [...byUser.values()].sort((a, b) => (b.entries - a.entries) || (a.firstId - b.firstId));
}

// Cuántas filas de `rowHeight` (con `gap` entre ellas) caben en `height`
// px. Siempre al menos 1, para que una medida en 0 (la primera pintada,
// antes de medir) no deje páginas vacías.
export function rowsPerPage(height, rowHeight, gap) {
  if (!(height > 0) || !(rowHeight > 0)) return 1;
  return Math.max(1, Math.floor((height + gap) / (rowHeight + gap)));
}

// Parte las filas en páginas de `perPage`. Sin filas devuelve una sola
// página vacía, para que el overlay siempre tenga "página 1 de 1".
export function paginate(rows, perPage) {
  const size = Math.max(1, Math.floor(perPage) || 1);
  if (!rows || rows.length === 0) return [[]];
  const pages = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages;
}
