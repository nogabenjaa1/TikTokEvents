import { Component } from 'react';
import { ThemedShell } from './ThemeContext';
import { isOverlayMode } from './auth';
import {
  nextReloadState, OVERLAY_RELOAD_DELAY_MS, OVERLAY_RELOAD_DELAY_UNCOUNTED_MS, OVERLAY_RELOAD_WINDOW_MS,
} from './errorRecovery';

const RELOADS_KEY = 'tkc_overlay_error_reloads';

function ErrorFallback({ onRetry }) {
  return (
    <ThemedShell className="flex items-center justify-center p-6">
      <div role="alert" className="theme-surface w-full max-w-md p-6 text-center flex flex-col items-center gap-3">
        <p className="text-3xl" aria-hidden="true">🛠️</p>
        <h1 className="theme-heading text-lg font-black">Algo salió mal en esta pantalla</h1>
        <p className="text-xs text-gray-400 leading-relaxed">
          No se pudo mostrar. Tu sesión y tus ajustes están a salvo: recarga la página para continuar.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-1">
          <button type="button" onClick={() => window.location.reload()} className="theme-btn-primary px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest">
            Recargar la página
          </button>
          <button type="button" onClick={onRetry} className="theme-btn-secondary px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest">
            Intentar de nuevo
          </button>
        </div>
      </div>
    </ThemedShell>
  );
}

// Última red de seguridad de la interfaz: si algo falla al dibujar una pantalla,
// el error queda aquí en vez de dejar toda la página en blanco. En el panel
// avisa y ofrece recargar. En un overlay de OBS no muestra nada (un overlay roto
// se vería en el directo) y se recarga solo, con un tope por minuto (ver
// errorRecovery.js) para no entrar en un bucle si el error es fijo.
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
    this.reloadTimer = null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[Interfaz] Error al dibujar la pantalla:', error, info?.componentStack);
    if (isOverlayMode()) this.scheduleOverlayReload();
  }

  // A propósito sin componentWillUnmount que cancele el temporizador: este límite
  // es la raíz de la app y no se desmonta nunca de verdad, y el modo estricto de
  // React (en desarrollo) simula un desmontaje justo después de montar, que
  // cancelaría la recarga antes de que llegue.
  scheduleOverlayReload() {
    let delay = OVERLAY_RELOAD_DELAY_UNCOUNTED_MS;
    try {
      const { allowed, state } = nextReloadState(sessionStorage.getItem(RELOADS_KEY));
      sessionStorage.setItem(RELOADS_KEY, state);
      // Pasado el tope no se recarga en cadena, pero tampoco se abandona el overlay
      // en blanco: se reintenta una vez cuando termina la ventana (un fallo pasajero
      // se arregla solo; uno fijo cuesta una recarga por minuto).
      delay = allowed ? OVERLAY_RELOAD_DELAY_MS : OVERLAY_RELOAD_WINDOW_MS;
    } catch {
      // Sin almacenamiento no se pueden contar las recargas: se espera más entre una y otra.
    }
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => window.location.reload(), delay);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (isOverlayMode()) return null;
    return <ErrorFallback onRetry={() => this.setState({ failed: false })} />;
  }
}
