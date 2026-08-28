import React, { useEffect, useRef, useState } from 'react';
import { NATIVE_BANNER_SCRIPT_SRC, NATIVE_BANNER_CONTAINER_ID, INTERSTITIAL_MIN_WAIT_MS } from './adConfig';

// Interstitial propio armado alrededor del NativeBanner de Adsterra:
// Adsterra no ofrece un formato de interstitial de video nativo para sitios
// web comunes, así que se simula montando el banner nativo dentro de un
// modal con un tiempo mínimo antes de poder cerrarlo. El contenedor y el
// script se recrean en cada apertura (en vez de reusar uno fijo) para que
// Adsterra lo trate como una inyección nueva, igual que en una carga de
// página — reusar el mismo nodo entre aperturas no garantiza que el script
// vuelva a poblarlo.
export default function InterstitialAd({ open, onDone, title = 'Un momento...' }) {
  const mountRef = useRef(null);
  const [canClose, setCanClose] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(INTERSTITIAL_MIN_WAIT_MS / 1000));

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!open || !mountNode) return;
    setCanClose(false);
    setSecondsLeft(Math.ceil(INTERSTITIAL_MIN_WAIT_MS / 1000));

    const container = document.createElement('div');
    container.id = NATIVE_BANNER_CONTAINER_ID;
    mountNode.appendChild(container);

    const script = document.createElement('script');
    script.async = true;
    script.dataset.cfasync = 'false';
    script.src = NATIVE_BANNER_SCRIPT_SRC;
    mountNode.appendChild(script);

    const tickInterval = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    const doneTimeout = setTimeout(() => setCanClose(true), INTERSTITIAL_MIN_WAIT_MS);

    return () => {
      clearInterval(tickInterval);
      clearTimeout(doneTimeout);
      mountNode.replaceChildren();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6 font-sans">
      <div className="theme-surface w-full max-w-sm p-6 flex flex-col items-center gap-4">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">{title}</p>
        <div ref={mountRef} className="w-full min-h-[100px] flex items-center justify-center" />
        <button
          onClick={() => canClose && onDone()}
          disabled={!canClose}
          className="theme-btn-primary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {canClose ? 'Continuar' : `Disponible en ${secondsLeft}s`}
        </button>
      </div>
    </div>
  );
}
