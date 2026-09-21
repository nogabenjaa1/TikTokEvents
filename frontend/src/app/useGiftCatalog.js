import { useEffect, useState } from 'react';
import { backendUrl, authHeaders } from '../auth';

// Opción por defecto para cuando no quieren un regalo Insta-Win
const NO_INSTA_WIN = {
  name: 'Ninguno',
  coins: 0,
  icon: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
};

// Catálogo de regalos de TikTok de la conexión LIVE actual (solo en memoria). Lo baja del servidor cuando hay
// sesión, socket y LIVE conectado, reintenta cada 5 s si falla y se descarta al cambiar de usuario o de conexión.
export default function useGiftCatalog({ session, socketConnected, overlayMode, connectionStatus, username }) {
  const [giftsList, setGiftsList] = useState([]);
  const licenseKey = session?.token || null;
  // El catálogo vive solo en memoria y pertenece a la conexión LIVE actual.
  // Cancelar evita que una respuesta vieja reemplace el catálogo de otro usuario.
  useEffect(() => {
    setGiftsList([]);
    if (!licenseKey || !socketConnected || overlayMode || connectionStatus !== 'connected' || !username.trim()) return;
    const controller = new AbortController();
    let retry;
    const load = async () => {
      try {
        const response = await fetch(`${backendUrl()}/api/setup/${encodeURIComponent(username.trim().replace(/^@+/, ''))}`, {
          headers: authHeaders(), cache: 'no-store', signal: controller.signal,
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!data.success || !data.gifts?.length) throw new Error('Catálogo no disponible');
        setGiftsList([NO_INSTA_WIN, ...data.gifts]);
      } catch {
        if (!controller.signal.aborted) retry = setTimeout(load, 5000);
      }
    };
    load();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [username, connectionStatus, overlayMode, licenseKey, socketConnected]);
  return giftsList;
}
