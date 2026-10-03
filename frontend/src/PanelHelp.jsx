import { useState } from 'react';

// Ayudas compartidas por los paneles de juegos/contadores (Rey del Trono,
// Zubastinis, Eliminación, Ruleta, Extensible, Objetivo): una explicación
// corta de "cómo funciona" para quien es nuevo y un aviso claro de por qué
// INICIAR está deshabilitado.

// `storageKey`: id del panel; si el streamer la cierra, recuerda que la cerró
// (así a quien ya sabe cómo funciona no le estorba en cada visita).
export function HowItWorks({ storageKey, children }) {
  const key = `tkc_help_closed_${storageKey}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '1'; } catch { return true; }
  });
  const onToggle = (e) => {
    const nowOpen = e.currentTarget.open;
    setOpen(nowOpen);
    try { localStorage.setItem(key, nowOpen ? '0' : '1'); } catch { /* sin storage */ }
  };
  return (
    <details open={open} onToggle={onToggle} className="theme-input mb-6 px-4 py-3">
      <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest theme-accent-text">¿Cómo funciona?</summary>
      <div className="mt-2 text-xs text-gray-400 leading-relaxed space-y-2">{children}</div>
    </details>
  );
}

// Aviso encima del botón INICIAR mientras todavía no hay un LIVE conectado.
// A propósito no bloquea nada de los ajustes: solo explica qué falta.
// `error`: mensaje al intentar iniciar sin algo obligatorio (regalo, palabra
// clave...) -- reemplaza a los antiguos alert() del navegador.
export function StartRequirement({ connectionStatus, active, error }) {
  const needsLive = !(active || connectionStatus === 'connected');
  const connecting = connectionStatus === 'connecting' || connectionStatus === 'checking';
  return (
    <>
      {error && <p role="alert" className="text-[11px] text-red-500 font-bold mb-3 leading-snug">{error}</p>}
      {needsLive && (
        <p role="status" className="text-[11px] text-amber-500 font-bold mb-3 leading-snug">
          {connecting
            ? 'Conectando con tu LIVE... en cuanto se confirme podrás iniciar.'
            : 'Para iniciar necesitas estar conectado a un LIVE (hazlo desde el Dashboard). Mientras tanto puedes dejar todo configurado.'}
        </p>
      )}
    </>
  );
}

// Marcadores de carga (ver .tkc-skeleton en index.css): bloques del color de
// los campos que laten despacio con la forma aproximada de lo que viene, en
// lugar de un texto suelto "Cargando...". Cuando llega el dato, lo que lo
// reemplaza sube con .tkc-reveal.
export function SkeletonRows({ count = 3, label = 'Cargando...', height = 'h-12' }) {
  return (
    <div role="status" aria-label={label} className="tkc-skeleton flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`tkc-skeleton-block ${height}`} style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Grilla de cifras (Sistema, resumen del negocio).
export function SkeletonKpis({ count = 4, label = 'Cargando...', className = 'grid grid-cols-2 md:grid-cols-4 gap-2' }) {
  return (
    <div role="status" aria-label={label} className={`tkc-skeleton ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tkc-skeleton-block h-20" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
