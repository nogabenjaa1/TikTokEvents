// Resumen de las entradas de Eliminación para el panel (ver
// ElimEntriesManager.jsx). Lógica pura para poder probarla con node --test.
//
// El servidor guarda un slot por entrada con `source` 'gift' (monedas) o
// 'manual' (agregada por el streamer); los slots de antes del campo cuentan
// como regalo (mismo criterio que backend/lib/elimEntries.js).

// Una fila por usuario con su total y cuántas son de cada tipo; más entradas
// arriba y, a igualdad, quien entró primero.
export function summarizeElimEntries(participants) {
  const byUser = new Map();
  for (const slot of participants || []) {
    if (!slot || !slot.username) continue;
    let row = byUser.get(slot.username);
    if (!row) {
      row = { username: slot.username, avatar: slot.avatar, total: 0, gift: 0, manual: 0, firstId: slot.id };
      byUser.set(slot.username, row);
    }
    row.total += 1;
    row[slot.source === 'manual' ? 'manual' : 'gift'] += 1;
    if (slot.id < row.firstId) row.firstId = slot.id;
  }
  return [...byUser.values()].sort((a, b) => (b.total - a.total) || (a.firstId - b.firstId));
}

// "2 por regalo · 3 manuales": de dónde salen las entradas de alguien.
export function entriesBreakdown(row) {
  const parts = [];
  if (row.gift) parts.push(`${row.gift} por regalo`);
  if (row.manual) parts.push(`${row.manual} ${row.manual === 1 ? 'manual' : 'manuales'}`);
  return parts.join(' · ');
}

// Quién recibe las entradas al combinar a `a` y `b`, para el resumen antes de
// confirmar. `target` es 'a', 'b' o 'custom' (otro perfil).
export function mergeDestination(a, b, target, customUsername) {
  if (target === 'a') return a;
  if (target === 'b') return b;
  const name = (customUsername || '').trim().replace(/^@+/, '').trim();
  return name || null;
}
