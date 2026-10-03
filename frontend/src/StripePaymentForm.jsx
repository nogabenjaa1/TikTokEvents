import { useEffect, useRef, useState } from 'react';
import { backendUrl, authHeaders } from './auth';
import { mountCheckoutForm, friendlyDeclineMessage, reportStripeError } from './stripeCheckout';

const DECLINE_FALLBACK = 'El pago no pudo ser procesado. Intenta con otra tarjeta.';
const LOAD_ERROR = 'No se pudo cargar el formulario de pago. Intenta de nuevo o paga con MercadoPago.';
const PENDING_MESSAGE = 'Tu pago quedó pendiente de confirmación. Te avisamos en cuanto se confirme.';

// Cobro con el formulario de Checkout de Stripe (Checkout Session con
// ui_mode 'form') -- segunda forma de pago junto a MercadoPagoCheckout.jsx
// (MercadoPago), seleccionable desde Membership.jsx. Stripe dibuja el
// formulario completo (tarjeta, botón de pagar, guardar tarjeta) dentro de
// su propio iframe; acá solo se pide la sesión al backend, se monta y, al
// confirmar, se le pide al backend que la verifique contra Stripe.
export default function StripePaymentForm({ planType, diceTier, spotifyAddon, amount, email, firstName, lastName, policyAcceptedAt, onSuccess, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const containerRef = useRef(null);
  const startedRef = useRef(false);
  const formRef = useRef(null);
  // Se leen desde el handler de confirmación (creado una sola vez).
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  useEffect(() => {
    // Una sola vez al montar -- este formulario solo se muestra una vez que
    // email/nombre/apellido ya son válidos (ver Membership.jsx), así que no
    // hace falta recrear la sesión si esos campos siguen editables mientras
    // el formulario ya está en pantalla. El ref también evita una segunda
    // sesión por el doble montaje del modo estricto de React.
    if (startedRef.current) return;
    startedRef.current = true;

    const confirmWithBackend = async (checkoutSessionId) => {
      try {
        const res = await fetch(`${backendUrl()}/api/payments/stripe/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ checkoutSessionId }),
        });
        const data = await res.json();
        if (data.success && data.status === 'approved') {
          onSuccessRef.current?.(data);
          return;
        }
        setSubmitError(data.status === 'pending' ? PENDING_MESSAGE : (data.error || 'No se pudo confirmar el pago.'));
      } catch {
        setSubmitError('No se pudo confirmar el pago. Intenta de nuevo.');
      }
    };

    (async () => {
      let data;
      try {
        const res = await fetch(`${backendUrl()}/api/payments/stripe/checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          // spotifyAddon solo viaja al comprar el complemento (ver Membership.jsx).
          body: JSON.stringify({ planType, diceTier, spotifyAddon: spotifyAddon ? true : undefined, email, firstName, lastName, policyAcceptedAt }),
        });
        data = await res.json();
      } catch {
        setLoadError('No se pudo conectar para iniciar el pago.');
        return;
      }
      if (!data.success) {
        setLoadError(data.error || 'No se pudo iniciar el pago.');
        return;
      }

      formRef.current = await mountCheckoutForm({
        clientSecret: data.clientSecret,
        container: containerRef.current,
        defaultValues: { email },
        onReady: () => setLoading(false),
        onLoadError: (error) => {
          setLoading(false);
          setLoadError(LOAD_ERROR);
          reportStripeError('checkout', error);
        },
        onConfirm: async (_event, confirm) => {
          setSubmitError('');
          setPending(true);
          try {
            const result = await confirm();
            if (result.type === 'error') {
              setSubmitError(friendlyDeclineMessage(result.error, DECLINE_FALLBACK));
              reportStripeError('checkout', result.error);
              return;
            }
            // Nunca se confía en que el frontend diga "pagado" -- el backend
            // vuelve a consultar la sesión contra la propia API de Stripe
            // antes de aplicar la compra (ver /api/payments/stripe/confirm).
            await confirmWithBackend(data.checkoutSessionId);
          } catch (error) {
            setSubmitError(friendlyDeclineMessage(error, DECLINE_FALLBACK));
            reportStripeError('checkout', { message: error?.message || String(error) });
          } finally {
            setPending(false);
          }
        },
      });
    })().catch((error) => {
      // Stripe.js puede lanzar al iniciar/montar (llave inválida, cuenta sin
      // la beta del formulario...): sin esto se quedaba en "Cargando".
      setLoading(false);
      setLoadError(LOAD_ERROR);
      reportStripeError('checkout', error?.stripeError || { message: error?.message || String(error) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aparte del efecto de arriba (que corre una sola vez por el ref): el
  // desmontaje falso del modo estricto llega antes de que exista el
  // formulario y no hace nada; el real (Cancelar / pago terminado) lo quita.
  useEffect(() => () => {
    try { formRef.current?.destroy?.(); } catch { /* ya desmontado */ }
    formRef.current = null;
  }, []);

  if (loadError) {
    return (
      <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
        <p className="theme-notice">{loadError}</p>
        <button type="button" onClick={onCancel} className="theme-btn-secondary theme-btn-md w-full font-black tracking-widest uppercase transition-all">
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="theme-label text-xs uppercase tracking-widest font-semibold">Pago con tarjeta</p>
        <button type="button" onClick={onCancel} disabled={pending} className="text-[10px] text-gray-500 hover:text-gray-300 underline disabled:opacity-40">
          Cancelar
        </button>
      </div>
      {amount != null && (
        <p className="text-[10px] text-gray-500 text-center">Vas a pagar <strong>MX${Number(amount).toLocaleString('es-MX')}</strong></p>
      )}
      {loading && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Stripe...</p>}
      {/* Fondo blanco: el formulario usa la apariencia clara de Checkout
          Studio (colorBackground #ffffff) también en el tema oscuro. */}
      <div ref={containerRef} id="checkout-form" className={loading ? 'hidden' : 'rounded bg-white p-3'} />
      {pending && <p className="text-[10px] text-gray-500 text-center">Procesando pago...</p>}
      {submitError && <p className="theme-notice">{submitError}</p>}
      <p className="text-[10px] text-gray-500 text-center flex items-center justify-center gap-1">
        Pago 100% seguro procesado por <strong>Stripe</strong>
      </p>
    </div>
  );
}
