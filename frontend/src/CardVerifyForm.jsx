import { useEffect, useRef, useState } from 'react';
import { backendUrl, requestFreeTrial } from './auth';
import { MORPH_SUCCESS_HOLD_MS, wait } from './motion';
import { mountCheckoutForm, friendlyDeclineMessage, reportStripeError, LOAD_ERROR_MESSAGE } from './stripeCheckout';

const DECLINE_FALLBACK = 'No se pudo verificar la tarjeta. Revisa los datos e intenta de nuevo.';

// Verifica una tarjeta real para desbloquear la prueba gratis sin ver
// anuncios — a propósito NO cobra nada: es el mismo formulario de Checkout
// de Stripe que el cobro (ver StripePaymentForm.jsx y stripeCheckout.js),
// pero con una sesión en modo 'setup', pensada para autenticar que una
// tarjeta es real (puede pedir 3DS) sin capturar ningún monto. Ver
// /api/free-trial/checkout-session y /api/free-trial en server.js.
//
// Al validar, llama a onResult({ key, token, license }) — el mismo shape
// que ya maneja Membership.jsx para el camino de anuncios (trialResult),
// así la pantalla de "guarda tu clave" es una sola, compartida entre las
// tres vías. `alias`/`setAlias` son controlados desde afuera (pedido
// explícito: un solo input de alias compartido entre la prueba gratis y
// la compra directa, no uno propio acá adentro que obligue a escribirlo
// dos veces).
export default function CardVerifyForm({ alias, setAlias, onResult, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);
  const startedRef = useRef(false);
  const formRef = useRef(null);
  // El botón de verificar es el del propio formulario de Stripe: su
  // handler se crea una sola vez y lee el alias/onResult actuales de acá.
  const aliasRef = useRef(alias);
  const onResultRef = useRef(onResult);
  useEffect(() => { aliasRef.current = alias; }, [alias]);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  const hasAlias = !!alias.trim();

  useEffect(() => {
    // Una sola vez al montar (el ref también evita una segunda sesión por
    // el doble montaje del modo estricto de React).
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      let data;
      try {
        const res = await fetch(`${backendUrl()}/api/free-trial/checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        data = await res.json();
      } catch {
        setLoadError('No se pudo cargar el formulario de tarjeta. Revisa tu conexión o intenta más tarde.');
        return;
      }
      if (!data.success) {
        setLoadError(data.error || 'No se pudo cargar el formulario de tarjeta.');
        return;
      }

      formRef.current = await mountCheckoutForm({
        clientSecret: data.clientSecret,
        container: containerRef.current,
        onReady: () => setLoading(false),
        onLoadError: (stripeError) => {
          setLoading(false);
          setLoadError(LOAD_ERROR_MESSAGE);
          reportStripeError('free-trial-verify', stripeError);
        },
        onConfirm: async (_event, confirm) => {
          const cleanAlias = aliasRef.current.trim();
          // El formulario solo se muestra con un alias escrito (ver abajo);
          // esto cubre que lo borren con el formulario ya a la vista.
          if (!cleanAlias) {
            setError('Escribe un alias antes de verificar la tarjeta.');
            return;
          }
          setSubmitting(true);
          setError('');
          try {
            const result = await confirm();
            if (result.type === 'error') {
              setError(friendlyDeclineMessage(result.error, DECLINE_FALLBACK));
              reportStripeError('free-trial-verify', result.error);
              return;
            }
            // Nunca se confía en que el frontend diga "verificada" -- el
            // backend vuelve a pedir la sesión a la propia API de Stripe
            // antes de crear la licencia (ver /api/free-trial en server.js).
            const trial = await requestFreeTrial(cleanAlias, data.checkoutSessionId);
            setVerified(true);
            await wait(MORPH_SUCCESS_HOLD_MS);
            onResultRef.current(trial);
          } catch (err) {
            setError(err.message || DECLINE_FALLBACK);
          } finally {
            setSubmitting(false);
          }
        },
      });
    })().catch((err) => {
      // Stripe.js puede lanzar al iniciar/montar: sin esto se quedaba en
      // "Cargando".
      setLoading(false);
      setLoadError(LOAD_ERROR_MESSAGE);
      reportStripeError('free-trial-verify', err?.stripeError || { message: err?.message || String(err) });
    });
  }, []);

  // Aparte del efecto de arriba: el desmontaje falso del modo estricto
  // llega antes de que exista el formulario; el real (Cancelar / prueba
  // creada) lo quita.
  useEffect(() => () => {
    try { formRef.current?.destroy?.(); } catch { /* ya desmontado */ }
    formRef.current = null;
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="theme-label text-xs uppercase tracking-widest font-semibold">Verificar tarjeta</p>
      <p className="text-[11px] text-gray-500">
        No se te cobra nada — Stripe solo autentica que la tarjeta es real, como alternativa a ver anuncios.
      </p>

      <input
        value={alias}
        onChange={e => setAlias(e.target.value)}
        placeholder="Elige un alias"
        disabled={submitting || verified}
        className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
      />

      {loadError ? (
        <p className="theme-notice">{loadError}</p>
      ) : (
        <>
          {loading && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de Stripe...</p>}
          {!loading && !hasAlias && <p className="text-[10px] text-gray-500 text-center">Escribe un alias para continuar.</p>}
          {/* Se monta desde el inicio (así ya está listo) pero solo se ve con
              un alias escrito. Fondo blanco: apariencia clara de Checkout
              Studio también en el tema oscuro. */}
          <div ref={containerRef} className={loading || !hasAlias ? 'hidden' : 'rounded bg-white p-3'} />
          {submitting && !verified && <p className="text-[10px] text-gray-500 text-center">Verificando la tarjeta…</p>}
          {verified && <p className="text-[11px] font-bold text-emerald-600 text-center tkc-msg-enter">Tarjeta verificada. Activando tu prueba gratis…</p>}
          {error && <p className="theme-notice tkc-msg-enter">{error}</p>}
        </>
      )}

      <button type="button" onClick={onCancel} disabled={submitting} className="theme-btn-secondary theme-btn-sm w-full font-bold uppercase tracking-widest transition-all disabled:opacity-40">
        Cancelar
      </button>
    </div>
  );
}
