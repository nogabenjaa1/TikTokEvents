import React, { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { backendUrl, authHeaders } from './auth';

// Se crea una sola vez por carga de página (no cada vez que se monta el
// formulario) -- mismo motivo que loadMercadoPagoSdk en CardPaymentForm.jsx:
// no tiene sentido recargar el script de Stripe.js en cada intento de pago.
let stripePromise = null;
function getStripePromise() {
  if (!stripePromise) {
    const publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publicKey ? loadStripe(publicKey) : Promise.resolve(null);
  }
  return stripePromise;
}

// Stripe.js ya trae sus propios mensajes en español (el Payment Element se
// monta con locale: 'es', ver más abajo) -- este fallback solo cubre casos
// sin `message` (ej. error de red antes de llegar a Stripe). Pedido
// explícito: mostrar también el `decline_code` (ej. "do_not_honor") pegado
// al mensaje -- Stripe lo manda aparte del texto genérico "tu tarjeta fue
// rechazada", y es justo el dato que ayuda a saber POR QUÉ (fondos,
// tarjeta perdida, error genérico del banco, etc.) sin tener que ir a
// buscarlo al dashboard.
function friendlyDeclineMessage(error) {
  const message = error?.message || 'El pago no pudo ser procesado. Intenta con otra tarjeta.';
  if (error?.decline_code) {
    return `${message.replace(/\.?\s*$/, '')}: ${error.decline_code}`;
  }
  return message;
}

// Tiene que vivir DENTRO de <Elements> -- useStripe()/useElements() leen el
// contexto que arma <Elements>, no se pueden llamar en el componente que la
// envuelve (ver el export default de más abajo).
function CheckoutInner({ pending, setPending, submitError, setSubmitError, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || pending) return;
    setSubmitError('');
    setPending(true);

    // redirect: 'if_required' evita sacar al comprador de este sitio --
    // Stripe.js igual muestra su propio modal embebido si el banco exige
    // 3DS, sin tener que armar un iframe a mano (a diferencia del challenge
    // de MercadoPago, ver CardPaymentForm.jsx).
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (error) {
      setPending(false);
      setSubmitError(friendlyDeclineMessage(error));
      return;
    }
    if (!paymentIntent || paymentIntent.status !== 'succeeded') {
      setPending(false);
      setSubmitError('Tu pago quedó pendiente de confirmación — te avisamos apenas se confirme.');
      return;
    }

    // Nunca se confía en que el frontend diga "succeeded" -- el backend
    // vuelve a consultar el PaymentIntent contra la propia API de Stripe
    // antes de aplicar la compra (ver /api/payments/stripe/confirm).
    try {
      const res = await fetch(`${backendUrl()}/api/payments/stripe/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });
      const data = await res.json();
      setPending(false);
      if (data.success && data.status === 'approved') {
        onSuccess?.(data);
        return;
      }
      setSubmitError(data.status === 'pending'
        ? 'Tu pago quedó pendiente de confirmación — te avisamos apenas se confirme.'
        : (data.error || 'No se pudo confirmar el pago.'));
    } catch {
      setPending(false);
      setSubmitError('No se pudo confirmar el pago. Intenta de nuevo.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <PaymentElement />
      {pending && <p className="text-[10px] text-gray-500 text-center">Procesando pago...</p>}
      {submitError && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{submitError}</p>}
      <button type="submit" disabled={!stripe || pending}
        className="theme-btn-primary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed">
        {pending ? 'Procesando...' : 'Pagar'}
      </button>
    </form>
  );
}

// Cobro directo con el Payment Element de Stripe -- segunda forma de pago
// junto a CardPaymentForm.jsx (MercadoPago), seleccionable desde
// Membership.jsx. A diferencia del Brick de MP (que se crea a mano apenas
// carga el SDK), Stripe necesita el client_secret de un PaymentIntent YA
// CREADO en el backend antes de poder montar <Elements> -- por eso acá
// primero se pide /api/payments/stripe/intent y recién con la respuesta se
// arma el formulario real.
export default function StripePaymentForm({ planType, diceTier, amount, email, firstName, lastName, policyAcceptedAt, onSuccess, onCancel }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const requestedRef = useRef(false);

  useEffect(() => {
    // Una sola vez al montar -- este formulario solo se muestra una vez que
    // email/nombre/apellido ya son válidos (ver Membership.jsx), así que no
    // hace falta recrear el PaymentIntent si esos campos siguen editables
    // mientras el formulario ya está en pantalla.
    if (requestedRef.current) return;
    requestedRef.current = true;
    fetch(`${backendUrl()}/api/payments/stripe/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ planType, diceTier, email, firstName, lastName, policyAcceptedAt }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) setClientSecret(data.clientSecret);
        else setLoadError(data.error || 'No se pudo iniciar el pago.');
      })
      .catch(() => setLoadError('No se pudo conectar para iniciar el pago.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) {
    return (
      <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{loadError}</p>
        <button type="button" onClick={onCancel} className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all">
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="theme-label text-xs uppercase tracking-widest font-semibold">Pago con tarjeta</p>
        <button type="button" onClick={onCancel} className="text-[10px] text-gray-500 hover:text-gray-300 underline">
          Cancelar
        </button>
      </div>
      {!clientSecret ? (
        <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Stripe...</p>
      ) : (
        <>
          {amount != null && (
            <p className="text-[10px] text-gray-500 text-center">Vas a pagar <strong>MX${Number(amount).toLocaleString('es-MX')}</strong></p>
          )}
          <Elements stripe={getStripePromise()} options={{ clientSecret, locale: 'es' }}>
            <CheckoutInner
              pending={pending} setPending={setPending}
              submitError={submitError} setSubmitError={setSubmitError}
              onSuccess={onSuccess}
            />
          </Elements>
        </>
      )}
      <p className="text-[9px] text-gray-500 text-center flex items-center justify-center gap-1">
        🔒 Pago 100% seguro procesado por <strong>Stripe</strong>
      </p>
    </div>
  );
}
