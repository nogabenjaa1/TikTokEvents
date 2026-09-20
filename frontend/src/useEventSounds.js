import { useEffect, useRef } from 'react';
import { EVENT_SOUND_RULES } from './eventSoundRules';
import { playEventSound } from './eventSounds';
import { setSoundSink } from './sounds';

// El panel es quien reproduce los sonidos de los eventos (juegos y Objetivo);
// el overlay de OBS es solo visual. Vigila los estados que ya recibe por socket
// y, cuando una regla dice que toca sonar, lo reproduce.
//   enabled: el streamer tiene el sonido activado en este navegador.
//   ready:   ya pasó un momento desde que conectó, para que el estado que
//            llega de golpe al conectar (o tras un reinicio del servidor) no
//            dispare efectos de algo que pasó antes.
//   sinkId:  dispositivo de salida elegido ('' = el predeterminado).
export default function useEventSounds(states, { enabled, ready, sinkId }) {
  const options = useRef({ enabled, ready, sinkId });
  // Se actualiza en un efecto (no al renderizar) y ANTES de los de cada juego:
  // los efectos de un componente corren en el orden en que se declaran.
  useEffect(() => { options.current = { enabled, ready, sinkId }; });

  // El destino de los efectos sintetizados se cambia una sola vez por cambio.
  useEffect(() => { setSoundSink(sinkId); }, [sinkId]);

  for (const kind of Object.keys(EVENT_SOUND_RULES)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- la lista de tipos es fija: el orden de los hooks no cambia
    useKindSounds(kind, states[kind], options);
  }
}

function useKindSounds(kind, state, options) {
  // Cómo estaba este juego la última vez que se miró: las reglas comparan
  // contra esto para saber qué acaba de cambiar.
  const previous = useRef(null);
  useEffect(() => {
    if (!state) return;
    const rules = EVENT_SOUND_RULES[kind];
    const sounds = rules.sounds(previous.current, state);
    previous.current = rules.snapshot(state);
    const { enabled, ready, sinkId } = options.current;
    if (!enabled || !ready) return;
    sounds.forEach((id, index) => {
      setTimeout(() => playEventSound(id, { audioUrl: state.audioUrl, sinkId }), index * 150);
    });
  }, [kind, state, options]);
}
