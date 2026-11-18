import { Fragment, useRef, useState } from 'react';
import logoMark from '../assets/logo-mark.webp';
import { NAV_AREAS, planLabel } from './navigation';
import NavIndicator from './NavIndicator';
import NavIcon from './NavIcon';
import ModalDialog from '../ModalDialog';

// Navegación principal, por áreas (ver NAV_AREAS en navigation.js).
// - Escritorio (md+): columna de 224px. Áreas agrupadas (Directo,
//   Herramientas, Cuenta, Administración); al pie, el estado de TikTok LIVE
//   (lleva a Inicio, donde se conecta) y la cuenta (lleva a Mi plan).
// - Celular: barra superior con la marca y el estado del LIVE, y una barra
//   inferior fija con las cuatro áreas de más uso y "Más" (el resto, en una
//   hoja). La tira desplazable de antes podía dejar la sección actual fuera de
//   la vista.
// Todo el estado lo pone App.jsx: `activeArea`, la sesión, la conexión.
const MOBILE_PRIMARY = ['home', 'games', 'interaction', 'overlays'];

const LIVE_TEXT = {
  connected: 'En vivo',
  connecting: 'Conectando…',
  checking: 'Buscando la cuenta…',
  error: 'Error de conexión',
};

function LiveStatus({ connectionStatus, onClick, compact = false }) {
  const live = connectionStatus === 'connected';
  const text = LIVE_TEXT[connectionStatus] || 'Sin conexión';
  return (
    <button
      type="button"
      onClick={onClick}
      title="Conexión con TikTok LIVE: ábrela en Inicio"
      className={`tkc-status-pill ${live ? 'tkc-status-live' : ''} ${compact ? '' : 'w-full justify-start'}`}
    >
      <span className="tkc-status-pip" aria-hidden="true" />
      <span className="sr-only">TikTok LIVE: </span>{text}
    </button>
  );
}

function confirmLogout(gameRunning, onLogout) {
  if (gameRunning && !window.confirm('Hay un juego activo. Si cierras sesión se detendrá. ¿Cerrar sesión de todos modos?')) return;
  onLogout();
}

export default function AppSidebar({ activeArea, onNavigate, session, gameRunning, connectionStatus, onEnter, onLogout }) {
  const railRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const areas = NAV_AREAS.filter((a) => !a.admin || session?.isAdmin);
  const go = (id) => { setMoreOpen(false); onNavigate(id); };
  const moreActive = !!activeArea && !MOBILE_PRIMARY.includes(activeArea);

  return (
    <>
      {/* ── Escritorio ── */}
      <aside ref={railRef} aria-label="Navegación principal" className="theme-sidebar tkc-rail">
        <NavIndicator containerRef={railRef} activeKey={activeArea} className="tkc-rail-indicator" />
        <div className="tkc-rail-brand">
          <img src={logoMark} alt="" className="h-7 w-auto" />
          <span className="tkc-rail-brand-name">BenjaApis</span>
        </div>
        {areas.map((a, i) => (
          <Fragment key={a.id}>
            {a.group && a.group !== areas[i - 1]?.group && <p className="tkc-rail-group" aria-hidden="true">{a.group}</p>}
            <button
              type="button"
              onClick={() => onNavigate(a.id)}
              aria-current={activeArea === a.id ? 'page' : undefined}
              className="theme-nav-btn tkc-nav-item tkc-rail-item"
            >
              <NavIcon name={a.icon} />
              <span className="tkc-rail-label">{a.label}</span>
            </button>
          </Fragment>
        ))}
        <div className="flex-1" />
        <div className="tkc-rail-foot">
          {session && <LiveStatus connectionStatus={connectionStatus} onClick={() => onNavigate('home')} />}
          {session ? (
            <div className="tkc-rail-account">
              <button type="button" onClick={() => onNavigate('membership')} className="tkc-rail-account-main" title="Ver tu plan">
                <span className="tkc-rail-account-name">@{session.username}</span>
                <span className="tkc-meta">{session.isAdmin ? 'Administrador' : planLabel(session.licenseType)}</span>
              </button>
              <button type="button" onClick={() => confirmLogout(gameRunning, onLogout)} className="tkc-rail-iconbtn" title="Cerrar sesión" aria-label="Cerrar sesión">
                <NavIcon name="exit" size={18} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={onEnter} className="theme-btn-primary theme-btn-md w-full font-bold">Entrar</button>
          )}
        </div>
      </aside>

      {/* ── Celular: barra superior ── */}
      <header className="tkc-mobilebar">
        <span className="flex items-center gap-2">
          <img src={logoMark} alt="" className="h-6 w-auto" />
          <span className="text-sm font-extrabold text-white">BenjaApis</span>
        </span>
        {session
          ? <LiveStatus compact connectionStatus={connectionStatus} onClick={() => onNavigate('home')} />
          : <button type="button" onClick={onEnter} className="theme-btn-primary theme-btn-sm font-bold">Entrar</button>}
      </header>

      {/* ── Celular: barra inferior ── */}
      <nav aria-label="Navegación principal" className="tkc-tabbar">
        {MOBILE_PRIMARY.map((id) => {
          const a = NAV_AREAS.find((x) => x.id === id);
          return (
            <button key={id} type="button" onClick={() => onNavigate(id)} aria-current={activeArea === id ? 'page' : undefined} className="tkc-tabbar-item">
              <NavIcon name={a.icon} size={22} />
              <span>{a.shortLabel || a.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-current={moreActive ? 'page' : undefined} className="tkc-tabbar-item">
          <NavIcon name="more" size={22} />
          <span>Más</span>
        </button>
      </nav>

      {moreOpen && (
        <ModalDialog onClose={() => setMoreOpen(false)} lightDismiss label="Más secciones" className="tkc-sheet">
          <div className="flex items-center justify-between mb-2">
            <p className="text-base font-bold text-white">Más secciones</p>
            <button type="button" onClick={() => setMoreOpen(false)} className="tkc-rail-iconbtn" aria-label="Cerrar">✕</button>
          </div>
          <ul className="flex flex-col">
            {areas.filter((a) => !MOBILE_PRIMARY.includes(a.id)).map((a, i, list) => (
              <li key={a.id}>
                {a.group !== list[i - 1]?.group && <p className="tkc-sheet-group">{a.group}</p>}
                <button type="button" onClick={() => go(a.id)} aria-current={activeArea === a.id ? 'page' : undefined} className="tkc-sheet-item">
                  <NavIcon name={a.icon} />
                  <span>{a.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {session ? (
            <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--surface-border-color)' }}>
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-white truncate">@{session.username}</span>
                <span className="tkc-meta">{session.isAdmin ? 'Administrador' : planLabel(session.licenseType)}</span>
              </span>
              <button type="button" onClick={() => { setMoreOpen(false); confirmLogout(gameRunning, onLogout); }} className="theme-btn-secondary theme-btn-sm font-bold">Cerrar sesión</button>
            </div>
          ) : (
            <button type="button" onClick={() => { setMoreOpen(false); onEnter(); }} className="theme-btn-primary theme-btn-md w-full mt-3 font-bold">Entrar</button>
          )}
        </ModalDialog>
      )}
    </>
  );
}
