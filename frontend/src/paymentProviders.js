// Medios de pago que ofrece el sitio. Stripe es el único oficial (pedido
// explícito): MercadoPago queda apagado, pero su integración (pantalla
// MercadoPagoCheckout.jsx, /api/payments/charge y su webhook) se conserva
// por si se quiere volver a ofrecer. Para encenderlo de nuevo basta con
// VITE_MERCADOPAGO_ENABLED=true en las variables del frontend y un nuevo
// build; sin esa variable no aparece en ningún lado.
export const MERCADOPAGO_ENABLED = import.meta.env.VITE_MERCADOPAGO_ENABLED === 'true';
