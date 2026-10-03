import { loadStripe } from '@stripe/stripe-js';
import { backendUrl } from './auth';

// Lo común del formulario de Checkout de Stripe (Checkout Session con
// ui_mode 'form'), compartido por el cobro (StripePaymentForm.jsx) y la
// verificación de tarjeta de la prueba gratis (CardVerifyForm.jsx), para
// que las dos usen la misma versión de Stripe.js, la misma apariencia y el
// mismo manejo de errores.

// Se crea una sola vez por carga de página (no cada vez que se monta un
// formulario) -- no tiene sentido recargar Stripe.js en cada intento.
// loadStripe inserta Stripe.js directo desde js.stripe.com (la versión
// 'dahlia' que trae @stripe/stripe-js 9, la que tiene initCheckoutFormSdk)
// y solo cuando se abre uno de estos formularios, no en cada página
// (overlays incluidos). La bandera beta es la que exige el formulario.
let stripePromise = null;
export function getStripePromise() {
  if (!stripePromise) {
    const publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publicKey
      ? loadStripe(publicKey, { betas: ['custom_checkout_payment_form_1'], locale: 'es' })
      : Promise.resolve(null);
  }
  return stripePromise;
}

// Apariencia configurada en Checkout Studio de Stripe.
export const CHECKOUT_APPEARANCE = {
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

export const LOAD_ERROR_MESSAGE = 'No se pudo cargar el formulario de Stripe. Intenta de nuevo en un momento.';

// Stripe.js ya trae sus propios mensajes en español (locale 'es', arriba)
// -- el fallback solo cubre casos sin `message`. Pedido explícito: mostrar
// también el `decline_code` (ej. "do_not_honor") pegado al mensaje -- es
// justo el dato que explica POR QUÉ se rechazó (fondos, tarjeta perdida,
// error genérico del banco, etc.) sin tener que ir a buscarlo al dashboard.
export function friendlyDeclineMessage(error, fallback) {
  const message = error?.message || fallback;
  const declineCode = error?.decline_code || error?.paymentFailed?.declineCode;
  if (declineCode) {
    return `${message.replace(/\.?\s*$/, '')}: ${declineCode}`;
  }
  return message;
}

// Pedido explícito: Stripe.js confirma DIRECTO en el navegador, así que un
// rechazo nunca toca este backend por su cuenta -- sin esto no quedaba
// ningún rastro en los logs del servidor para poder diagnosticarlo
// después. Best-effort: si falla el propio reporte, no afecta el flujo.
export function reportStripeError(context, error) {
  fetch(`${backendUrl()}/api/stripe/client-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, error }),
  }).catch(() => {});
}

// Monta el formulario de Checkout de una sesión ya creada en el backend.
// `onConfirm(event, confirm)` se llama cuando el comprador aprieta el botón
// del propio formulario; `confirm()` termina la operación en Stripe sin
// sacarlo del sitio (redirect 'if_required': el 3DS va en un modal) y
// devuelve { type: 'success' | 'error', ... }. Devuelve el formulario (para
// destroy()) o lanza si Stripe.js no se pudo iniciar.
export async function mountCheckoutForm({ clientSecret, container, defaultValues, onReady, onLoadError, onConfirm }) {
  const stripe = await getStripePromise();
  if (!stripe || typeof stripe.initCheckoutFormSdk !== 'function' || !container) {
    throw new Error('Stripe.js no disponible');
  }
  const checkout = stripe.initCheckoutFormSdk({ clientSecret, appearance: CHECKOUT_APPEARANCE, defaultValues });
  const form = checkout.createForm({ layout: 'expanded' });
  form.on('ready', () => onReady?.());
  form.on('loaderror', (event) => onLoadError?.(event?.error || { message: 'loaderror' }));
  form.mount(container);

  const loadActionsResult = await checkout.loadActions();
  if (loadActionsResult.type !== 'success') {
    try { form.destroy(); } catch { /* ya desmontado */ }
    const error = new Error('loadActions');
    error.stripeError = loadActionsResult.error;
    throw error;
  }
  form.on('confirm', (event) => onConfirm(event, () => loadActionsResult.actions.confirm({ formConfirmEvent: event, redirect: 'if_required' })));
  return form;
}
