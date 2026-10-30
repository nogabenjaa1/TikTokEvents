import { createContext, useCallback, useContext, useState } from 'react';
import { createMountGuard } from '../eventSettingsSync.js';

// Los ajustes guardados de cada evento (ver eventSettingsStore.js), compartidos
// por App.jsx con los paneles. `epochs[id]` sube cuando llega del servidor una
// configuración de ese evento distinta de la que el panel tenía al abrirse
// (por ejemplo, la de otra pestaña): EventsSection lo usa para volver a abrir
// el panel con los valores nuevos. `notice`: aviso de esa actualización.
export const EventSettingsContext = createContext({ settings: {}, update: () => {}, epochs: {}, notice: null, dismissNotice: () => {} });

// Lo que un panel necesita: lo guardado al abrirlo (se lee una sola vez, como
// hacían los paneles con su copia local) y cómo guardar lo nuevo.
//
// Cada panel guarda con un efecto que también corre al montarse, con los
// valores con los que abrió (lo guardado, o los de fábrica si no había nada).
// Eso NO es un cambio del streamer: si se tomara como tal, abrir un panel antes
// de que el servidor respondiera hacía que los valores de fábrica (o una copia
// vieja de este navegador) se subieran por encima de lo guardado en la cuenta.
// Por eso se ignora lo que llega igual a lo del montaje (también la segunda
// pasada del modo estricto de React), hasta el primer cambio de verdad.
export function useEventDraft(id) {
  const { settings, update } = useContext(EventSettingsContext);
  const [initial] = useState(() => settings[id] || {});
  const [shouldSave] = useState(createMountGuard);
  const save = useCallback((value) => {
    if (shouldSave(value)) update(id, value);
  }, [update, id, shouldSave]);
  return [initial, save];
}
