// Reloj del motor de voz que sigue andando con la pestaña oculta.
//
// Chrome frena los setInterval/setTimeout de una pestaña oculta: al rato los
// deja correr una vez por segundo y, pasados unos 5 minutos, una vez por
// MINUTO. El TTS dependía de esos relojes para destrabar la cola cuando el
// navegador no avisa que terminó un mensaje, así que con el panel en otra
// pestaña la voz se atrasaba y los mensajes vencían sin leerse. Los relojes de
// un Web Worker no se frenan así: el worker solo avisa "tic" y el trabajo se
// hace aquí, en la página. Si el navegador no deja crear el worker, se usa un
// setInterval normal (funciona igual con la pestaña visible).
export function createTicker(intervalMs, onTick) {
  let worker = null;
  let url = null;
  let fallbackId = null;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      throw new Error('sin Worker');
    }
    const source = `setInterval(function () { postMessage(0); }, ${Math.max(100, Number(intervalMs) || 1000)});`;
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.onerror = () => {
      // Un worker que no arranca (política del sitio, extensión): se pasa al
      // reloj normal sin perder el motor.
      stopWorker();
      if (!fallbackId) fallbackId = setInterval(onTick, intervalMs);
    };
  } catch {
    stopWorker();
    fallbackId = setInterval(onTick, intervalMs);
  }

  function stopWorker() {
    try { worker?.terminate(); } catch { /* ya cerrado */ }
    worker = null;
    if (url) { try { URL.revokeObjectURL(url); } catch { /* sin efecto */ } }
    url = null;
  }

  return () => {
    stopWorker();
    if (fallbackId) clearInterval(fallbackId);
    fallbackId = null;
  };
}
