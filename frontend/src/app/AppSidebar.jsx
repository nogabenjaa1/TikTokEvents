import { useRef } from 'react';
import logoMark from '../assets/logo-mark.webp';
import { SECTIONS } from './navigation';
import NavIndicator from './NavIndicator';
import NavIcon from './NavIcon';

// Barra de navegación principal. En escritorio (md:) es una columna de 224px
// con ícono y nombre en la misma fila, como en cualquier herramienta de
// trabajo: se lee de un vistazo sin adivinar íconos. En el celular es una
// fila desplazable arriba, con el nombre bajo el ícono. Todo el estado
// (sección actual, sesión, si hay un juego corriendo) lo pone App.jsx.
const NAV_ITEM = 'theme-nav-btn tkc-nav-item tkc-rail-item';

function NavButton({ id, label, title, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={title}
      className={NAV_ITEM}
    >
      <NavIcon name={id} />
      <span className="tkc-rail-label">{label}</span>
    </button>
  );
}

export default function AppSidebar({ sidebarMode, onNavigate, session, gameRunning, onEnter, onLogout }) {
  const railRef = useRef(null);
  return (
    <aside ref={railRef} aria-label="Navegación principal" className="theme-sidebar tkc-rail tkc-no-scrollbar">
      {/* El fondo del módulo activo: se desliza al elegido (ver NavIndicator). */}
      <NavIndicator containerRef={railRef} activeKey={sidebarMode} className="tkc-rail-indicator" />
      {/* La marca va en el único elemento presente en todos los paneles. */}
      <div className="tkc-rail-brand">
        <img src={logoMark} alt="" className="h-7 w-auto" />
        <span className="tkc-rail-brand-name">BenjaApis</span>
      </div>

      {SECTIONS.map((s) => (
        <NavButton
          key={s.id}
          id={s.id}
          label={s.label}
          title={s.id === 'events' ? 'TikTokEvents: juegos, alertas, TTS y más' : undefined}
          active={sidebarMode === s.id}
          onClick={() => onNavigate(s.id)}
        />
      ))}

      {session?.isAdmin && (
        <>
          <p className="tkc-rail-group" aria-hidden="true">Administración</p>
          <NavButton id="licenses" label="Licencias" title="Administrar licencias" active={sidebarMode === 'licenses'} onClick={() => onNavigate('licenses')} />
          <NavButton id="system" label="Sistema" title="Estado del servidor, errores, historial y pagos" active={sidebarMode === 'system'} onClick={() => onNavigate('system')} />
        </>
      )}

      <div className="hidden md:block flex-1" />
      {!session && (
        <button type="button" onClick={onEnter} title="Inicia sesión con tu clave" className="tkc-rail-item tkc-rail-action">
          <NavIcon name="enter" />
          <span className="tkc-rail-label">Entrar</span>
        </button>
      )}
      {session && (
        <button
          type="button"
          onClick={() => {
            if (gameRunning && !window.confirm('Hay un juego activo. Si cierras sesión se detendrá. ¿Cerrar sesión de todos modos?')) return;
            onLogout();
          }}
          title="Cerrar sesión"
          className="tkc-rail-item tkc-rail-action tkc-rail-exit"
        >
          <NavIcon name="exit" />
          <span className="tkc-rail-label">Salir</span>
        </button>
      )}
    </aside>
  );
}
