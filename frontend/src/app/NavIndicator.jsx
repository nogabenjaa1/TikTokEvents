import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

// Fondo del botón activo que se desliza de un módulo al otro en vez de
// aparecer de golpe (ver DESIGN.md › Motion). Va DENTRO del contenedor de
// los botones (que tiene que ser `position: relative`, y si se desplaza, el
// mismo elemento que se desplaza) y sigue al que tenga
// `.tkc-nav-item[aria-current="page"]`. Lleva las clases del botón activo de
// siempre, así que cada material lo pinta como antes.
//
// Solo se anima cuando cambia el módulo: al aparecer por primera vez o al
// cambiar el tamaño de la ventana se coloca directo, sin viajar desde la
// esquina.
const sameBox = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export default function NavIndicator({ containerRef, activeKey, className = '' }) {
  const [box, setBox] = useState({ pos: null, animate: false });

  const measure = useCallback((animate) => {
    const container = containerRef.current;
    const el = container?.querySelector('.tkc-nav-item[aria-current="page"]');
    const next = el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
    setBox((prev) => {
      if (sameBox(prev.pos, next)) return prev;
      return { pos: next, animate: animate && !!prev.pos && !!next };
    });
  }, [containerRef]);

  useLayoutEffect(() => { measure(true); }, [measure, activeKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onResize = () => measure(false);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(container);
    window.addEventListener('resize', onResize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', onResize); };
  }, [containerRef, measure]);

  const { pos, animate } = box;
  return (
    <span
      aria-hidden="true"
      data-ready={pos ? 'true' : 'false'}
      data-animate={animate ? 'true' : 'false'}
      className={`tkc-nav-indicator theme-nav-btn-active ${className}`}
      style={pos ? { width: pos.w, height: pos.h, transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}
    />
  );
}
