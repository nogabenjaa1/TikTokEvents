import { loadStripe } from '@stripe/stripe-js';
import { backendUrl } from './auth';

// Lo común del formulario de Checkout de Stripe (Checkout Session con
// ui_mode 'form'): la versión de Stripe.js, la apariencia y el manejo de
// errores del cobro (StripePaymentForm.jsx: pagos únicos, suscripciones y la
// prueba gratis).

// Se crea una sola vez por carga de página (no cada vez que se monta un
// formulario) -- no tiene sentido recargar Stripe.js en cada intento.
// loadStripe inserta Stripe.js directo desde js.stripe.com (la versión
// 'dahlia' que trae @stripe/stripe-js 9, la que tiene initCheckoutFormSdk,
// igual que el código que da el Dashboard) y solo cuando se abre uno de
// estos formularios, no en cada página (overlays incluidos). Sin bandera
// beta: el formulario ya no es vista previa.
let stripePromise = null;
export function getStripePromise() {
  if (!stripePromise) {
    const publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publicKey
      ? loadStripe(publicKey, { locale: 'es' })
      : Promise.resolve(null);
  }
  return stripePromise;
}

// Apariencia configurada en Checkout Studio de Stripe, con el morado de la
// marca (#7C3AED) en vez del azul de Stripe: es el mismo "color de énfasis" del
// portal de clientes, así el pago y la gestión de la suscripción combinan
// (texto blanco encima: contraste 5,7:1).
export const CHECKOUT_APPEARANCE = {
  theme: 'stripe',
  labels: 'auto',
  inputs: 'spaced',
  variables: {
    borderRadius: '4px',
    colorBackground: '#ffffff',
    colorDanger: '#df1b41',
    colorPrimary: '#7C3AED',
    colorSuccess: '#00c853',
    colorText: '#30313d',
    fontFamily: 'default',
    fontSizeBase: '16px',
    spacingUnit: '4px',
  },
};

// Google Pay y Apple Pay van DENTRO de la lista de métodos de pago (una opción
// más, junto a "Tarjeta"), no como el botón negro grande de arriba. Pedido
// explícito: que el formulario se vea siempre igual. Con 'never' en el botón
// rápido, Stripe los ofrece en la lista cuando el navegador puede pagar con
// ellos (Chrome o Android con una tarjeta en Google; Safari con Apple Pay).
// Antes estaba en 'always' (botón arriba) porque con 'auto' a veces no salía.
export const WALLETS_IN_LIST = { expressCheckout: { paymentMethods: { googlePay: 'never', applePay: 'never' } } };

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
// devuelve { type: 'success' | 'error', ... }. `formOptions` se suma a las
// opciones de createForm (ver WALLETS_IN_LIST). Devuelve el
// formulario (para destroy()) o lanza si Stripe.js no se pudo iniciar.
export async function mountCheckoutForm({ clientSecret, container, onReady, onLoadError, onConfirm, formOptions = {} }) {
  const stripe = await getStripePromise();
  if (!stripe || typeof stripe.initCheckoutFormSdk !== 'function' || !container) {
    throw new Error('Stripe.js no disponible');
  }
  const checkout = stripe.initCheckoutFormSdk({ clientSecret, appearance: CHECKOUT_APPEARANCE });
  // La documentación de createForm solo promete 'auto' y 'always' para los
  // botones rápidos: si esta versión de Stripe.js rechaza las opciones, se
  // monta igual con las de siempre en vez de dejar al comprador sin formulario.
  let form;
  try {
    form = checkout.createForm({ layout: 'expanded', ...formOptions });
  } catch (error) {
    reportStripeError('checkout-form-options', { message: error?.message || String(error) });
    form = checkout.createForm({ layout: 'expanded' });
  }
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
