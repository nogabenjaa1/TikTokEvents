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
      <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest theme-accent-text">💡 ¿Cómo funciona?</summary>
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

// Marcador de posición mientras cargan listas (alertas, licencias): filas
// grises que laten en lugar de un texto suelto "Cargando...".
export function SkeletonRows({ count = 3, label = 'Cargando...' }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="theme-input h-12 animate-pulse opacity-60" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
