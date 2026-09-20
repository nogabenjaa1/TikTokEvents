import { useMemo, useState } from 'react';
import { expiryNotice, dismissalKey } from './expiry';

const STORAGE_KEY = 'tkc_expiry_dismissed';

function readDismissed() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Franja superior que avisa que la licencia está por vencer y lleva directo a
// renovar (antes decía "contacta al administrador", pero ya se puede pagar
// desde Membresía). Se puede cerrar y vuelve al día siguiente; no se muestra
// en la propia pantalla de Membresía, donde el usuario ya está renovando.
export default function ExpiryBanner({ session, onRenew, hidden = false }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const notice = useMemo(() => expiryNotice(session), [session]);
  if (hidden || !notice) return null;
  const key = dismissalKey(session);
  if (dismissed === key) return null;

  const urgent = notice.level === 'urgent';
  const close = () => {
    setDismissed(key);
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* sin almacenamiento: solo se cierra por ahora */ }
  };

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`w-full border-b-2 text-[11px] py-2 px-3 flex-shrink-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 ${urgent ? 'bg-red-500/15 border-red-500' : 'bg-amber-500/15 border-amber-500'}`}
    >
      <span className="font-bold tracking-wide text-white"><span aria-hidden="true">{urgent ? '⚠️' : '⏳'} </span>{notice.message}</span>
      <span className="hidden sm:inline text-gray-300">{notice.detail}</span>
      <button type="button" onClick={onRenew} className="theme-btn-primary px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
        {notice.trial ? 'Elegir un plan' : 'Renovar'}
      </button>
      <button type="button" onClick={close} aria-label="Cerrar aviso de vencimiento" className="leading-none px-1 text-white">✕</button>
    </div>
  );
}
