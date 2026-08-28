import { useEffect } from 'react';

export const ADSENSE_CLIENT = 'ca-pub-5961182005770214';
const SCRIPT_ID = 'tkc-adsbygoogle-script';

// Carga el script de cuenta de AdSense (Auto ads: Google decide sola dónde
// insertar los anuncios en la página, no arma unidades manuales con
// <ins class="adsbygoogle">). Se inyecta una sola vez — Google no tiene una
// forma soportada de "recargar" Auto ads, así que si `active` ya estuvo
// prendido antes no vuelve a insertar el script.
//
// Ocultar los anuncios ya insertados (banco de horas del invitado, ver
// Colorsays.jsx) tampoco tiene una API de Google para hacerlo, así que se
// resuelve por CSS: ver la clase .tkc-ads-suppressed en index.css.
export default function AdSenseLoader({ active }) {
  useEffect(() => {
    if (!active || document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, [active]);

  return null;
}
