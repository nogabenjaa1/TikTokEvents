// Quién reproduce el sonido de los eventos.
//
// El navegador del panel (esta pestaña) reproduce TODO el sonido: alertas,
// objetivo completado y efectos de los juegos. El directo capta el audio de la
// computadora, así que sale una sola vez. Los overlays de OBS son solo visuales
// y quedan en silencio, para que no suene doble.
//
// Excepción explícita: quien no puede dejar el panel abierto en la misma
// computadora (por ejemplo OBS en otra PC) agrega "&audio=1" a la URL del
// overlay y ESE overlay sí reproduce el sonido (y en el panel se apaga el
// sonido, para no duplicarlo).

// Parte pura: recibe la URL, para poder probarla sin navegador.
export function overlayAudioFromLocation({ search = '', hash = '' } = {}) {
  const isOverlay = hash.includes('overlay') || search.includes('overlay=true');
  return isOverlay && new URLSearchParams(search).get('audio') === '1';
}

// ¿Esta página es un overlay al que se le pidió sonido? En el panel (y en sus
// vistas previas) siempre es false: ahí el sonido lo pone el propio panel.
export function overlayAudioAllowed() {
  if (typeof window === 'undefined') return false;
  return overlayAudioFromLocation(window.location);
}
