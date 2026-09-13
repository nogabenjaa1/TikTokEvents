import React, { useEffect, useRef, useState } from 'react';
import { backendUrl, authHeaders } from './auth';
import { loadMercadoPagoSdk, loadMercadoPagoSecurityScript } from './mercadopagoSdk';

const BRICK_CONTAINER_ID = 'card-payment-brick-container';

// Mensajes de rechazo mapeados por status_detail. El backend cobra via la
// Orders API (Checkout API) -- su status_detail usa nombres mas cortos que
// la vieja Payments API (confirmado en vivo: un pago aprobado dio
// status_detail "accredited", sin el prefijo cc_ de la API vieja) -- se
// dejan ademas las claves con prefijo cc_rejected_* por si alguna vez
// coinciden, pero la lista corta (sin prefijo) es la prioritaria para esta
// integracion. Si aparece un status_detail nuevo no mapeado aca, el
// backend ya deja el pago crudo logueado (ver "Resultado crudo de POST
// /v1/orders" en los logs) para poder agregarlo con el codigo real.
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

// Cobro directo dentro del propio sitio vía el Card Payment Brick de
// MercadoPago — reemplaza (mientras dure el bug confirmado del checkout
// hosteado de MP) el redirect de create-preference. El Brick tokeniza la
// tarjeta en un iframe de MercadoPago; acá nunca se ve el número real, solo
// el token + payment_method_id que arma en su callback onSubmit.
export default function CardPaymentForm({ planType, diceTier, amount, email, firstName, lastName, zipCode, streetName, streetNumber, onSuccess, onCancel }) {
  const [sdkState, setSdkState] = useState('loading'); // loading | ready | error | no-key
  const [submitError, setSubmitError] = useState('');
  const [pending, setPending] = useState(false);
  const controllerRef = useRef(null);
  // El Brick se crea una sola vez (ver el useEffect de mas abajo, que solo
  // depende de sdkState) y su callback onSubmit queda fijo desde ese
  // momento -- si onSubmit cerrara directo sobre email/zipCode/etc. como
  // props, seguiria mandando para siempre el valor que tenian en el
  // instante exacto en que se creo el Brick, aunque el streamer despues
  // edite el correo o la direccion en los inputs de arriba (bug real: el
  // streamer terminaba pagando con el correo vacio de antes de escribir,
  // y el backend rechazaba con "correo invalido" pese a que en pantalla
  // ya se veia el correo correcto). Este ref se actualiza en cada render
  // para que onSubmit siempre lea el valor mas reciente.
  const latestRef = useRef({ planType, diceTier, email, firstName, lastName, zipCode, streetName, streetNumber });
  useEffect(() => {
    latestRef.current = { planType, diceTier, email, firstName, lastName, zipCode, streetName, streetNumber };
  });
  // Challenge 3DS (checklist de calidad de MP, "Protocolo de seguridad
  // 3DS"): cuando MercadoPago quiere una segunda verificacion con el banco
  // en vez de aprobar/rechazar de una, /api/payments/charge devuelve una
  // URL para mostrar en un iframe. resolve/reject del Promise de onSubmit
  // quedan guardados acá (no se puede volver a llamar onSubmit para
  // recuperarlos) hasta que el challenge termine y se confirme el status
  // real -- ver pollOrderStatus mas abajo.
  const [challenge, setChallenge] = useState(null); // { url, orderId } | null
  const challengeCallbacksRef = useRef(null);

  function settle(data, resolve, reject) {
    setPending(false);
    if (!data.success) {
      setSubmitError(data.error || 'No se pudo procesar el pago.');
      reject();
      return;
    }
    if (data.status !== 'approved') {
      setSubmitError(
        data.status === 'in_process' || data.status === 'pending'
          ? 'Tu pago quedó pendiente de confirmación — te avisamos apenas se confirme.'
          : friendlyDeclineMessage(data.statusDetail)
      );
      reject();
      return;
    }
    onSuccess?.(data);
    resolve();
  }

  // El propio doc de MercadoPago aclara que el mensaje "COMPLETE" del
  // iframe solo avisa que el challenge terminó, no que el pago ya tiene
  // status final -- hay que insistir un rato consultando la orden real.
  function pollOrderStatus(orderId, resolve, reject, attempt = 0) {
    fetch(`${backendUrl()}/api/payments/orders/${orderId}/status`, { headers: { ...authHeaders() } })
      .then(res => res.json())
      .then(data => {
        if (data.success && (data.status === 'pending' || data.status === 'challenge_required') && attempt < 15) {
          setTimeout(() => pollOrderStatus(orderId, resolve, reject, attempt + 1), 2000);
          return;
        }
        settle(data, resolve, reject);
      })
      .catch(() => {
        if (attempt < 15) {
          setTimeout(() => pollOrderStatus(orderId, resolve, reject, attempt + 1), 2000);
        } else {
          settle({ success: false, error: 'No se pudo confirmar el estado del pago.' }, resolve, reject);
        }
      });
  }

  useEffect(() => {
    if (!challenge) return;
    function handleChallengeMessage(event) {
      if (event.data?.status !== 'COMPLETE') return;
      const callbacks = challengeCallbacksRef.current;
      setChallenge(null);
      if (!callbacks) return;
      pollOrderStatus(challenge.orderId, callbacks.resolve, callbacks.reject);
    }
    window.addEventListener('message', handleChallengeMessage);
    return () => window.removeEventListener('message', handleChallengeMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  useEffect(() => {
    let cancelled = false;
    loadMercadoPagoSdk()
      .then(() => { if (!cancelled) setSdkState('ready'); })
      .catch(() => { if (!cancelled) setSdkState('error'); });
    // Best-effort: si un bloqueador de anuncios/privacidad frena este
    // script (le pasa a veces a la propia telemetria de MP, ver consola),
    // el pago debe poder seguir igual, solo sin device id.
    loadMercadoPagoSecurityScript().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (sdkState !== 'ready') return;
    const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
    if (!publicKey) { setSdkState('no-key'); return; }

    let cancelled = false;
    const mp = new window.MercadoPago(publicKey, { locale: 'es-MX' });
    const bricksBuilder = mp.bricks();

    bricksBuilder.create('cardPayment', BRICK_CONTAINER_ID, {
      initialization: { amount, payer: { email } },
      // Pedido explicito de MercadoPago (checklist de calidad, "Maximo de
      // cuotas"): create-preference ya lo limitaba, pero el camino que de
      // verdad se usa hoy es este Brick -- sin esto seguia ofreciendo hasta
      // 18 cuotas para pagos de $10-$1800 MXN.
      customization: { paymentMethods: { maxInstallments: 1 } },
      callbacks: {
        onReady: () => {},
        onError: (error) => {
          console.error('[CardPaymentForm] Brick error:', error);
          setSubmitError('No se pudo cargar el formulario de pago. Intenta de nuevo.');
        },
        onSubmit: (formData) => new Promise((resolve, reject) => {
          const current = latestRef.current;
          setSubmitError('');
          setPending(true);
          fetch(`${backendUrl()}/api/payments/charge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              planType: current.planType,
              diceTier: current.diceTier,
              email: current.email,
              // Pedido explicito de MercadoPago (checklist de calidad,
              // "Nombre/Apellido del comprador"): campos propios (ver
              // Membership.jsx), en vez de partir formData.cardholderName
              // (el nombre del titular que pide el Brick para la tarjeta,
              // que puede no coincidir o venir incompleto -- ej. sin
              // apellido).
              firstName: current.firstName,
              lastName: current.lastName,
              zipCode: current.zipCode,
              streetName: current.streetName,
              streetNumber: current.streetNumber,
              token: formData.token,
              payment_method_id: formData.payment_method_id,
              installments: formData.installments,
              issuer_id: formData.issuer_id,
              // Pedido explicito de MercadoPago (checklist de calidad,
              // "Identificador del dispositivo"): se lee recién aquí
              // (no antes) para dar tiempo a que security.js ya haya
              // corrido. undefined si el script no cargo (bloqueador, red
              // lenta) -- el backend lo manda solo si vino.
              deviceId: window.MP_DEVICE_SESSION_ID,
              identificationType: formData.payer?.identification?.type,
              identificationNumber: formData.payer?.identification?.number,
            }),
          })
            .then(res => res.json())
            .then(data => {
              if (data.success && data.status === 'challenge_required' && data.challengeUrl && data.orderId) {
                // Sigue "procesando" (pending se queda en true) -- ahora el
                // comprador tiene que confirmar con su banco en el iframe.
                challengeCallbacksRef.current = { resolve, reject };
                setChallenge({ url: data.challengeUrl, orderId: data.orderId });
                return;
              }
              settle(data, resolve, reject);
            })
            .catch(() => {
              setPending(false);
              setSubmitError('No se pudo conectar para procesar el pago. Intenta de nuevo.');
              reject();
            });
        }),
      },
    }).then(controller => {
      if (cancelled) { controller.unmount(); return; }
      controllerRef.current = controller;
    });

    return () => {
      cancelled = true;
      controllerRef.current?.unmount();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkState]);

  if (sdkState === 'error' || sdkState === 'no-key') {
    return (
      <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">
          {sdkState === 'no-key'
            ? 'El cobro con tarjeta todavía no está configurado. Intenta más tarde.'
            : 'No se pudo cargar el formulario de pago. Revisa tu conexión o intenta más tarde.'}
        </p>
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
      {sdkState === 'loading' && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de MercadoPago...</p>}
      {pending && <p className="text-[10px] text-gray-500 text-center">Procesando pago...</p>}
      {submitError && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{submitError}</p>}
      <div id={BRICK_CONTAINER_ID} />
      {/* Pedido explicito de MercadoPago (checklist de calidad,
          "Logos oficiales de Mercado Pago"): refuerza confianza en el
          comprador -- no impacta el puntaje, pero ayuda a la conversion. */}
      <p className="text-[9px] text-gray-500 text-center flex items-center justify-center gap-1">
        🔒 Pago 100% seguro procesado por <strong>Mercado Pago</strong>
      </p>
      {challenge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
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
                const callbacks = challengeCallbacksRef.current;
                setChallenge(null);
                setPending(false);
                setSubmitError('Verificación cancelada. Puedes intentar de nuevo.');
                callbacks?.reject();
              }}
              className="theme-btn-secondary w-full py-2 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all"
            >
              Cancelar verificación
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
