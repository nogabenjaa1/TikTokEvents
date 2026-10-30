import { useCallback, useEffect, useRef, useState } from 'react';

// Confirmación de los cambios en vivo (paneles de juegos y contadores). Los
// manejadores update_*_settings del servidor no responden nada, pero sí
// reenvían el estado con los valores ya aplicados: el cambio está aplicado
// cuando lo que dice el servidor coincide con lo que se ve en el panel.
// Antes no había ninguna señal y no se sabía si un cambio había llegado.
//
// `localKey` / `serverKey`: los mismos ajustes en un texto comparable
// (JSON.stringify de los campos que se editan en vivo, ver liveKey). Devuelve
// null (nada que decir), 'pending', 'applied' o 'unconfirmed' (pasaron unos
// segundos sin que el servidor lo reflejara: conexión caída, por ejemplo).
export function liveKey(fields) {
  return JSON.stringify(fields);
}

const CONFIRM_TIMEOUT_MS = 4000;
const APPLIED_VISIBLE_MS = 2500;

// Pura, para las pruebas: qué decir según lo que cambió.
export function liveApplyPhase({ active, touched, localKey, serverKey }) {
  if (!active || !touched) return null;
  return localKey === serverKey ? 'applied' : 'pending';
}

export function useLiveApplied({ active, localKey, serverKey }) {
  const [state, setState] = useState({ touchedKey: null, timedOut: false, hidden: false });
  const prevLocal = useRef(localKey);
  const prevActive = useRef(active);

  useEffect(() => {
    const changedByUser = active && prevActive.current && prevLocal.current !== localKey;
    prevLocal.current = localKey;
    prevActive.current = active;
    if (!active) { setState({ touchedKey: null, timedOut: false, hidden: false }); return; }
    if (changedByUser) setState({ touchedKey: localKey, timedOut: false, hidden: false });
  }, [active, localKey]);

  const phase = liveApplyPhase({ active, touched: state.touchedKey !== null, localKey, serverKey });

  useEffect(() => {
    if (phase === 'pending') {
      const t = setTimeout(() => setState((s) => ({ ...s, timedOut: true })), CONFIRM_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'applied') {
      const t = setTimeout(() => setState((s) => ({ ...s, hidden: true })), APPLIED_VISIBLE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, localKey]);

  if (phase === 'pending') return state.timedOut ? 'unconfirmed' : 'pending';
  if (phase === 'applied') return state.hidden ? null : 'applied';
  return null;
}

// Evita el doble clic en Iniciar/Reiniciar: tras un clic, el botón queda
// bloqueado hasta que el estado del evento cambie (llegó la respuesta del
// servidor) o, como mucho, unos segundos (sin respuesta: se puede reintentar).
export function useActionLock(stateKey, ms = 3000) {
  const [locked, setLocked] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setLocked(false);
  }, [stateKey]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const run = useCallback((fn) => {
    if (locked) return;
    setLocked(true);
    timer.current = setTimeout(() => setLocked(false), ms);
    fn();
  }, [locked, ms]);
  return [locked, run];
}
