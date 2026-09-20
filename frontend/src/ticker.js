// Llama a `fn` cada `ms` desde un Web Worker. Los Workers no sufren el
// frenado de temporizadores que aplican los navegadores (y los embebidos de
// OBS o TikTok Studio) a las páginas que no se están pintando: un
// setInterval normal ahí puede pasar a dispararse una vez por minuto, o
// quedar congelado. El mensaje del Worker sí llega al hilo principal a
// tiempo. Sin Worker (o si el navegador lo bloquea), cae en setInterval.
// Devuelve la función que lo detiene.
export function createTicker(fn, ms = 250) {
  let worker = null;
  let objectUrl = null;
  let fallback = null;

  const startFallback = () => {
    if (fallback === null) fallback = setInterval(fn, ms);
  };

  try {
    const source = `const t = setInterval(() => postMessage(0), ${ms}); onmessage = () => clearInterval(t);`;
    objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(objectUrl);
    worker.onmessage = () => fn();
    worker.onerror = () => { try { worker.terminate(); } catch { /* ya cerrado */ } worker = null; startFallback(); };
  } catch {
    startFallback();
  }

  return () => {
    if (worker) { try { worker.postMessage(0); worker.terminate(); } catch { /* ya cerrado */ } }
    if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch { /* nada que liberar */ } }
    if (fallback !== null) clearInterval(fallback);
    worker = null; objectUrl = null; fallback = null;
  };
}
