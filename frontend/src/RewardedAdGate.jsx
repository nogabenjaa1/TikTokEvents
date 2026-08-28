import React, { useEffect, useRef, useState } from 'react';
import { SMARTLINK_URL, REWARD_MIN_WAIT_MS } from './adConfig';

// Gate de recompensa: Adsterra no tiene un formato de rewarded-video nativo
// para sitios web comunes, así que se simula con un Smartlink — se abre en
// una pestaña nueva y se exige un tiempo mínimo antes de poder reclamar la
// recompensa, para evitar el "abrir y cerrar" instantáneo. No es infalible,
// es una barrera proporcional al beneficio que desbloquea (7 días de prueba,
// o 1h sin ads en Color Says).
export default function RewardedAdGate({ open, onClaim, onCancel, title, description }) {
  const [watching, setWatching] = useState(false);
  const [ready, setReady] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(REWARD_MIN_WAIT_MS / 1000));
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  const reset = () => {
    clearTimeout(timeoutRef.current);
    clearInterval(intervalRef.current);
    setWatching(false);
    setReady(false);
  };

  // Solo hace falta limpiar los timers al desmontar — cerrar el gate
  // siempre pasa por claim() o el botón Cancelar, que ya llaman a reset()
  // antes de avisarle al padre, así que nunca queda a medias.
  useEffect(() => reset, []);

  if (!open) return null;

  const startWatch = () => {
    window.open(SMARTLINK_URL, '_blank', 'noopener,noreferrer');
    setWatching(true);
    setReady(false);
    setSecondsLeft(Math.ceil(REWARD_MIN_WAIT_MS / 1000));
    intervalRef.current = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    timeoutRef.current = setTimeout(() => {
      setReady(true);
      clearInterval(intervalRef.current);
    }, REWARD_MIN_WAIT_MS);
  };

  const claim = () => {
    reset();
    onClaim();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6 font-sans">
      <div className="theme-surface w-full max-w-sm p-6 flex flex-col gap-4">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">{title}</p>
        {description && <p className="text-[11px] text-gray-500 leading-snug">{description}</p>}

        {!watching ? (
          <button
            onClick={startWatch}
            className="theme-btn-primary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
          >
            Ver anuncio
          </button>
        ) : (
          <button
            onClick={() => ready && claim()}
            disabled={!ready}
            className="theme-btn-primary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {ready ? 'Reclamar recompensa' : `Disponible en ${secondsLeft}s`}
          </button>
        )}

        <button
          onClick={() => { reset(); onCancel(); }}
          className="theme-btn-secondary w-full py-2 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
