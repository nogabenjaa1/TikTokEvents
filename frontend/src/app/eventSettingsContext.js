import { createContext, useCallback, useContext, useState } from 'react';
import { createFieldTracker } from '../eventSettingsSync.js';

// Los ajustes guardados de cada evento (ver eventSettingsStore.js), compartidos
// por App.jsx con los paneles. `epochs[id]` sube cuando llega del servidor una
// configuración de ese evento distinta de la que el panel tenía al abrirse
// (por ejemplo, la de otra pestaña): EventsSection lo usa para volver a abrir
// el panel con los valores nuevos. `notice`: aviso de esa actualización.
export const EventSettingsContext = createContext({ settings: {}, update: () => {}, epochs: {}, notice: null, dismissNotice: () => {} });

// Lo que un panel necesita: lo guardado al abrirlo (se lee una sola vez, como
// hacían los paneles con su copia local) y cómo guardar lo nuevo.
//
// Cada panel llama a `save` con TODOS sus valores, también al montarse. De eso
// solo se guarda lo que cambió desde la llamada anterior (ver
// createFieldTracker): el montaje no es un cambio del streamer (si se tomara
// como tal, abrir un panel antes de que respondiera el servidor subía los
// valores de fábrica por encima de lo guardado), y un campo que el panel
// muestra con un valor viejo, porque otra pestaña lo cambió mientras se
// editaba otro, no se vuelve a subir.
export function useEventDraft(id) {
  const { settings, update } = useContext(EventSettingsContext);
  const [initial] = useState(() => settings[id] || {});
  const [patchOf] = useState(createFieldTracker);
  const save = useCallback((value) => {
    const patch = patchOf(value);
    if (patch) update(id, patch);
  }, [update, id, patchOf]);
  return [initial, save];
}
