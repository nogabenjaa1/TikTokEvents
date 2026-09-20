import { useEffect, useState } from 'react';
import { unlockSounds } from './sounds';

// El navegador no deja reproducir sonido en una página hasta que la persona
// interactúa con ella (política de autoplay). Como el panel es quien pone todo
// el sonido, si se acaba de abrir o recargar y todavía no hubo ningún clic, las
// alertas sonarían mudas sin avisar. Este aviso lo dice y se quita solo con el
// primer clic o tecla en cualquier parte de la pestaña.
export default function AudioUnlockBanner({ enabled }) {
  const alreadyActive = () => typeof navigator !== 'undefined' && !!navigator.userActivation?.hasBeenActive;
  const [blocked, setBlocked] = useState(() => enabled && !alreadyActive());

  useEffect(() => {
    if (!enabled || alreadyActive()) { setBlocked(false); return undefined; }
    setBlocked(true);
    const unlock = () => { unlockSounds(); setBlocked(false); };
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((name) => window.addEventListener(name, unlock, { once: true, passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, unlock));
  }, [enabled]);

  if (!blocked) return null;
  return (
    <div role="status" className="w-full border-b-2 bg-amber-500/15 border-amber-500 text-[11px] py-2 px-3 flex-shrink-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      <span className="font-bold tracking-wide text-white"><span aria-hidden="true">🔇 </span>El sonido de las alertas está esperando tu primer clic.</span>
      <span className="hidden sm:inline text-gray-300">Tu navegador no deja reproducir audio hasta que interactúes con esta pestaña.</span>
      <button type="button" onClick={() => { unlockSounds(); setBlocked(false); }} className="theme-btn-primary px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
        Activar sonido
      </button>
    </div>
  );
}
