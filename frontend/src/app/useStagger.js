import { useLayoutEffect } from 'react';

// Escalona la subida de las tarjetas de una vista (ver .tkc-view-enter
// .theme-surface en index.css): a cada `.theme-surface` le pone su turno
// (--tkc-i) en el orden en que aparece, así suben una tras otra en vez de
// todas juntas. Solo durante la entrada de la vista: una tarjeta que llega
// más tarde (porque terminó de cargar su dato) sube enseguida, sin hacer fila.
const ENTRY_WINDOW_MS = 700;

export default function useStagger(ref, key) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    let turn = 0;
    const start = performance.now();
    const number = (el) => {
      if (el.style.getPropertyValue('--tkc-i')) return;
      el.style.setProperty('--tkc-i', String(performance.now() - start < ENTRY_WINDOW_MS ? turn++ : 0));
    };
    root.querySelectorAll('.theme-surface').forEach(number);
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.classList.contains('theme-surface')) number(node);
          node.querySelectorAll?.('.theme-surface').forEach(number);
        });
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, key]);
}
