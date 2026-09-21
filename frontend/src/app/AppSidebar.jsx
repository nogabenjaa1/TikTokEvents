import logoMark from '../assets/logo-mark.png';
import { SECTIONS } from './navigation';

// Botón del rail principal (pedido explícito: navegación profesional). En
// mobile es una pastilla algo más ancha que alta para que entre el nombre
// completo sin apretarse con el vecino; en desktop, un cuadro de ancho fijo.
const NAV_BTN = 'theme-nav-btn min-w-[64px] md:w-[68px] h-[52px] px-2 md:px-1 rounded-[14px] border flex flex-col items-center justify-center gap-1 transition-all duration-200 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const NAV_LABEL = 'text-[9px] font-bold uppercase tracking-wide text-center leading-tight whitespace-nowrap';

// Rail principal: las secciones de primer nivel, el acceso de administración y entrar/salir. Todo el estado
// (sección actual, sesión, si hay un juego corriendo) lo pone App.jsx.
export default function AppSidebar({ sidebarMode, onNavigate, session, gameRunning, onEnter, onLogout }) {
  // Mobile: rail horizontal arriba, scrolleable, en el flujo normal.
  // Desktop (md:): el rail vertical fijo de siempre, sin cambios.
  return (
    <aside aria-label="Navegación principal" className="theme-sidebar tkc-mobile-flush flex flex-row md:flex-col items-center gap-2 w-full md:w-[84px] min-h-0 md:min-h-screen py-2 px-2 md:py-4 md:px-0 flex-shrink-0 overflow-x-auto md:overflow-visible z-50 tkc-no-scrollbar">
      {/* Logo + nombre de marca — chico y sin botón/borde a propósito
          (pedido explícito: "visible pero que no abrume"), primero en la
          fila/columna para que quede como una cabecera sutil del rail de
          navegación, no como un botón más. El nombre va acá porque este
          rail es lo único presente en TODOS los paneles (pedido
          explícito: "asegurate que benjaapis salga en todos los
          paneles"). */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 md:mb-1">
        <img src={logoMark} alt="" className="h-7 md:h-8 w-auto" />
        <span className="text-[8px] font-black uppercase tracking-wider text-gray-500 text-center leading-none">BenjaApis</span>
      </div>
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onNavigate(s.id)}
          aria-current={sidebarMode === s.id ? 'page' : undefined}
          title={s.id === 'events' ? 'TikTokEvents: juegos, alertas, TTS y más' : s.label}
          className={[NAV_BTN, sidebarMode === s.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent'].join(' ')}
        >
          <span className="text-xl leading-none" aria-hidden="true">{s.icon}</span>
          <span className={[NAV_LABEL, sidebarMode === s.id ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
            {s.label}
          </span>
        </button>
      ))}

      {session?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('licenses')}
          title="Administrar licencias"
          aria-current={sidebarMode === 'licenses' ? 'page' : undefined}
          className={[NAV_BTN, sidebarMode === 'licenses' ? 'theme-nav-btn-active' : 'bg-transparent border-transparent'].join(' ')}
        >
          <span className="text-xl leading-none" aria-hidden="true">🔑</span>
          <span className={[NAV_LABEL, sidebarMode === 'licenses' ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
            Licencias
          </span>
        </button>
      )}

      {session?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('system')}
          title="Estado del servidor, errores, historial y pagos"
          aria-current={sidebarMode === 'system' ? 'page' : undefined}
          className={[NAV_BTN, sidebarMode === 'system' ? 'theme-nav-btn-active' : 'bg-transparent border-transparent'].join(' ')}
        >
          <span className="text-xl leading-none" aria-hidden="true">🛠️</span>
          <span className={[NAV_LABEL, sidebarMode === 'system' ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
            Sistema
          </span>
        </button>
      )}

      <div className="hidden md:block flex-1" />
      {!session && (
        <button type="button" onClick={onEnter} title="Inicia sesión o prueba gratis"
          className={[NAV_BTN, 'theme-btn-primary'].join(' ')}>
          <span className="text-xl leading-none" aria-hidden="true">🔑</span>
          <span className={NAV_LABEL}>Entrar</span>
        </button>
      )}
      {session && (
        <button type="button"
          onClick={() => {
            if (gameRunning && !window.confirm('Hay un juego activo. Si cierras sesión se detendrá. ¿Cerrar sesión de todos modos?')) return;
            onLogout();
          }}
          title="Cerrar sesión"
          className="min-w-[64px] md:w-[68px] h-[52px] px-2 md:px-1 rounded-[14px] border border-transparent hover:bg-red-950/40 hover:border-red-900/50 flex flex-col items-center justify-center gap-1 transition-all duration-200 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          <span className="text-xl leading-none" aria-hidden="true">🚪</span>
          <span className={[NAV_LABEL, 'text-gray-500'].join(' ')}>Salir</span>
        </button>
      )}
    </aside>
  );
}
