import { useLayoutEffect, useRef, useState } from 'react';

// Botón de acción que valida algo (entrar, conectar, pagar) y cuenta el
// resultado con su propia forma en vez de cambiar solo el texto (ver
// DESIGN.md › Motion):
//   idle    -> el botón de siempre, a lo ancho de su contenedor;
//   loading -> se encoge a un círculo con un arco girando;
//   success -> el arco se cierra y se dibuja una palomita;
//   error   -> vuelve a su forma con un vaivén corto (el mensaje va aparte).
// Mientras valida NO se deshabilita (un botón deshabilitado se ve apagado y
// eso no es lo que está pasando): el que lo usa ignora clics repetidos.
const STATUS_TEXT = { loading: 'Verificando…', success: 'Listo', error: '' };

export default function MorphButton({ status = 'idle', loadingLabel, children, className = '', style, ...props }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(null);
  const collapsed = status === 'loading' || status === 'success';

  // El círculo mide lo mismo que el alto del botón, sea cual sea su talla.
  useLayoutEffect(() => {
    if (ref.current && !collapsed) setHeight(ref.current.offsetHeight);
  }, [collapsed, children]);

  return (
    <button
      ref={ref}
      {...props}
      data-status={status}
      aria-busy={status === 'loading'}
      className={`tkc-morph ${className}`}
      style={{ width: collapsed && height ? height : '100%', ...(collapsed ? { paddingInline: 0 } : null), ...style }}
    >
      <span className="tkc-morph-label">{children}</span>
      <span className="tkc-morph-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle className="tkc-morph-ring" cx="12" cy="12" r="10" />
          <path className="tkc-morph-check" d="M7.5 12.5l3 3 6-6.5" />
        </svg>
      </span>
      <span className="sr-only" role="status">{status === 'loading' ? (loadingLabel || STATUS_TEXT.loading) : STATUS_TEXT[status] || ''}</span>
    </button>
  );
}
