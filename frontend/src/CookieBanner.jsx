import { useEffect, useState } from 'react';
import { loadConsent, saveConsent, onOpenCookieSettings } from './cookieConsent';

// Aviso de cookies: aparece abajo la primera vez (y cuando se pide desde
// "Preferencias de anuncios"), sin tapar el panel. Dos botones del mismo
// peso, para que elegir lo menos invasivo sea igual de fácil que aceptar.
// Nunca en el overlay de OBS (ahí no hay anuncios ni nadie que elija).
export default function CookieBanner({ onNavigate }) {
  const [open, setOpen] = useState(() => !loadConsent());
  useEffect(() => onOpenCookieSettings(() => setOpen(true)), []);
  if (!open) return null;

  const choose = (ads) => { saveConsent(ads); setOpen(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pointer-events-none">
      <section
        role="dialog" aria-modal="false" aria-labelledby="cookie-title"
        className="theme-surface tkc-rise pointer-events-auto mx-auto w-full max-w-2xl p-4 sm:p-5 flex flex-col gap-3"
      >
        <h2 id="cookie-title" className="theme-label text-xs uppercase tracking-widest font-black">Cookies y anuncios</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          BenjaApis guarda en tu navegador solo lo necesario para que el panel funcione (tu sesión, tu tema) y cuenta las visitas sin cookies.
          Las funciones gratis muestran anuncios de Google y Adsterra, que pueden usar cookies. Puedes pedir anuncios no personalizados.{' '}
          <a href="/cookies" onClick={(e) => { e.preventDefault(); onNavigate?.('cookies'); }} className="theme-link theme-link-info !p-0 !text-xs">Más información</a>
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={() => choose('non_personalized')} className="theme-btn-secondary theme-btn-md flex-1 font-black uppercase tracking-widest">
            Anuncios no personalizados
          </button>
          <button type="button" onClick={() => choose('all')} className="theme-btn-secondary theme-btn-md flex-1 font-black uppercase tracking-widest">
            Aceptar todo
          </button>
        </div>
      </section>
    </div>
  );
}
