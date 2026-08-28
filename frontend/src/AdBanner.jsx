import React, { useEffect, useRef } from 'react';
import { NATIVE_BANNER_SCRIPT_SRC, NATIVE_BANNER_CONTAINER_ID, AD_BANNER_REFRESH_MS } from './adConfig';

// Banner fijo (NativeBanner de Adsterra) que queda siempre presente en su
// lugar mientras `active` es true — a diferencia de InterstitialAd, no
// bloquea nada ni pide esperar: es puro ingreso pasivo mientras se juega.
// Se recarga solo cada AD_BANNER_REFRESH_MS (creatividad nueva en vez de
// quedarse pegado con la misma). Comparte la misma zona/id de contenedor
// que InterstitialAd (solo hay una zona NativeBanner dada de alta), así que
// el padre debe pasar `active: false` mientras el interstitial esté abierto
// — dos elementos con el mismo id en el DOM a la vez rompería el HTML y
// confundiría al script de Adsterra.
export default function AdBanner({ active }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!active || !mountNode) return;

    const inject = () => {
      mountNode.replaceChildren();
      const container = document.createElement('div');
      container.id = NATIVE_BANNER_CONTAINER_ID;
      mountNode.appendChild(container);

      const script = document.createElement('script');
      script.async = true;
      script.dataset.cfasync = 'false';
      script.src = NATIVE_BANNER_SCRIPT_SRC;
      mountNode.appendChild(script);
    };

    inject();
    const refreshInterval = setInterval(inject, AD_BANNER_REFRESH_MS);

    return () => {
      clearInterval(refreshInterval);
      mountNode.replaceChildren();
    };
  }, [active]);

  if (!active) return null;
  return <div ref={mountRef} className="w-full max-w-xs min-h-[100px]" />;
}
