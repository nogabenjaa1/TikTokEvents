import React, { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { backendUrl, requestFreeTrial } from './auth';

// Mismo motivo que en StripePaymentForm.jsx: un solo script de Stripe.js
// por carga de página, no uno por cada vez que se abre este formulario.
let stripePromise = null;
function getStripePromise() {
  if (!stripePromise) {
    const publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publicKey ? loadStripe(publicKey) : Promise.resolve(null);
  }
  return stripePromise;
}

// Mismo criterio que StripePaymentForm.jsx: pegar el `decline_code` (ej.
// "do_not_honor") al mensaje genérico de Stripe -- es el dato que explica
// POR QUÉ se rechazó, sin tener que ir a buscarlo al dashboard.
function friendlyDeclineMessage(error) {
  const message = error?.message || 'No se pudo verificar la tarjeta. Revisa los datos e intenta de nuevo.';
  if (error?.decline_code) {
    return `${message.replace(/\.?\s*$/, '')}: ${error.decline_code}`;
  }
  return message;
}

// Tiene que vivir DENTRO de <Elements> -- useStripe()/useElements() leen el
// contexto que arma <Elements> (ver el export default de más abajo).
function CheckoutForm({ alias, setAlias, cardholderName, setCardholderName, submitting, setSubmitting, error, setError, onResult }) {
  const stripe = useStripe();
  const elements = useElements();

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !stripe || !elements || !alias.trim() || !cardholderName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      // redirect: 'if_required' evita sacar al streamer de este sitio --
      // Stripe.js igual muestra su propio modal embebido si el banco exige
      // 3DS (justo lo que hace que esta verificación sea más fuerte que el
      // simple chequeo de Luhn que hacía MercadoPago antes acá).
      const { error: stripeError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          payment_method_data: { billing_details: { name: cardholderName.trim() } },
        },
      });
      if (stripeError) {
        setError(friendlyDeclineMessage(stripeError));
        return;
      }
      if (!setupIntent || setupIntent.status !== 'succeeded') {
        setError('La tarjeta no pasó la verificación de seguridad. Intenta de nuevo.');
        return;
      }
      // Nunca se confía en que el frontend diga "succeeded" -- el backend
      // vuelve a consultar el SetupIntent contra la propia API de Stripe
      // antes de crear la licencia (ver /api/free-trial en server.js).
      const result = await requestFreeTrial(alias.trim(), setupIntent.id);
      onResult(result);
    } catch (err) {
      setError(err.message || 'No se pudo verificar la tarjeta. Revisa los datos e intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={alias}
        onChange={e => setAlias(e.target.value)}
        placeholder="Elige un alias"
        className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
      />
      <input
        value={cardholderName}
        onChange={e => setCardholderName(e.target.value)}
        placeholder="Nombre del titular"
        className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
      />
      <PaymentElement />
      {error && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !stripe || !alias.trim() || !cardholderName.trim()}
        className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? 'VERIFICANDO...' : 'Verificar y activar prueba gratis'}
      </button>
    </form>
  );
}

// Verifica una tarjeta real para desbloquear la prueba gratis sin ver
// anuncios — a propósito NO cobra nada: usa un SetupIntent de Stripe (no un
// PaymentIntent), pensado exactamente para autenticar que una tarjeta es
// real (puede pedir 3DS) sin capturar ningún monto. Reemplaza la
// verificación vieja de MercadoPago (que solo chequeaba el dígito de Luhn
// del token, sin autenticación real ni comparación entre pruebas) — ver
// /api/free-trial/setup-intent y /api/free-trial en server.js.
//
// Al validar, llama a onResult({ key, token, license }) — el mismo shape
// que ya maneja Membership.jsx para el camino de anuncios (trialResult),
// así la pantalla de "guarda tu clave" es una sola, compartida entre las
// tres vías. `alias`/`setAlias` son controlados desde afuera (pedido
// explícito: un solo input de alias compartido entre la prueba gratis y
// la compra directa, no uno propio acá adentro que obligue a escribirlo
// dos veces).
export default function CardVerifyForm({ alias, setAlias, onResult, onCancel }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    fetch(`${backendUrl()}/api/free-trial/setup-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) setClientSecret(data.clientSecret);
        else setLoadError(data.error || 'No se pudo cargar el formulario de tarjeta.');
      })
      .catch(() => setLoadError('No se pudo cargar el formulario de tarjeta. Revisa tu conexión o intenta más tarde.'));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="theme-label text-xs uppercase tracking-widest font-semibold">Verificar tarjeta</p>
      <p className="text-[11px] text-gray-500">
        No se te cobra nada — Stripe solo autentica que la tarjeta es real, como alternativa a ver anuncios.
      </p>

      {loadError ? (
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{loadError}</p>
      ) : !clientSecret ? (
        <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Stripe...</p>
      ) : (
        <Elements stripe={getStripePromise()} options={{ clientSecret, locale: 'es' }}>
          <CheckoutForm
            alias={alias} setAlias={setAlias}
            cardholderName={cardholderName} setCardholderName={setCardholderName}
            submitting={submitting} setSubmitting={setSubmitting}
            error={error} setError={setError}
            onResult={onResult}
          />
        </Elements>
      )}

      <button type="button" onClick={onCancel} className="theme-btn-secondary w-full py-2 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all">
        Cancelar
      </button>
    </div>
  );
}
