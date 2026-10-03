# Stripe: formulario de Checkout embebido

El pago con tarjeta de Stripe dejó de usar el Payment Element con un PaymentIntent. Ahora usa el **formulario de Checkout** de Stripe: una Checkout Session con `ui_mode: 'form'` que se muestra dentro de la página de Membresía. MercadoPago no cambió.

## Valores por reemplazar

No queda ningún valor de ejemplo en el código:

- `mode` es `payment`, porque todos los planes (también el Mensual) y los addons se cobran una sola vez. No hay suscripciones, así que tampoco va `payment_method_collection`.
- `line_items` no usa IDs de precio del Dashboard. Se arma en cada compra con `price_data` y los precios vigentes de `backend/pricing.js`, incluidos los que cambies desde el panel de admin. Hay un renglón por cada cosa comprada: plan, dados y complemento de Spotify.

**Archivos:**
- [backend/server.js](backend/server.js) (ruta `POST /api/payments/stripe/checkout-session`)

| Campo | Valor actual | Qué hacer |
|-------|--------------|-----------|
| mode | `payment` | Nada. Solo cambia si algún día vendes planes recurrentes (`subscription`). |
| line_items | `price_data` en MXN desde `pricing.js` | Nada. Los precios se cambian desde el panel de admin, no en Stripe. |

## Parámetros configurados

Vienen de Checkout Studio y ya están puestos tal cual.

**Archivos:**
- [backend/server.js](backend/server.js) (sesión)
- [frontend/src/StripePaymentForm.jsx](frontend/src/StripePaymentForm.jsx) (apariencia y beta del navegador)

| Parámetro | Valor |
|-----------|-------|
| ui_mode | `form` (el SDK `stripe` del backend es 22.6.2, ≥ 21) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| submit_type | `auto` |
| saved_payment_method_options | `{ payment_method_save: 'enabled' }` |
| integration_identifier | `custom_embedded_web_0001` |
| Versión de API (solo en las llamadas de Checkout Sessions) | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| Beta en el navegador | `custom_checkout_payment_form_1` |
| Apariencia | `flat`, etiquetas `auto`, inputs `condensed`, colores de Checkout Studio |

Además, por cómo funciona el sitio:

- `payment_method_types: ['card']`: solo tarjeta, igual que antes. OXXO y SPEI dejarían el pago pendiente varios días.
- `customer`: hay un cliente de Stripe por licencia, para que "guardar tarjeta" sirva en la siguiente compra de esa misma licencia. Se busca por la licencia y no por el correo, porque el correo lo escribe cualquiera sin verificarlo.
- `payment_intent_data.metadata`: con estos datos el webhook, la conciliación de Sistema y el registro de pagos siguen funcionando igual que antes.

## Pasos pendientes

1. **Pide a Stripe la beta del formulario de Checkout.** `ui_mode: 'form'` y `initCheckoutFormSdk` son una vista previa. Si tu cuenta no la tiene, Stripe rechaza la sesión y el panel muestra "No se pudo iniciar el pago". Se solicita en https://support.stripe.com. Mientras tanto, MercadoPago sigue disponible.
2. **Variables de entorno.** Son las mismas de antes:
   - Render (backend): `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
   - Vercel (frontend): `VITE_STRIPE_PUBLISHABLE_KEY`, con el prefijo `VITE_` porque la lee el navegador.
3. **Webhook.** No hay que cambiarlo: sigue siendo `https://TU_BACKEND/api/payments/stripe/webhook` con el evento `payment_intent.succeeded`.
4. **Prueba en modo de prueba** antes de usar llaves `sk_live_`/`pk_live_`. Usa estas tarjetas:
   - `4242 4242 4242 4242`: aprobada.
   - `4000 0025 0000 3155`: pide 3DS.
   - `4000 0000 0000 9995`: rechazada por fondos insuficientes.

   En todas, cualquier fecha futura y cualquier CVC.

## Cómo funciona

1. Membresía → "Pagar" con Stripe → `POST /api/payments/stripe/checkout-session`. El backend valida la compra y la aceptación de la política de reembolsos, calcula los precios y crea la sesión.
2. El navegador carga Stripe.js (`js.stripe.com/dahlia`, nunca empaquetado) solo en ese momento y monta el formulario en `#checkout-form`.
3. Al pagar, `actions.confirm()` resuelve el cobro en el navegador; si el banco pide 3DS, aparece en un modal de Stripe.
4. `POST /api/payments/stripe/confirm` vuelve a pedir la sesión a Stripe, comprueba que sea de esa licencia y aplica la compra con el ID del PaymentIntent.
5. Si el navegador se cierra antes, el webhook `payment_intent.succeeded` aplica la compra. Nunca se cobra ni se aplica dos veces: los pagos tienen un UNIQUE por ese ID.

No se creó ningún archivo nuevo de código. Cambiaron `backend/server.js` (rutas de Stripe) y `frontend/src/StripePaymentForm.jsx`. La ruta vieja `/api/payments/stripe/intent` se quitó.

## Siguientes pasos

- Si algún día hay planes recurrentes, cambia `mode` a `subscription`, agrega `payment_method_collection: 'always'` y escucha `invoice.paid` en el webhook.
- Los cobros siguen apareciendo en Sistema > Pagos, igual que antes.

## Recursos

- https://support.stripe.com
- https://docs.stripe.com/mcp
