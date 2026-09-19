import { useCallback, useEffect, useRef, useState } from 'react';

// Fila horizontal desplazable SOLO por dentro (pestañas/íconos): la página no
// se mueve ni se ensancha. Sin barra de desplazamiento nativa; en su lugar:
//  - botones ‹ › que aparecen solo cuando hay más íconos a ese lado,
//  - arrastrar con el clic sostenido (mouse) o deslizar con el dedo,
//  - rueda del mouse / trackpad horizontal como siempre.
// Un arrastre no dispara el clic del botón sobre el que terminó.
const DRAG_THRESHOLD_PX = 6;
const ARROW_ANIM_MS = 260;

// Desplazamiento animado propio (scrollBy con behavior:'smooth' no anima en
// todos los entornos); respeta prefers-reduced-motion saltando directo.
function animateScrollLeft(el, target) {
  const start = el.scrollLeft;
  const max = el.scrollWidth - el.clientWidth;
  const end = Math.max(0, Math.min(max, target));
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || start === end) { el.scrollLeft = end; return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ARROW_ANIM_MS);
    const eased = 1 - (1 - p) * (1 - p);
    el.scrollLeft = start + (end - start) * eased;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // Red de seguridad: si el navegador pausa los cuadros de animación (pestaña
  // en segundo plano), igual termina en el destino.
  setTimeout(() => { el.scrollLeft = end; }, ARROW_ANIM_MS + 60);
}

export default function ScrollRow({ children, label, className = '' }) {
  const scrollerRef = useRef(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [dragging, setDragging] = useState(false);

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [update]);

  // El contenido puede cambiar (pestañas que aparecen/desaparecen).
  useEffect(() => { update(); });

  const scrollByPage = (dir) => {
    const el = scrollerRef.current;
    if (el) animateScrollLeft(el, el.scrollLeft + dir * Math.max(120, el.clientWidth * 0.7));
  };

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // el dedo ya desliza nativamente
    const el = scrollerRef.current;
    drag.current = { active: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
      d.moved = true;
      setDragging(true);
      scrollerRef.current.setPointerCapture?.(e.pointerId);
    }
    if (d.moved) scrollerRef.current.scrollLeft = d.startLeft - dx;
  };
  const endDrag = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    // `moved` se limpia recién después del clic que dispara el navegador al
    // soltar, para poder cancelarlo (ver onClickCapture).
    setTimeout(() => { drag.current.moved = false; }, 0);
  };
  const onClickCapture = (e) => {
    if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); }
  };

  const arrowClass = 'theme-btn-secondary absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full flex items-center justify-center text-base font-black shadow-md';

  return (
    <div className={`relative min-w-0 flex-1 overflow-hidden ${className}`}>
      {canLeft && (
        <button type="button" onClick={() => scrollByPage(-1)} aria-label="Ver los anteriores" className={`${arrowClass} left-0`}>‹</button>
      )}
      <nav
        ref={scrollerRef}
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className={`tkc-no-scrollbar flex flex-row items-center gap-2 overflow-x-auto select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ overscrollBehaviorX: 'contain' }}
      >
        {children}
      </nav>
      {canRight && (
        <button type="button" onClick={() => scrollByPage(1)} aria-label="Ver más" className={`${arrowClass} right-0`}>›</button>
      )}
    </div>
  );
}
