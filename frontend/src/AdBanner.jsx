import React, { useEffect, useRef } from 'react';
import { NATIVE_BANNER_SCRIPT_SRC, NATIVE_BANNER_CONTAINER_ID } from './adConfig';

// Banner fijo (NativeBanner de Adsterra) que queda siempre presente en su
// lugar mientras `active` es true — a diferencia de InterstitialAd, no
// bloquea nada ni pide esperar: es puro ingreso pasivo mientras se juega.
// Comparte la misma zona/id de contenedor que InterstitialAd (solo hay una
// zona NativeBanner dada de alta), así que el padre debe pasar `active:
// false` mientras el interstitial esté abierto — dos elementos con el mismo
// id en el DOM a la vez rompería el HTML y confundiría al script de Adsterra.
//
// Se probó recargarlo cada 30s (re-crear contenedor+script) para traer
// creatividad nueva, pero en producción el script de Adsterra deja el
// contenedor vacío en la segunda invocación dentro de la misma carga de
// página (sin errores en consola) — tiene su propia protección anti-abuso
// contra refrescos forzados, no es algo que se pueda forzar desde acá. Por
// eso se inyecta una sola vez por montaje: sigue mostrando el mismo
// anuncio todo el tiempo que `active` esté prendido, que es preferible a
// un hueco vacío después de la primera recarga.
export default function AdBanner({ active }) {
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
