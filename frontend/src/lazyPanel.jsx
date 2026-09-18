import { lazy, Suspense, Component } from 'react';

// Carga perezosa de paneles (mejora de rendimiento): antes TODO el sitio
// (pagos, Downloader, licencias, etc.) viajaba en un solo paquete de ~600 kB,
// incluso para el overlay de OBS que no usa nada de eso. Ahora cada panel
// pesado es su propio archivo que se descarga solo al abrirlo.
//
// Al desplegar una versión nueva, los archivos con hash de la anterior dejan
// de existir: un panel abierto hace rato intentaría cargar un archivo que ya
// no está. En ese caso se recarga la página UNA vez (para tomar la versión
// nueva) y, si aun así falla, se muestra un mensaje en vez de dejar todo en
// blanco.
const RELOAD_FLAG = 'tkc_chunk_reloaded';

function importWithRecovery(factory) {
  return factory()
    .then((mod) => {
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* sin storage */ }
      return mod;
    })
    .catch((err) => {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch { /* sin storage: no se puede recordar el intento, se muestra el error */ }
      if (!alreadyReloaded) {
        window.location.reload();
        return new Promise(() => {}); // la página se recarga; no se resuelve
      }
      throw err;
    });
}

class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-bold text-white">No se pudo cargar esta sección.</p>
        <p className="text-xs text-gray-500">Revisa tu conexión a internet y vuelve a intentarlo.</p>
        <button type="button" onClick={() => window.location.reload()} className="theme-btn-primary px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest">
          Recargar
        </button>
      </div>
    );
  }
}

function PanelLoading() {
  return (
    <div role="status" className="flex-1 flex items-center justify-center p-10 text-sm text-gray-500">
      Cargando...
    </div>
  );
}

// Devuelve un componente que se usa igual que el original (mismas props);
// el Suspense vive DENTRO, así la barra de navegación de al lado no parpadea
// mientras el panel se descarga.
export function lazyPanel(factory) {
  const Lazy = lazy(() => importWithRecovery(factory));
  return function LazyPanel(props) {
    return (
      <PanelErrorBoundary>
        <Suspense fallback={<PanelLoading />}>
          <Lazy {...props} />
        </Suspense>
      </PanelErrorBoundary>
    );
  };
}
