import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { backendUrl, authHeaders } from './auth';

// Se crea una sola vez por carga de página (no cada vez que se monta el
// formulario) -- mismo motivo que loadMercadoPagoSdk en CardPaymentForm.jsx:
// no tiene sentido recargar el script de Stripe.js en cada intento de pago.
// loadStripe inserta Stripe.js directo desde js.stripe.com (la versión
// 'dahlia' que trae @stripe/stripe-js 9, la que tiene initCheckoutFormSdk)
// y solo cuando se abre este formulario, no en cada página (overlays
// incluidos). La bandera beta es la que exige el formulario de Checkout.
let stripePromise = null;
function getStripePromise() {
  if (!stripePromise) {
    const publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publicKey
      ? loadStripe(publicKey, { betas: ['custom_checkout_payment_form_1'], locale: 'es' })
      : Promise.resolve(null);
  }
  return stripePromise;
}

// Apariencia configurada en Checkout Studio de Stripe.
const APPEARANCE = {
  theme: 'flat',
  labels: 'auto',
  inputs: 'condensed',
  variables: {
    borderRadius: '4px',
    colorBackground: '#ffffff',
    colorDanger: '#df1b41',
    colorPrimary: '#0570de',
    colorSuccess: '#00c853',
    colorText: '#30313d',
    fontFamily: 'default',
    fontSizeBase: '16px',
    spacingUnit: '4px',
  },
};

// Stripe.js ya trae sus propios mensajes en español (locale 'es', arriba)
// -- este fallback solo cubre casos sin `message`. Pedido explícito:
// mostrar también el `decline_code` (ej. "do_not_honor") pegado al mensaje
// -- es justo el dato que ayuda a saber POR QUÉ se rechazó (fondos,
// tarjeta perdida, error genérico del banco, etc.) sin tener que ir a
// buscarlo al dashboard.
function friendlyDeclineMessage(error) {
  const message = error?.message || 'El pago no pudo ser procesado. Intenta con otra tarjeta.';
  const declineCode = error?.decline_code || error?.paymentFailed?.declineCode;
  if (declineCode) {
    return `${message.replace(/\.?\s*$/, '')}: ${declineCode}`;
  }
  return message;
}

// Pedido explícito: Stripe.js confirma el pago DIRECTO en el navegador, así
// que un rechazo nunca toca este backend por su cuenta -- sin esto no
// quedaba ningún rastro en los logs del servidor para poder diagnosticarlo
// después. Best-effort: si falla el propio reporte, no afecta el flujo.
function reportStripeError(error) {
  fetch(`${backendUrl()}/api/stripe/client-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'checkout', error }),
  }).catch(() => {});
}

const PENDING_MESSAGE = 'Tu pago quedó pendiente de confirmación. Te avisamos en cuanto se confirme.';

// Cobro con el formulario de Checkout de Stripe (Checkout Session con
// ui_mode 'form') -- segunda forma de pago junto a CardPaymentForm.jsx
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

      const stripe = await getStripePromise();
      if (!stripe || typeof stripe.initCheckoutFormSdk !== 'function' || !containerRef.current) {
        setLoadError('No se pudo cargar el formulario de pago. Intenta de nuevo o paga con MercadoPago.');
        return;
      }
      const checkout = stripe.initCheckoutFormSdk({ clientSecret: data.clientSecret, appearance: APPEARANCE, defaultValues: { email } });
      const form = checkout.createForm({ layout: 'expanded' });
      formRef.current = form;
      form.on('ready', () => setLoading(false));
      form.on('loaderror', (event) => {
        setLoading(false);
        setLoadError('No se pudo cargar el formulario de pago. Intenta de nuevo o paga con MercadoPago.');
        reportStripeError(event?.error || { message: 'loaderror' });
      });
      form.mount(containerRef.current);

      const loadActionsResult = await checkout.loadActions();
      if (loadActionsResult.type !== 'success') {
        setLoading(false);
        setLoadError('No se pudo preparar el pago. Intenta de nuevo en un momento.');
        reportStripeError(loadActionsResult.error);
        return;
      }
      form.on('confirm', async (event) => {
        setSubmitError('');
        setPending(true);
        try {
          // redirect 'if_required' evita sacar al comprador de este sitio
          // -- el 3DS de la tarjeta se muestra en un modal de Stripe.
          const result = await loadActionsResult.actions.confirm({ formConfirmEvent: event, redirect: 'if_required' });
          if (result.type === 'error') {
            setSubmitError(friendlyDeclineMessage(result.error));
            reportStripeError(result.error);
            return;
          }
          // Nunca se confía en que el frontend diga "pagado" -- el backend
          // vuelve a consultar la sesión contra la propia API de Stripe
          // antes de aplicar la compra (ver /api/payments/stripe/confirm).
          await confirmWithBackend(data.checkoutSessionId);
        } catch (error) {
          setSubmitError(friendlyDeclineMessage(error));
          reportStripeError({ message: error?.message || String(error) });
        } finally {
          setPending(false);
        }
      });
    })().catch((error) => {
      // Stripe.js puede lanzar al iniciar/montar (llave inválida, cuenta sin
      // la beta del formulario...): sin esto se quedaba en "Cargando".
      setLoading(false);
      setLoadError('No se pudo cargar el formulario de pago. Intenta de nuevo o paga con MercadoPago.');
      reportStripeError({ message: error?.message || String(error) });
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
      <p className="text-[9px] text-gray-500 text-center flex items-center justify-center gap-1">
        Pago 100% seguro procesado por <strong>Stripe</strong>
      </p>
    </div>
  );
}
