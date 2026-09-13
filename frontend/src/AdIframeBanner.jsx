import React, { useEffect, useRef } from 'react';
import { AD_SCRIPT_HOST } from './adConfig';

// Banner de Adsterra (formato "atOptions" + invoke.js). Ese script arma el
// anuncio escribiendo directo en el documento donde corre — nada raro en
// una página tradicional, pero en una SPA como esta el script se inserta
// mucho después de la carga inicial, y un document.write() tardío puede
// romper la página entera. Por eso se crea un <iframe> propio y se escribe
// el HTML del anuncio DENTRO de su documento (no en el de la página): cada
// zona queda aislada en su propio iframe con su propio `atOptions` global,
// así que varias zonas pueden convivir en pantalla a la vez sin pisarse
// (a diferencia del NativeBanner anterior, que compartía un solo id de
// contenedor entre el banner fijo y el interstitial).
export default function AdIframeBanner({ zone, active }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!active || !mountNode) return;

    const iframe = document.createElement('iframe');
    iframe.title = 'Anuncio';
    iframe.style.width = `${zone.width}px`;
    iframe.style.height = `${zone.height}px`;
    iframe.style.border = 'none';
    iframe.scrolling = 'no';
    mountNode.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>body{margin:0;padding:0;overflow:hidden;}</style></head><body>
      <script>
        atOptions = {
          'key': '${zone.key}',
          'format': 'iframe',
          'height': ${zone.height},
          'width': ${zone.width},
          'params': {}
        };
      </script>
      <script src="${AD_SCRIPT_HOST}/${zone.key}/invoke.js"></script>
    </body></html>`);
    doc.close();

    return () => mountNode.replaceChildren();
  }, [active, zone]);

  if (!active) return null;
  return <div ref={mountRef} style={{ width: zone.width, height: zone.height }} />;
}
