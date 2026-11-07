# Stripe: formulario de Checkout embebido

Todo lo de Stripe usa el **formulario de Checkout** de Stripe (Checkout Session con `ui_mode: 'form'`), con la misma versión, la misma apariencia y el mismo código de montaje ([frontend/src/stripeCheckout.js](frontend/src/stripeCheckout.js)):

- **Cobro** de planes y addons: sesión en modo `payment`.
- **Verificación de tarjeta de la prueba gratis**: sesión en modo `setup`, sin cobro.

El formulario de Stripe pide todo dentro de su iframe: Google Pay, Apple Pay y Link arriba, luego el correo, el nombre (opcional) y la tarjeta. La página de Membresía ya no tiene campos propios de correo, nombre ni dirección; solo queda la casilla de la política de reembolsos, que hay que marcar para que aparezca el formulario. MercadoPago ya no se ofrece en Membresía.

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
| name_collection | `{ individual: { enabled: true, optional: true } }` |
| saved_payment_method_options | `{ payment_method_save: 'enabled' }` |
| integration_identifier | `custom_embedded_web_0001` |
| Versión de API (solo en las llamadas de Checkout Sessions, cobro y verificación) | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| Beta en el navegador | `custom_checkout_payment_form_1` |
| Apariencia | `stripe`, etiquetas `auto`, inputs `spaced`, colores de Checkout Studio |

Además, por cómo funciona el sitio:

- Sin `payment_method_types` en el cobro: los métodos salen de *Configuración → Métodos de pago* del Dashboard (tarjeta, Google Pay, Apple Pay y Link). **No actives OXXO ni SPEI ahí**: dejarían el pago pendiente varios días (el webhook lo aplicaría al confirmarse).
- `customer`: hay un cliente de Stripe por licencia, para que "guardar tarjeta" sirva en la siguiente compra de esa misma licencia. Se busca por la licencia y no por el correo, porque el correo lo escribe cualquiera sin verificarlo. El cliente nuevo se crea sin correo: Checkout guarda en él el que se escriba en el formulario. Si la licencia ya compró antes, su correo aparece precargado y no se puede editar (así funciona Stripe).
- Sin `payment_intent_data.receipt_email`: el recibo lo manda Stripe al correo del formulario si está activo *Configuración → Correos a clientes → Pagos correctos*.
- `payment_intent_data.metadata`: con estos datos el webhook, la conciliación de Sistema y el registro de pagos siguen funcionando igual que antes.

## Verificación de tarjeta (prueba gratis)

**Archivos:**
- [backend/server.js](backend/server.js): `POST /api/free-trial/checkout-session` y `POST /api/free-trial`
- [frontend/src/CardVerifyForm.jsx](frontend/src/CardVerifyForm.jsx)

| Parámetro | Valor |
|-----------|-------|
| ui_mode | `form` |
| mode | `setup` (no cobra nada) |
| currency | `mxn` |
| payment_method_types | `['card']` (se queda así a propósito: con Link o una billetera no siempre llega el fingerprint de la tarjeta, y sin él la misma tarjeta podría pedir varias pruebas gratis) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| integration_identifier | `custom_embedded_web_0001` |

En modo `setup` no aplican `submit_type`, `automatic_tax` ni `saved_payment_method_options`, y Stripe los rechaza. En el modo setup de Checkout, Stripe muestra su texto de autorización de cobros futuros, y no se puede quitar. Aun así, la tarjeta nunca se cobra ni se guarda en un cliente. El backend pide la sesión a Stripe, exige que esté completa y en modo `setup`, y guarda el fingerprint de la tarjeta para que no se use en dos pruebas gratis.

## Pasos pendientes

**Google Pay, Apple Pay y Link:**

- Actívalos en *Configuración → Métodos de pago* (modo de prueba y modo real por separado).
- Registra `benjaapis.dev` (y `www.benjaapis.dev` si se usa) en *Configuración → Dominios de métodos de pago*. Sin esto no aparecen los botones de billetera en tu página.
- La vista previa de Checkout Studio siempre dibuja los tres botones; en tu página cada uno aparece solo si el navegador puede usarlo: Google Pay en Chrome/Android con una tarjeta en Google Wallet, Apple Pay en Safari con Apple Pay configurado, Link siempre.

0. **Comprueba que tu cuenta acepte el modo setup del formulario** antes de subir este cambio. El modo payment ya está comprobado. Cambia `TU_LLAVE` por tu llave secreta; si la respuesta trae `"id": "cs_..."`, funciona:

   ```bash
   curl https://api.stripe.com/v1/checkout/sessions -u "TU_LLAVE:" -H "Stripe-Version: 2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" -d ui_mode=form -d mode=setup -d currency=mxn -d "payment_method_types[]=card" -d integration_identifier=custom_embedded_web_0001 -d "return_url=https://benjaapis.dev/?s={CHECKOUT_SESSION_ID}"
   ```

1. **Beta del formulario de Checkout:** tu cuenta ya la tiene (el formulario carga en Membresía). Si algún día Stripe rechaza la sesión, el panel muestra "No se pudo iniciar el pago"; se resuelve con https://support.stripe.com.
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

Cambiaron `backend/server.js` (rutas de Stripe), `frontend/src/StripePaymentForm.jsx` y `frontend/src/CardVerifyForm.jsx`. Lo común quedó en `frontend/src/stripeCheckout.js`. Se quitaron las rutas viejas `/api/payments/stripe/intent` y `/api/free-trial/setup-intent`, y la dependencia `@stripe/react-stripe-js`, que ya no se usa.

## Siguientes pasos

- Si algún día hay planes recurrentes, cambia `mode` a `subscription`, agrega `payment_method_collection: 'always'` y escucha `invoice.paid` en el webhook.
- Los cobros siguen apareciendo en Sistema > Pagos, igual que antes.

## Recursos

- https://support.stripe.com
- https://docs.stripe.com/mcp
