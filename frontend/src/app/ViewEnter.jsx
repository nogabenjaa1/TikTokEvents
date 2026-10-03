import { useRef } from 'react';
import useStagger from './useStagger';

// Contenedor de una vista que entra (sección o pestaña): fundido de la vista
// y sus tarjetas subiendo una tras otra (ver useStagger y DESIGN.md › Motion).
// Quien lo usa le pone `key` para que se repita en cada cambio de vista.
export default function ViewEnter({ children }) {
  const ref = useRef(null);
  useStagger(ref);
  return <div ref={ref} className="tkc-view-enter">{children}</div>;
}
