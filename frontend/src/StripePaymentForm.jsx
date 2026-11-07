import { useEffect, useRef, useState } from 'react';
import { backendUrl, authHeaders } from './auth';
import { mountCheckoutForm, friendlyDeclineMessage, reportStripeError, EXPRESS_CHECKOUT_ALWAYS } from './stripeCheckout';
import { savePendingGuestPurchase, clearPendingGuestPurchase, confirmGuestPurchase } from './guestPurchase';

const DECLINE_FALLBACK = 'El pago no pudo ser procesado. Intenta con otra tarjeta.';
const LOAD_ERROR = 'No se pudo cargar el formulario de pago. Revisa tu conexión o si un bloqueador de anuncios lo está frenando, e intenta de nuevo.';
const PENDING_MESSAGE = 'Tu pago quedó pendiente de confirmación. Te avisamos en cuanto se confirme.';
const GUEST_PENDING_MESSAGE = 'Tu pago quedó pendiente de confirmación. Cuando se confirme, vuelve a Membresía en este mismo navegador para recibir tu clave.';

// Cobro con el formulario de Checkout de Stripe (Checkout Session con
// ui_mode 'form'), el único medio de pago de Membership.jsx. Stripe dibuja
// el formulario completo dentro de su propio iframe: Google Pay, Apple Pay y
// Link arriba, correo, nombre, tarjeta, guardar tarjeta y el botón de pagar.
// Acá solo se pide la sesión al backend, se monta y, al confirmar, se le
// pide al backend que la verifique contra Stripe.
// `guestAlias`: compra de un plan SIN cuenta. La sesión de pago se pide a la
// ruta sin sesión y la licencia nace solo si el cobro se confirma; entonces
// `onSuccess` recibe { key, token, license } para entrar con ella (ver
// guestPurchase.js).
export default function StripePaymentForm({ planType, diceTier, spotifyAddon, policyAcceptedAt, guestAlias, onSuccess, onCancel }) {
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
    // Una sola vez al montar -- este formulario solo se muestra una vez
    // aceptada la política de reembolsos (ver Membership.jsx). El ref evita
    // una segunda sesión por el doble montaje del modo estricto de React.
    if (startedRef.current) return;
    startedRef.current = true;

    const confirmGuest = async (checkoutSessionId, claimToken) => {
      const result = await confirmGuestPurchase({ backendUrl: backendUrl(), checkoutSessionId, claimToken });
      if (result.status === 'approved') {
        clearPendingGuestPurchase();
        onSuccessRef.current?.(result);
        return;
      }
      if (result.status === 'gone') clearPendingGuestPurchase();
      // Pendiente: el pago se guardó en este navegador, así que al volver a
      // Membresía se recoge la clave en cuanto se confirme.
      setSubmitError(result.status === 'pending' ? GUEST_PENDING_MESSAGE : result.error);
    };

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
        const res = guestAlias
          ? await fetch(`${backendUrl()}/api/payments/stripe/guest-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias: guestAlias, planType, policyAcceptedAt }),
          })
          : await fetch(`${backendUrl()}/api/payments/stripe/checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            // spotifyAddon solo viaja al comprar el complemento (ver Membership.jsx).
            body: JSON.stringify({ planType, diceTier, spotifyAddon: spotifyAddon ? true : undefined, policyAcceptedAt }),
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
      if (guestAlias) {
        savePendingGuestPurchase({ checkoutSessionId: data.checkoutSessionId, claimToken: data.claimToken, alias: guestAlias, planType });
      }

      formRef.current = await mountCheckoutForm({
        clientSecret: data.clientSecret,
        container: containerRef.current,
        formOptions: EXPRESS_CHECKOUT_ALWAYS,
        // Sin defaultValues.email a propósito: el correo lo escribe el
        // comprador en el formulario, y si el cliente de la licencia ya tiene
        // uno, Stripe rechaza el formulario completo al intentar poner otro
        // ("You cannot update the email because a customer_email or customer
        // with an email is already set") -- error real en producción.
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
            if (guestAlias) await confirmGuest(data.checkoutSessionId, data.claimToken);
            else await confirmWithBackend(data.checkoutSessionId);
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
      <div className="theme-surface w-full max-w-3xl p-5 flex flex-col gap-3">
        <p className="theme-notice">{loadError}</p>
        <button type="button" onClick={onCancel} className="theme-btn-secondary theme-btn-md w-full font-black tracking-widest uppercase transition-all">
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="theme-surface w-full max-w-3xl p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="theme-label text-xs uppercase tracking-widest font-semibold">Pago seguro</p>
        <button type="button" onClick={onCancel} disabled={pending} className="text-[10px] text-gray-500 hover:text-gray-300 underline disabled:opacity-40">
          Cancelar
        </button>
      </div>
      {loading && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Stripe...</p>}
      {/* Fondo blanco: el formulario usa la apariencia clara de Checkout
          Studio (colorBackground #ffffff) también en el tema oscuro. */}
      <div ref={containerRef} id="checkout-form" className={loading ? 'hidden' : 'rounded-lg bg-white p-4 sm:p-6'} />
      {pending && <p className="text-[10px] text-gray-500 text-center">Procesando pago...</p>}
      {submitError && <p className="theme-notice">{submitError}</p>}
      <p className="text-[10px] text-gray-500 text-center flex items-center justify-center gap-1">
        Pago 100% seguro procesado por <strong>Stripe</strong>
      </p>
    </div>
  );
}
