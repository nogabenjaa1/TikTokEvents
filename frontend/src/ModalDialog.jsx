import { useLayoutEffect, useRef } from 'react';

// Ventana modal con el <dialog> nativo abierto con showModal(): el navegador
// pone la página de atrás inerte, encierra el foco dentro, la dibuja encima
// de todo (capa superior, sin pelear con z-index), la cierra con Esc o el
// gesto "atrás" del celular y devuelve el foco al botón que la abrió. Antes
// cada ventana era un <div> fijo con role="dialog" hecho a mano: el foco se
// escapaba a la página de atrás y casi ninguna se cerraba con Esc.
//
// La ventana existe mientras el componente está montado: el padre la abre
// montándola y la cierra desmontándola (en onClose).
// - `dismissible`: Esc / atrás la cierran (llaman a onClose). En false (un
//   anuncio que hay que esperar), no se cierra con nada salvo sus botones.
// - `lightDismiss`: además, tocar fuera de la ventana la cierra.
// - `labelledBy` / `label`: nombre de la ventana para lectores de pantalla.
// - `className`: clases del recuadro (el <dialog> es el recuadro).

const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

// Si el puntero está fuera del recuadro. Se mira la posición y no el destino
// del evento: el <dialog> también es el destino de su propio relleno.
function isOutside(event, dialog) {
  const r = dialog.getBoundingClientRect();
  return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
}

export default function ModalDialog({ onClose, dismissible = true, lightDismiss = false, labelledBy, label, className = '', children }) {
  const ref = useRef(null);
  const pressedOutside = useRef(false);

  // useLayoutEffect y no useEffect: su limpieza corre ANTES de que React quite
  // el <dialog> de la página. Cerrado todavía conectado, el navegador devuelve
  // el foco al botón que lo abrió; quitado primero, el foco se pierde.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  // Esc / atrás: el padre decide (desmontando). preventDefault para que el
  // navegador no la cierre por su cuenta y el estado de React no se desfase.
  const onCancel = (event) => {
    event.preventDefault();
    if (dismissible) onClose?.();
  };

  // Algunos navegadores cierran igual tras varios Esc seguidos. Si pasa, se
  // avisa al padre; si la ventana no se puede cerrar, se vuelve a abrir.
  const onDialogClose = () => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dismissible) onClose?.();
    else if (dialog.isConnected) dialog.showModal();
  };

  // Tocar fuera para cerrar donde el navegador no tiene closedby (Safari).
  // Se exige que el toque empiece y termine fuera, para que arrastrar una
  // selección de texto hasta el fondo no cierre la ventana.
  const fallbackLightDismiss = lightDismiss && dismissible && !supportsClosedBy;
  const onPointerDown = fallbackLightDismiss ? (e) => { pressedOutside.current = isOutside(e, ref.current); } : undefined;
  const onPointerUp = fallbackLightDismiss ? (e) => { if (pressedOutside.current && isOutside(e, ref.current)) onClose?.(); } : undefined;

  const closedby = !dismissible ? 'none' : lightDismiss ? 'any' : 'closerequest';

  return (
    <dialog
      ref={ref}
      closedby={closedby}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onCancel={onCancel}
      onClose={onDialogClose}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={`tkc-dialog ${className}`}
    >
      {children}
    </dialog>
  );
}
