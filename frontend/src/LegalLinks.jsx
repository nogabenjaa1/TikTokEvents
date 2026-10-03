import { openCookieSettings } from './cookieConsent';

// Enlaces entre las páginas legales (y en el pie de otras pantallas).
export default function LegalLinks({ onNavigate, className = '' }) {
  const go = (section) => (e) => { e.preventDefault(); onNavigate?.(section); };
  return (
    <nav aria-label="Información legal" className={`flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t ${className}`} style={{ borderColor: 'var(--surface-border-color)' }}>
      <a href="/aviso-legal" onClick={go('legal')} className="theme-link">Aviso legal</a>
      <a href="/privacidad" onClick={go('privacy')} className="theme-link">Aviso de privacidad</a>
      <a href="/cookies" onClick={go('cookies')} className="theme-link">Cookies</a>
      <button type="button" onClick={openCookieSettings} className="theme-link">Preferencias de anuncios</button>
    </nav>
  );
}
