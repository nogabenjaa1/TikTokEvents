// Rearma la lista de entradas de Eliminación que manda el servidor en formato
// compacto (ver packElimParticipants en backend/lib/elimEntries.js): cada
// foto viaja una sola vez por jugador en `players`, y `slots` trae
// [id, índice del jugador, 1 si es manual] en el orden de la lista. El resto
// del panel y los overlays siguen leyendo `participants` como siempre.
// Si el estado ya trae `participants` (un servidor sin desplegar todavía),
// se deja tal cual.
export function unpackElimState(state) {
  if (!state || !Array.isArray(state.slots) || !Array.isArray(state.players)) return state;
  const { slots, players, ...rest } = state;
  const participants = slots.map(([id, i, manual]) => {
    const player = players[i] || {};
    return { id, username: player.username || '', avatar: player.avatar || '', source: manual ? 'manual' : 'gift' };
  });
  return { ...rest, participants };
}
