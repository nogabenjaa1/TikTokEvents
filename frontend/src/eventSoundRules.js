// Cuándo suena cada efecto de un evento, como funciones puras (sin audio ni
// React), para poder probarlas y usar las MISMAS reglas en el panel y en el
// overlay. Cada regla compara la foto anterior del estado con el estado
// actual y devuelve los sonidos que tocan:
//   'throneSteal' | 'selecting' | 'eliminate' | 'winner' | 'goalAudio'
//
// `prev` es null la primera vez que se ve un estado: ahí NO suena nada, así
// abrir o recargar la página a mitad de una ronda no dispara efectos viejos.

// Rey del Trono: el trono cambia de manos mientras se juega, y ganador.
export function kingSnapshot(state) {
  return { mode: state?.mode ?? null, lastUsername: state?.lastParticipant?.username || null };
}
export function kingSounds(prev, state) {
  if (!prev || !state) return [];
  const sounds = [];
  if (state.mode === 'main' && state.lastParticipant?.username && state.lastParticipant.username !== prev.lastUsername) sounds.push('throneSteal');
  if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) sounds.push('winner');
  return sounds;
}

// Zubastinis: solo el ganador.
export function zubSnapshot(state) {
  return { mode: state?.mode ?? null };
}
export function zubSounds(prev, state) {
  if (!prev || !state) return [];
  return state.mode === 'finished' && prev.mode !== 'finished' && state.winner ? ['winner'] : [];
}

// Eliminación y Ruleta comparten el ciclo: arranca el sorteo, se resuelve el
// paso (el momento real en que el backend ya sacó a los eliminados) y ganador.
// Solo cambia el nombre del modo del sorteo.
function drawSounds(drawMode) {
  return (prev, state) => {
    if (!prev || !state) return [];
    const sounds = [];
    if (state.mode === drawMode && prev.mode !== drawMode) sounds.push('selecting');
    if (state.mode === 'result' && prev.mode === drawMode) sounds.push('eliminate');
    if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) sounds.push('winner');
    return sounds;
  };
}
export const elimSnapshot = zubSnapshot;
export const elimSounds = drawSounds('revealing');
export const rouletteSnapshot = zubSnapshot;
export const rouletteSounds = drawSounds('spinning');

// Objetivo: el audio propio del streamer suena UNA vez, al pasar a completado.
export function goalSnapshot(state) {
  return { finished: !!state?.finished };
}
export function goalSounds(prev, state) {
  if (!prev || !state) return [];
  return state.finished && !prev.finished && state.audioUrl ? ['goalAudio'] : [];
}

// Para el hook del panel: el mismo par (foto, reglas) por cada evento.
export const EVENT_SOUND_RULES = {
  king: { snapshot: kingSnapshot, sounds: kingSounds },
  zub: { snapshot: zubSnapshot, sounds: zubSounds },
  elim: { snapshot: elimSnapshot, sounds: elimSounds },
  roulette: { snapshot: rouletteSnapshot, sounds: rouletteSounds },
  goal: { snapshot: goalSnapshot, sounds: goalSounds },
};
