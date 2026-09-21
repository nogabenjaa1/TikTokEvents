// Llamadas al servidor de las pantallas de Sistema (solo admin). Un 401 quiere decir que la sesión ya no vale (se
// cerró desde otro dispositivo, la licencia venció): se avisa a App.jsx para que vuelva al inicio de sesión con un
// mensaje claro, igual que el panel de Licencias.
import { useCallback, useEffect, useState } from 'react';
import { backendUrl, authHeaders } from '../auth';

export async function adminRequest(path, { method = 'GET', body, onUnauthorized } = {}) {
  const res = await fetch(`${backendUrl()}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    const message = data?.error || 'Tu sesión ya no es válida. Inicia sesión de nuevo.';
    onUnauthorized?.(message);
    throw new Error(message);
  }
  if (res.status === 429) throw new Error('Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.');
  if (!res.ok || !data?.success) throw new Error(data?.error || 'No se pudo completar la acción. Intenta de nuevo.');
  return data;
}

// Carga un GET y lo mantiene al día: `refreshMs` lo repite solo mientras la pestaña del navegador está a la vista.
// Una respuesta que llega tarde (porque ya se pidió otra, o se cambió de pantalla) se descarta.
export function useAdminData(path, { onUnauthorized, refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    adminRequest(path, { onUnauthorized })
      .then((data) => { if (!cancelled) setState({ data, error: '', loading: false }); })
      .catch((err) => { if (!cancelled) setState((current) => ({ ...current, error: err.message, loading: false })); });
    return () => { cancelled = true; };
  }, [path, onUnauthorized, tick]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = setInterval(() => { if (!document.hidden) setTick((n) => n + 1); }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  return { ...state, reload };
}
