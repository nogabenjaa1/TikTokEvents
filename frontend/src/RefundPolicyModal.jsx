import ModalDialog from './ModalDialog';

// Política de reembolsos/contracargos -- pedido explícito: reducir el
// riesgo de que un contracargo de mala fe (alguien que sí recibió el
// servicio pero igual disputa el cargo con su banco) termine afectando la
// cuenta de Stripe. Un texto así NO puede impedir que alguien dispute con
// su banco -- eso lo decide el banco, no el vendedor -- pero sí:
// 1) le da a Stripe evidencia real para pelear y ganar la disputa
//    (aceptación explícita, con fecha, antes del cobro), y
// 2) desalienta el "reembolso amistoso" de quien solo pregunta porque sí.
// El texto se muestra en un modal (no una ruta aparte) para no agregar
// una sección nueva al sidebar por algo que solo hace falta ver una vez
// antes de pagar -- se abre desde el checkbox de aceptación en
// Membership.jsx.
const REFUND_POLICY_PARAGRAPHS = [
  'BenjaApis es un servicio digital de acceso inmediato: en cuanto el pago se aprueba, tu licencia queda activa al instante y ya puedes usar todas las funciones de tu plan. Por tratarse de un servicio ya entregado en el momento de la compra, todas las ventas son finales y no se otorgan reembolsos, salvo que la legislación aplicable exija lo contrario.',
  'Si tuviste un problema técnico real (el pago se cobró dos veces, no se activó tu licencia, o algo similar), contáctanos antes de iniciar cualquier disputa con tu banco — la enorme mayoría de estos casos se resuelven directo y rápido por esa vía.',
  'Iniciar un contracargo (chargeback) con tu banco sin haber contactado antes al soporte, por un servicio que sí recibiste, se considera un uso indebido del sistema de pagos. En ese caso nos reservamos el derecho de revocar la licencia asociada de forma permanente y de presentar como evidencia ante el banco/procesador de pago el registro de tu conexión, uso del servicio y la aceptación de esta política con fecha y hora.',
  'Al completar tu pago, confirmas que entiendes y aceptas esta política.',
];

export default function RefundPolicyModal({ onClose }) {
  return (
    <ModalDialog onClose={onClose} labelledBy="refund-policy-title" className="theme-surface w-[calc(100%-2rem)] max-w-lg p-5 flex-col gap-3 max-h-[85vh] overflow-y-auto [&[open]]:flex">
        <h2 id="refund-policy-title" className="theme-label text-xs uppercase tracking-widest font-semibold">Política de reembolsos</h2>
        {REFUND_POLICY_PARAGRAPHS.map((paragraph, i) => (
          <p key={i} className="text-[11px] text-gray-400 leading-relaxed">{paragraph}</p>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="theme-btn-primary theme-btn-md w-full font-black tracking-widest uppercase transition-all mt-2"
        >
          Entendido
        </button>
    </ModalDialog>
  );
}
