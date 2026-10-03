import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backendUrl, authHeaders, loadSession } from './auth';
import { loadMercadoPagoSdk, loadMercadoPagoSecurityScript } from './mercadopagoSdk';
import { loadMpCheckout, clearMpCheckout } from './mpCheckoutHandoff';

// Pantalla de pago con tarjeta de MercadoPago (Checkout API sobre la Orders
// API), en su propia dirección: /membership/mercadopago. Se entra desde el
// botón "Pagar con Mercado Pago" de Membership.jsx, que deja aquí (ver
// mpCheckoutHandoff.js) qué se compra y los datos de contacto ya llenados.
//
// Los campos de la tarjeta son los Secure Fields del CardForm de
// MercadoPago.js: número, vencimiento y CVV viven en iframes de MercadoPago,
// así que aquí nunca se ve la tarjeta real, solo el token de un solo uso que
// se manda a /api/payments/charge. Ese endpoint (sin cambios con el Brick
// anterior) calcula el monto, normaliza la marca, pide el 3DS y aplica el
// plan.
//
// El CardForm exige en su mapa tres <select> aunque no se muestren
// (issuer, installments, identificationType): los llena él mismo con la
// información del medio de pago, y sin esos nodos en el DOM los iframes se
// pueden quedar sin responder. Van ocultos -- no se ofrecen meses (el
// servidor fija installments: 1), el emisor no hace falta en la Orders API y
// en México no se pide identificación.

// Contenedores de los Secure Fields: se revisan al montar (un iframe cada
// uno y con tamaño) para mostrar un error en vez de cajas vacías.
const SECURE_HOSTS = [
  { id: 'mp-checkout__cardNumber' },
  { id: 'mp-checkout__expirationDate' },
  { id: 'mp-checkout__securityCode' },
];

// Motivos de rechazo por status_detail de la Orders API (nombres cortos,
// confirmado en vivo: un aprobado da "accredited", sin el prefijo cc_ de la
// Payments API). Se dejan también los cc_rejected_* por si alguna vez llegan.
// Si aparece uno nuevo, el backend deja la orden cruda en el registro
// ("Resultado crudo de POST /v1/orders") para agregarlo con el código real.
const DECLINE_REASONS = {
  insufficient_amount: 'Fondos insuficientes.',
  invalid_security_code: 'El código de seguridad (CVV) es incorrecto.',
  invalid_esc: 'El código de seguridad (CVV) es incorrecto.',
  expired_card: 'La tarjeta está vencida.',
  invalid_date: 'La fecha de vencimiento es incorrecta.',
  call_for_authorize: 'Tu banco requiere que autorices este pago directamente con ellos.',
  card_disabled: 'Esta tarjeta está deshabilitada. Contacta a tu banco.',
  duplicated_payment: 'Ya se realizó un pago con estos mismos datos.',
  high_risk: 'El pago fue rechazado por un control de seguridad.',
  max_attempts: 'Alcanzaste el límite de intentos con esta tarjeta.',
  // Desafío 3DS no superado (confirmado en pruebas: la orden queda en
  // failed con este status_detail del pago).
  '3ds_challenge_failed': 'Tu banco no pudo confirmar la verificación. Intenta de nuevo o usa otra tarjeta.',
  cc_rejected_3ds_challenge: 'Tu banco no pudo confirmar la verificación. Intenta de nuevo o usa otra tarjeta.',
  cc_rejected_insufficient_amount: 'Fondos insuficientes.',
  cc_rejected_bad_filled_security_code: 'El código de seguridad (CVV) es incorrecto.',
  cc_rejected_bad_filled_date: 'La fecha de vencimiento es incorrecta.',
  cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta.',
  cc_rejected_bad_filled_card_number: 'El número de tarjeta es incorrecto.',
  cc_rejected_call_for_authorize: 'Tu banco requiere que autorices este pago directamente con ellos.',
  cc_rejected_card_disabled: 'Esta tarjeta está deshabilitada. Contacta a tu banco.',
  cc_rejected_duplicated_payment: 'Ya se realizó un pago con estos mismos datos.',
  cc_rejected_high_risk: 'El pago fue rechazado por un control de seguridad.',
  cc_rejected_max_attempts: 'Alcanzaste el límite de intentos con esta tarjeta.',
  cc_rejected_card_type_not_allowed: 'Este tipo de tarjeta no está permitido.',
  cc_rejected_other_reason: 'El pago fue rechazado. Intenta con otra tarjeta.',
};

function friendlyDeclineMessage(statusDetail) {
  return DECLINE_REASONS[statusDetail] || 'El pago no pudo ser procesado. Intenta con otra tarjeta.';
}

const PLAN_LABELS = { month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' };

// Bordes de los Secure Fields: el borde va en el contenedor (nunca una capa
// encima del iframe), y el iframe ocupa todo el contenedor.
const SECURE_HOST_CLASS = 'theme-input relative h-12 w-full overflow-hidden [&_iframe]:block [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:border-0';

// La misma fuente que carga index.html para todo el sitio: los Secure Fields
// viven en iframes de MercadoPago y no la heredan, hay que pedírsela.
const SITE_FONT_CSS = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap';

// Texto de los Secure Fields igual al del campo "Nombre como aparece en la
// tarjeta" (un input normal con theme-input): se leen sus estilos ya
// calculados, así sigue al tema activo (claro/oscuro, estilo) sin repetir
// colores aquí. MercadoPago solo deja pasar estas propiedades al iframe.
function secureFieldStyle() {
  const reference = document.getElementById('mp-checkout__cardholderName');
  if (!reference) return undefined;
  const computed = getComputedStyle(reference);
  return {
    color: computed.color,
    // Mismo criterio que .placeholder-gray-600 en index.css (el color del
    // texto al 55%): el navegador no deja leer el ::placeholder calculado.
    placeholderColor: `color-mix(in srgb, ${computed.color} 55%, transparent)`,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    padding: `0 ${computed.paddingRight} 0 ${computed.paddingLeft}`,
    webkitFontSmoothing: 'antialiased',
    mozOsxFontSmoothing: 'grayscale',
  };
}

export default function MercadoPagoCheckout() {
  const navigate = useNavigate();
  const [purchase] = useState(() => loadMpCheckout());
  const hasSession = !!loadSession()?.token;
  const [initError, setInitError] = useState('');
  const [formReady, setFormReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [approved, setApproved] = useState(null); // { orderId } | null
  // Desafío 3DS (checklist de calidad de MP): /api/payments/charge devuelve
  // una URL para mostrar en un iframe del banco; al terminar se consulta la
  // orden real (el aviso del iframe no trae el estado final).
  const [challenge, setChallenge] = useState(null); // { url, orderId } | null
  const cardFormRef = useRef(null);

  const canPay = !!purchase && hasSession;
  const amountLabel = purchase ? Number(purchase.amount).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const itemLabel = purchase?.spotifyAddon && !purchase.planType
    ? 'Complemento de Spotify (pago único)'
    : `Plan ${PLAN_LABELS[purchase?.planType] || purchase?.planType || ''}`;

  function finish(data) {
    setPaying(false);
    if (!data.success) {
      setSubmitError(data.error || 'No se pudo procesar el pago.');
      return;
    }
    if (data.status === 'approved') {
      clearMpCheckout();
      setApproved({ orderId: data.orderId });
      return;
    }
    setSubmitError(
      data.status === 'in_process' || data.status === 'pending'
        ? 'Tu pago quedó pendiente de confirmación. Te avisamos en cuanto se confirme.'
        : friendlyDeclineMessage(data.statusDetail)
    );
  }

  function pollOrderStatus(orderId, attempt = 0) {
    fetch(`${backendUrl()}/api/payments/orders/${encodeURIComponent(orderId)}/status`, { headers: { ...authHeaders() } })
      .then(res => res.json())
      .then(data => {
        if (data.success && (data.status === 'pending' || data.status === 'challenge_required') && attempt < 15) {
          setTimeout(() => pollOrderStatus(orderId, attempt + 1), 2000);
          return;
        }
        finish({ ...data, orderId });
      })
      .catch(() => {
        if (attempt < 15) setTimeout(() => pollOrderStatus(orderId, attempt + 1), 2000);
        else finish({ success: false, error: 'No se pudo confirmar el estado del pago.' });
      });
  }

  useEffect(() => {
    if (!challenge) return;
    function handleChallengeMessage(event) {
      if (event.data?.status !== 'COMPLETE') return;
      const { orderId } = challenge;
      setChallenge(null);
      pollOrderStatus(orderId);
    }
    window.addEventListener('message', handleChallengeMessage);
    return () => window.removeEventListener('message', handleChallengeMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  // El CardForm se monta una sola vez por visita, ya con la pantalla visible
  // (requestAnimationFrame: los iframes no se crean dentro de algo oculto) y
  // se desmonta al salir, así nunca quedan dos instancias.
  useEffect(() => {
    if (!canPay || approved) return;
    let cancelled = false;
    let frame = 0;

    const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
    if (!publicKey) {
      setInitError('El cobro con Mercado Pago todavía no está configurado. Intenta más tarde o paga con Stripe.');
      return;
    }

    // Device ID para el antifraude (best-effort: un bloqueador puede frenarlo
    // y el pago debe seguir igual, solo sin esa señal).
    loadMercadoPagoSecurityScript().catch(() => {});

    loadMercadoPagoSdk()
      .then(() => {
        if (cancelled) return;
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          const mp = new window.MercadoPago(publicKey, { locale: 'es-MX' });
          const style = secureFieldStyle();
          const customFonts = [{ src: SITE_FONT_CSS }];
          cardFormRef.current = mp.cardForm({
            amount: Number(purchase.amount).toFixed(2),
            iframe: true,
            form: {
              id: 'mp-checkout-form',
              cardNumber: { id: 'mp-checkout__cardNumber', placeholder: '1234 1234 1234 1234', style, customFonts },
              expirationDate: { id: 'mp-checkout__expirationDate', placeholder: 'MM/AA', style, customFonts },
              securityCode: { id: 'mp-checkout__securityCode', placeholder: 'CVV', style, customFonts },
              cardholderName: { id: 'mp-checkout__cardholderName' },
              issuer: { id: 'mp-checkout__issuer' },
              installments: { id: 'mp-checkout__installments' },
              identificationType: { id: 'mp-checkout__identificationType' },
            },
            callbacks: {
              onFormMounted: (error) => {
                if (cancelled) return;
                if (error) {
                  console.error('[MercadoPagoCheckout] CardForm no se montó:', error);
                  setInitError('No se pudieron cargar los campos seguros de la tarjeta. Si tienes un bloqueador de anuncios, desactívalo para este sitio y recarga.');
                  return;
                }
                requestAnimationFrame(() => {
                  if (cancelled) return;
                  const problems = SECURE_HOSTS.filter(({ id }) => {
                    const host = document.getElementById(id);
                    const rect = host?.getBoundingClientRect();
                    return !host || host.querySelectorAll('iframe').length !== 1 || !rect.width || !rect.height;
                  });
                  if (problems.length) {
                    console.error('[MercadoPagoCheckout] Campos seguros sin montar:', problems.map(p => p.id));
                    setInitError('No se pudieron cargar los campos seguros de la tarjeta. Recarga la página para intentarlo de nuevo.');
                    return;
                  }
                  setFormReady(true);
                });
              },
              onSubmit: (event) => {
                event.preventDefault();
                const current = loadMpCheckout() || purchase;
                const { token, paymentMethodId } = cardFormRef.current.getCardFormData();
                if (!token || !paymentMethodId) {
                  setSubmitError('Revisa los datos de la tarjeta.');
                  return;
                }
                setSubmitError('');
                setPaying(true);
                fetch(`${backendUrl()}/api/payments/charge`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders() },
                  body: JSON.stringify({
                    planType: current.planType || undefined,
                    spotifyAddon: current.spotifyAddon ? true : undefined,
                    email: current.email,
                    firstName: current.firstName,
                    lastName: current.lastName,
                    zipCode: current.zipCode,
                    streetName: current.streetName,
                    streetNumber: current.streetNumber,
                    token,
                    // getCardFormData() devuelve camelCase; el backend
                    // recibe el nombre de siempre.
                    payment_method_id: paymentMethodId,
                    // Se lee recién aquí para darle tiempo a security.js.
                    deviceId: window.MP_DEVICE_SESSION_ID,
                    policyAcceptedAt: current.policyAcceptedAt,
                  }),
                })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success && data.status === 'challenge_required' && data.challengeUrl && data.orderId) {
                      setChallenge({ url: data.challengeUrl, orderId: data.orderId });
                      return;
                    }
                    finish(data);
                  })
                  .catch(() => finish({ success: false, error: 'No se pudo conectar para procesar el pago. Intenta de nuevo.' }));
              },
            },
          });
        });
      })
      .catch(() => {
        if (!cancelled) setInitError('No se pudo cargar Mercado Pago. Revisa tu conexión o si un bloqueador de anuncios lo está frenando, y recarga la página.');
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      try { cardFormRef.current?.unmount(); } catch { /* ya desmontado */ }
      cardFormRef.current = null;
      setFormReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPay, approved]);

  const backToMembership = () => navigate('/membership');

  if (approved) {
    return (
      <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-4">
        <div className="theme-surface w-full max-w-lg p-6 flex flex-col gap-3 text-center" role="status">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">Pago aprobado</p>
          <h1 className="theme-heading text-xl font-black">¡Listo! Tu compra quedó activa</h1>
          {approved.orderId && <p className="text-[11px] text-gray-500">Orden: <strong>{approved.orderId}</strong></p>}
          <p className="text-xs text-gray-400">Si tu plan generó una clave nueva, la verás en Membresía. Guárdala en un lugar seguro.</p>
          <button type="button" onClick={() => navigate('/membership?payment=success')}
            className="theme-btn-primary theme-btn-md w-full font-black tracking-widest uppercase transition-all">
            Ver mi plan y mi clave
          </button>
        </div>
      </div>
    );
  }

  if (!canPay) {
    return (
      <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-4">
        <div className="theme-surface w-full max-w-lg p-6 flex flex-col gap-3">
          <h1 className="theme-heading text-lg font-black">No hay ningún pago en curso</h1>
          <p className="text-xs text-gray-400">
            {hasSession
              ? 'Elige un plan en Membresía, completa tus datos y vuelve a tocar "Pagar con Mercado Pago".'
              : 'Inicia sesión o elige un plan en Membresía antes de pagar.'}
          </p>
          <button type="button" onClick={backToMembership}
            className="theme-btn-primary theme-btn-md w-full font-black tracking-widest uppercase transition-all">
            Ir a Membresía
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-4 overflow-y-auto">
      <div className="w-full max-w-lg flex flex-col gap-1">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">Pago con Mercado Pago</p>
        <h1 className="theme-heading text-2xl font-black">Datos de tu tarjeta</h1>
      </div>

      {/* Total siempre visible arriba del formulario. */}
      <div className="theme-surface-featured w-full max-w-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="theme-label text-[10px]">Vas a pagar</p>
          <p className="text-sm font-black truncate">{itemLabel}</p>
        </div>
        <p className="text-lg font-black whitespace-nowrap">Total: <strong>MX$ {amountLabel}</strong></p>
      </div>

      <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-4">
        <div id="checkout-init-error" role="alert" aria-live="assertive" hidden={!initError} className="theme-notice">{initError}</div>

        <form
          id="mp-checkout-form"
          data-mp-public-key-source="framework-public-config"
          data-mp-payer-email-source="application"
          data-mp-payer-identification-source="application"
          className="flex flex-col gap-4"
          noValidate
        >
          <div data-mp-field="cardNumber" role="group" aria-labelledby="mp-card-number-label">
            <span id="mp-card-number-label" className="theme-label block text-[10px] mb-2">Número de tarjeta</span>
            <div id="mp-checkout__cardNumber" data-mp-secure-field="cardNumber" aria-labelledby="mp-card-number-label" className={SECURE_HOST_CLASS} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div data-mp-field="expirationDate" role="group" aria-labelledby="mp-expiration-label">
              <span id="mp-expiration-label" className="theme-label block text-[10px] mb-2">Vencimiento (MM/AA)</span>
              <div id="mp-checkout__expirationDate" data-mp-secure-field="expirationDate" aria-labelledby="mp-expiration-label" className={SECURE_HOST_CLASS} />
            </div>
            <div data-mp-field="securityCode" role="group" aria-labelledby="mp-security-code-label">
              <span id="mp-security-code-label" className="theme-label block text-[10px] mb-2">Código de seguridad (CVV)</span>
              <div id="mp-checkout__securityCode" data-mp-secure-field="securityCode" aria-labelledby="mp-security-code-label" className={SECURE_HOST_CLASS} />
            </div>
          </div>

          <div data-mp-field="cardholderName">
            <label id="mp-cardholder-name-label" htmlFor="mp-checkout__cardholderName" className="theme-label block text-[10px] mb-2">Nombre como aparece en la tarjeta</label>
            <input id="mp-checkout__cardholderName" aria-labelledby="mp-cardholder-name-label" type="text" autoComplete="cc-name" required
              className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
          </div>

          {/* Nodos que exige el CardForm (ver el comentario de arriba). */}
          <select id="mp-checkout__issuer" data-mp-sdk-required-field="issuer" hidden aria-hidden="true" tabIndex="-1" />
          <select id="mp-checkout__installments" data-mp-sdk-required-field="installments" hidden aria-hidden="true" tabIndex="-1" />
          <select id="mp-checkout__identificationType" data-mp-sdk-required-field="identificationType" hidden aria-hidden="true" tabIndex="-1" />

          {!formReady && !initError && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Mercado Pago...</p>}
          {paying && <p className="text-[10px] text-gray-500 text-center" role="status">Procesando pago...</p>}
          {submitError && <p className="theme-notice" role="alert">{submitError}</p>}

          <button type="submit" disabled={!formReady || paying}
            className="theme-btn-primary theme-btn-md w-full font-black tracking-widest uppercase transition-all disabled:opacity-60">
            {paying ? 'Procesando...' : `Pagar MX$ ${amountLabel}`}
          </button>
        </form>

        <p className="text-[10px] text-gray-500 text-center">
          Pago 100% seguro procesado por <strong>Mercado Pago</strong>. Tus datos de tarjeta nunca pasan por nuestros servidores.
        </p>
        <button type="button" onClick={backToMembership} disabled={paying}
          className="text-[10px] text-gray-500 hover:text-gray-300 underline self-center">
          Volver a Membresía
        </button>
      </div>

      {challenge && (
        <div className="tkc-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="theme-surface w-full max-w-md p-4 flex flex-col gap-3">
            <p className="theme-label text-xs uppercase tracking-widest font-semibold text-center">
              Verificación adicional de tu banco
            </p>
            <p className="text-[10px] text-gray-500 text-center">
              Tu banco pide un paso extra para confirmar que eres tú. No cierres esta ventana.
            </p>
            <iframe src={challenge.url} title="Verificación de seguridad" className="w-full h-[420px] rounded-lg border-0" />
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setPaying(false);
                setSubmitError('Verificación cancelada. Puedes intentar de nuevo.');
              }}
              className="theme-btn-secondary theme-btn-sm w-full font-bold uppercase tracking-widest transition-all"
            >
              Cancelar verificación
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
