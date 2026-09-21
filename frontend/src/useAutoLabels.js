import { useEffect } from 'react';

// Red de seguridad de accesibilidad: hay muchos campos (numéricos de tiempo,
// filas de premios, buscadores) cuya etiqueta es un texto vecino pero no está
// enlazada con `<label>`, así que un lector de pantalla los lee como "campo de
// edición" sin más. Este hook les pone un aria-label sacado del propio
// elemento (title, placeholder) o del texto visible más cercano. Solo toca los
// que NO tienen ya un nombre accesible, nunca pisa uno existente, y marca lo
// que puso con data-autolabel para que se pueda distinguir.

const CONTROLS = 'input:not([type="hidden"]), select, textarea';
const MAX_LEN = 60;

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

function hasName(el) {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return true;
  if (el.labels && el.labels.length > 0 && clean(el.labels[0].textContent)) return true;
  if (el.closest('label') && clean(el.closest('label').textContent)) return true;
  return false;
}

// Texto visible más cercano: hermano anterior, y si no hay, el del contenedor.
function guessLabel(el) {
  const own = clean(el.getAttribute('title')) || clean(el.getAttribute('placeholder'));
  if (own) return own;
  for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth += 1) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (!sibling.querySelector?.('input, select, textarea, button')) {
        const text = clean(sibling.textContent);
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }
  }
  const surface = el.closest('.theme-surface, section, form');
  const heading = surface?.querySelector('h1, h2, h3, legend, .theme-label');
  return clean(heading?.textContent) || '';
}

function labelPass(root) {
  root.querySelectorAll(CONTROLS).forEach((el) => {
    if (el.classList.contains('sr-only') && (el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
      // interruptores visuales: su nombre es el texto del <label> contenedor
      if (hasName(el)) return;
    }
    if (hasName(el)) return;
    const guess = guessLabel(el);
    if (guess) {
      el.setAttribute('aria-label', guess);
      el.setAttribute('data-autolabel', '');
    }
  });
}

// `enabled` en false (overlay de OBS) no hace nada: ahí no hay nadie usando
// un lector de pantalla y el overlay tiene que quedarse lo más quieto posible.
export default function useAutoLabels(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const root = document.body;
    // Un solo repaso por ráfaga de cambios (150 ms), no uno por cada mutación.
    let timer = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; labelPass(root); }, 150);
    };
    labelPass(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [enabled]);
}
