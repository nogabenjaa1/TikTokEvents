# Stripe: formulario de Checkout embebido

Todo lo de Stripe usa el **formulario de Checkout** de Stripe (Checkout Session con `ui_mode: 'form'`), con la misma versión, la misma apariencia y el mismo código de montaje ([frontend/src/stripeCheckout.js](frontend/src/stripeCheckout.js)). Hay tres tipos de sesión:

- **Mensual y Anual:** suscripción (modo `subscription`). Stripe cobra solo cada mes o cada año. Se compran al momento o con 14 días gratis.
- **Lifetime con prueba:** modo `setup`. Solo guarda la tarjeta; el pago único se cobra al día 14 desde el servidor.
- **Lifetime al momento, complemento de Spotify y dados:** pago único (modo `payment`), como siempre.

El formulario de Stripe pide todo dentro de su iframe: Google Pay, Apple Pay y Link arriba, luego el correo, el nombre (opcional) y la tarjeta. La página de Membresía solo pide el alias (sin cuenta) y la casilla de la política de reembolsos. La prueba de 7 días (anuncios o verificar tarjeta) ya no existe; las licencias de esa prueba que sigan vigentes vencen solas.

## Valores por reemplazar

No queda ningún valor de ejemplo en el código:

- `line_items` no usa IDs de precio del Dashboard. Se arma en cada compra con `price_data` y los precios vigentes de `backend/pricing.js`, incluidos los que cambies desde el panel de admin. En Mensual y Anual el `price_data` lleva `recurring` (mes o año).
- **Una suscripción conserva el precio con el que empezó.** Si cambias el precio desde el panel, aplica a las suscripciones nuevas, no a las que ya existen.

**Archivos:**
- [backend/server.js](backend/server.js) (`createPurchaseCheckoutSession` y las rutas de pago)
- [backend/lib/stripeBilling.js](backend/lib/stripeBilling.js) (suscripciones, pruebas y cobro de Lifetime)

## Parámetros configurados

Vienen de Checkout Studio y ya están puestos tal cual.

| Parámetro | Valor |
|-----------|-------|
| ui_mode | `form` |
| billing_address_collection | `auto` |
| name_collection | `{ individual: { enabled: true, optional: true } }` |
| integration_identifier | `custom_embedded_web_0001` |
| submit_type, saved_payment_method_options | Solo en pago único (`auto`, `enabled`); en suscripción y en setup no aplican |
| Versión de API (llamadas de Checkout Sessions, suscripciones, setup y cobros de Lifetime) | `2026-10-28.endive` |
| Stripe.js | `js.stripe.com/dahlia` vía `@stripe/stripe-js` 9, sin `betas` |
| Apariencia | `stripe`, etiquetas `auto`, inputs `spaced`, colores de Checkout Studio |

Además, por cómo funciona el sitio:

- **Sin `payment_method_types`:** los métodos salen de *Configuración → Métodos de pago* del Dashboard. **No actives OXXO ni SPEI ahí**: dejarían el pago pendiente varios días.
- **La prueba de 14 días es solo con tarjeta** (`allowed_payment_method_types: ['card']`; Google Pay y Apple Pay cuentan como tarjeta). Así se tiene la huella de la tarjeta para dar una sola prueba por tarjeta.
- **`customer`:** hay un cliente de Stripe por licencia, buscado por la licencia y no por el correo.
- **Recibos:** los manda Stripe al correo del formulario si está activo *Configuración → Correos a clientes → Pagos correctos*. Para las suscripciones, activa también los correos de facturas y de renovación.

## Suscripciones y prueba de 14 días

- **Prueba de Mensual o Anual:** suscripción con `trial_period_days: 14` y `trial_settings.end_behavior.missing_payment_method: 'cancel'`. Al terminar, Stripe cobra la tarjeta (`invoice.paid`) y la licencia pasa al plan.
- **Prueba de Lifetime:** modo `setup` con el monto en la metadata. El servidor revisa cada 10 minutos las pruebas que terminaron y cobra el pago único con la tarjeta guardada (`off_session`, con clave de idempotencia). Si la tarjeta falla, no se reintenta: la prueba vence sola.
- **Una prueba por tarjeta** (tabla `trial_fingerprints`). Si la tarjeta ya tuvo prueba, la suscripción se cancela al instante sin cobrar nada y el comprador ve el aviso.
- **Solo para empezar:** una licencia con un plan pagado vigente no puede iniciar una prueba.
- **Durante la prueba la licencia es de tipo `trial`:** sin Spotify de la plataforma; con los anuncios de las licencias de prueba en el panel.
- **Cambiar de plan:** comprar Anual siendo Mensual (o al revés) crea la suscripción nueva y cancela la anterior. Si a la licencia le queda tiempo pagado, el primer cobro espera a que termine. Comprar Lifetime cancela la suscripción y cualquier prueba.
- **Cancelar:** en Membresía, "Gestionar suscripción" abre el portal de clientes de Stripe (tarjeta, recibos y cancelar). La prueba de Lifetime tiene su propio "Cancelar prueba".
- **Renovación que falla:** la licencia tiene 2 días de margen tras el fin del periodo mientras Stripe reintenta el cobro.

## Pasos pendientes

1. **Portal de clientes:** en el Dashboard, *Configuración → Facturación → Portal de clientes*, activa "Cancelar suscripciones" y "Actualizar métodos de pago" y guarda (en modo de prueba y en modo real). Sin guardarlo una vez, "Gestionar suscripción" da error.
2. **Webhook:** en el destino `https://TU_BACKEND/api/payments/stripe/webhook`, marca estos eventos (además de los que ya tenías):
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`
   - `payment_intent.succeeded` (opcional)
3. **Correos de Stripe:** en *Configuración → Correos a clientes*, activa los de pagos correctos, facturas, recordatorio antes de que termine la prueba y renovaciones.
4. **Prueba en modo de prueba** antes de las llaves `sk_live_`/`pk_live_`:
   - `4242 4242 4242 4242`: aprobada.
   - `4000 0025 0000 3155`: pide 3DS.
   - `4000 0000 0000 9995`: rechazada por fondos insuficientes.
   - Para ver el fin de una prueba sin esperar 14 días, en el Dashboard abre la suscripción y usa "Finalizar prueba ahora" (o un *Test clock*).

   En todas, cualquier fecha futura y cualquier CVC.
5. **Variables de entorno:** las mismas de antes (`STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en Render; `VITE_STRIPE_PUBLISHABLE_KEY` en Vercel).

**Google Pay, Apple Pay y Link:** actívalos en *Configuración → Métodos de pago* y registra `benjaapis.dev` en *Configuración → Dominios de métodos de pago*. En la prueba de 14 días no aparece Link (solo tarjeta).

## Cómo funciona

1. Membresía → "Comprar" o "Probar 14 días gratis" → `POST /api/payments/stripe/checkout-session` (o `guest-checkout-session` sin cuenta). El backend valida la compra y la aceptación de la política, calcula los precios y crea la sesión.
2. El navegador carga Stripe.js solo en ese momento y monta el formulario en `#checkout-form`.
3. Al pagar, `actions.confirm()` resuelve el cobro o guarda la tarjeta en el navegador; si el banco pide 3DS, aparece en un modal de Stripe.
4. `POST /api/payments/stripe/confirm` (o `guest-confirm`) vuelve a pedir la sesión a Stripe y la aplica: pago único, suscripción o prueba de Lifetime.
5. El webhook es la red de respaldo y la única fuente de renovaciones, pagos fallidos y cancelaciones. Nunca se aplica dos veces lo mismo.

### Compra sin cuenta (solo con un alias)

- **No se crea nada al pulsar "Comprar" o "Probar".** Se reserva el ID de la licencia y viaja en la metadata, con el alias y el hash de un `claimToken` que guarda el navegador.
- **La licencia nace cuando Stripe confirma el cobro o la tarjeta de la prueba.** La crea `guest-confirm` o el webhook, lo que llegue primero.
- **La clave se entrega una vez.** Si la pestaña se cerró, al volver a Membresía en el mismo navegador se recoge sola (dos días como máximo, ver `frontend/src/guestPurchase.js`). Si alguien la pierde, el admin la recupera con "Ver clave" en Licencias.

## Recursos

- https://support.stripe.com
- https://docs.stripe.com/billing/subscriptions/trials
- https://docs.stripe.com/customer-management
