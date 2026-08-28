import React, { useEffect, useRef } from 'react';
import { NATIVE_BANNER_SCRIPT_SRC, NATIVE_BANNER_CONTAINER_ID } from './adConfig';

// Banner nativo de Adsterra, apilado junto a AdBanner.jsx (zona distinta,
// no se pisan). Se inyecta una sola vez por montaje y nunca se refresca:
// el script de Adsterra deja el contenedor vacío en una segunda invocación
// dentro de la misma carga de página (sin errores en consola) — probado
// en producción, es una protección propia del script contra refrescos
// forzados, no algo que se pueda forzar desde acá.
export default function NativeAdBanner({ active }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!active || !mountNode) return;

    const container = document.createElement('div');
    container.id = NATIVE_BANNER_CONTAINER_ID;
    mountNode.appendChild(container);

    const script = document.createElement('script');
    script.async = true;
    script.dataset.cfasync = 'false';
    script.src = NATIVE_BANNER_SCRIPT_SRC;
    mountNode.appendChild(script);

    return () => mountNode.replaceChildren();
  }, [active]);

  if (!active) return null;
  return <div ref={mountRef} className="w-full max-w-xs min-h-[100px]" />;
}
