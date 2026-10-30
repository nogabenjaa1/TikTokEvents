import { createContext, useCallback, useContext, useState } from 'react';

// Los ajustes guardados de cada evento (ver eventSettingsStore.js), compartidos
// por App.jsx con los paneles. `epoch` sube cuando llega del servidor una
// configuración distinta de la que el panel tenía al abrirse (por ejemplo, la
// de otro dispositivo): EventsSection lo usa para volver a abrir el panel con
// los valores nuevos.
export const EventSettingsContext = createContext({ settings: {}, update: () => {}, epoch: 0 });

// Lo que un panel necesita: lo guardado al abrirlo (se lee una sola vez, como
// hacían los paneles con su copia local) y cómo guardar lo nuevo.
export function useEventDraft(id) {
  const { settings, update } = useContext(EventSettingsContext);
  const [initial] = useState(() => settings[id] || {});
  const save = useCallback((value) => update(id, value), [update, id]);
  return [initial, save];
}
