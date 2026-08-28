import React, { useEffect, useRef, useState } from 'react';
import AdIframeBanner from './AdIframeBanner';
import { INTERSTITIAL_AD_ZONE, INTERSTITIAL_MIN_WAIT_MS, INTERSTITIAL_AUTO_CLOSE_MS } from './adConfig';

// Interstitial propio: modal con un tiempo mínimo antes de poder cerrarlo,
// que muestra el banner 300x250 (ver AdIframeBanner.jsx — zona aislada en
// su propio iframe, no compite por el mismo contenedor con AdBanner). Si
// nadie lo cierra a mano, se cierra solo a los INTERSTITIAL_AUTO_CLOSE_MS —
// nunca debe quedar bloqueando el juego indefinidamente.
export default function InterstitialAd({ open, onDone, title = 'Un momento...' }) {
  const [canClose, setCanClose] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(INTERSTITIAL_MIN_WAIT_MS / 1000));

  // Ref para poder llamar siempre a la versión más reciente de onDone desde
  // el timer de auto-cierre sin meterlo en las deps del efecto de abajo —
  // onDone llega como una arrow function nueva en cada render del padre, así
  // que listarlo ahí reiniciaría los timers en cada re-render, no solo al
  // abrir/cerrar el modal.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!open) return;
    setCanClose(false);
    setSecondsLeft(Math.ceil(INTERSTITIAL_MIN_WAIT_MS / 1000));

    const tickInterval = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    const doneTimeout = setTimeout(() => setCanClose(true), INTERSTITIAL_MIN_WAIT_MS);
    const autoCloseTimeout = setTimeout(() => onDoneRef.current(), INTERSTITIAL_AUTO_CLOSE_MS);

    return () => {
      clearInterval(tickInterval);
      clearTimeout(doneTimeout);
      clearTimeout(autoCloseTimeout);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6 font-sans">
      <div className="theme-surface w-full max-w-sm p-6 flex flex-col items-center gap-4">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">{title}</p>
        <AdIframeBanner zone={INTERSTITIAL_AD_ZONE} active={open} />
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
