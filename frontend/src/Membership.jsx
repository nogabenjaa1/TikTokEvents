import { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders, refreshSession, saveSession, loginWithKey } from './auth';
import { loadPendingGuestPurchase, clearPendingGuestPurchase, confirmGuestPurchase } from './guestPurchase';
import MorphButton from './MorphButton';
import LegalLinks from './LegalLinks';
import HoneypotField from './HoneypotField';
import { MORPH_MIN_LOADING_MS, MORPH_SUCCESS_HOLD_MS, wait } from './motion';
import StripePaymentForm from './StripePaymentForm';
import RefundPolicyModal from './RefundPolicyModal';

// Mensual y Anual son suscripciones (se cobran solas cada periodo); Lifetime
// es un pago único. Los tres tienen prueba de 14 días con tarjeta (ver
// backend/lib/stripeBilling.js).
const PLANS = [
  { id: 'month', label: 'Mensual', mxn: 126, period: '/ mes', after: 'cada mes' },
  { id: 'annual', label: 'Anual', mxn: 1080, period: '/ año', after: 'cada año', savingsChip: 'AHORRAS MX$430' },
  { id: 'lifetime', label: 'Lifetime', mxn: 1800, period: 'pago único', after: 'una sola vez' },
];
const SUBSCRIPTION_PLANS = ['month', 'annual'];
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const formatDate = (ms) => new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const PLAN_RANK = { month: 1, annual: 2, lifetime: 3 };
// El complemento de Spotify (pago único, solo para el plan Mensual — Anual y
// Lifetime ya lo incluyen) se compra por el mismo flujo de tarjeta que un
// plan, con este id de mentira en `payingPlan`: nunca se manda como planType
// al backend (ver `buyingAddon` más abajo, va como `spotifyAddon`). El precio
// real lo manda /api/pricing; este es solo el de respaldo (ver
// backend/pricing.js).
const SPOTIFY_ADDON_ID = 'spotify_addon';
const DEFAULT_SPOTIFY_ADDON_MXN = 180;
// Referencia aproximada MXN por USD -- pedido explicito: que la
// referencia en dolares que ve el streamer se recalcule sola en cuanto el
// admin cambie el precio en MXN desde el panel, en vez de quedar como un
// texto fijo desincronizado. Es solo informativa (MXN sigue siendo la
// única moneda que de verdad se cobra, ver pricing.js) -- si el
// tipo de cambio real se mueve mucho, alcanza con ajustar este numero.
const MXN_PER_USD = 18;

const PLAN_LABELS = { day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba gratis' };
// El WIN BONUS de Color Says dejó de venderse como addon PRO/VIP (pedido
// explícito: la dinámica debe ser transparente por default) — ahora es una
// excepción manual que un admin prende por licencia puntual desde el panel
// de Licencias, nunca algo que se compre acá. `DICE_TIER_LABELS` se
// mantiene solo para mostrar el nivel actual en el resumen de abajo — el
// nivel en sí ya no tiene una vitrina de compra.
const DICE_TIER_LABELS = { regular: 'Regular', pro: 'PRO', vip: 'VIP', admin: 'Admin' };

const LIFETIME_LEGEND = 'El acceso Lifetime cubre la plataforma y sus actualizaciones estándar. Funciones o servicios con costos operativos especiales —como IA, voces premium, servidores o integraciones de pago— podrán ofrecerse por separado.';

// Pantalla de autoservicio de pago (formulario de Stripe embebido aquí; el
// correo y el nombre los pide el propio formulario de Stripe).
// Funciona con o sin sesión. Sin sesión va en dos pasos: 1) el alias, que
// va en la clave (alias-plan-hash), y 2) el plan, comprado al momento o con
// 14 días gratis. Nada se crea por adelantado: la licencia nace solo cuando
// Stripe confirma el cobro o la tarjeta de la prueba (ver guestPurchase.js y
// /api/payments/stripe/guest-checkout-session).
// `session` trae licenseType/expiresAt/diceTier ya guardados en el token
// (ver auth.js); `onSessionUpdate` deja que App.jsx refresque su estado
// después de crear la cuenta y/o de volver de un pago.

// Cómo va el cobro de la licencia, en una frase (ver sessionLicense.billing en
// el backend).
function billingSummary(billing, session, livePrices) {
  const planInfo = PLANS.find(p => p.id === billing.plan);
  const price = (cents, plan) => `MX$${((cents ?? livePrices?.[plan] ?? (planInfo?.mxn || 0) * 100) / 100).toLocaleString('es-MX')}`;
  const end = session?.expiresAt ? formatDate(session.expiresAt) : null;
  if (billing.plan === 'lifetime' && billing.lifetimeChargeAt) {
    return `Prueba de Lifetime: el ${formatDate(billing.lifetimeChargeAt)} se cobrarán ${price(billing.lifetimeAmountCents, 'lifetime')} una sola vez, salvo que la canceles antes.`;
  }
  if (billing.plan === 'lifetime' && billing.status === 'payment_failed') {
    return 'No se pudo cobrar Lifetime al terminar la prueba. Tu acceso termina al acabar la prueba; puedes comprar Lifetime cuando quieras.';
  }
  if (billing.plan === 'lifetime' && billing.status === 'canceled') {
    return `Cancelaste tu prueba de Lifetime: no se cobrará nada y tu acceso termina el ${end}.`;
  }
  if (!SUBSCRIPTION_PLANS.includes(billing.plan)) return '';
  if (billing.cancelAt) return `Suscripción cancelada: no se cobrará más y tu acceso sigue hasta el ${formatDate(billing.cancelAt)}.`;
  if (billing.status === 'trialing') {
    return `Prueba gratis del plan ${planInfo?.label} hasta el ${end}. Ese día se cobrarán ${price(null, billing.plan)} y después ${planInfo?.after}, salvo que la canceles antes.`;
  }
  if (billing.status === 'past_due' || billing.status === 'unpaid') {
    return 'No pudimos cobrar la renovación. Revisa tu tarjeta en "Gestionar suscripción" para no perder tu plan.';
  }
  if (billing.status === 'canceled') return `Tu suscripción terminó; tu acceso sigue hasta el ${end}.`;
  return `Tu plan ${planInfo?.label} se renueva solo ${planInfo?.after}. Puedes cambiar tu tarjeta o cancelar en "Gestionar suscripción".`;
}

export default function Membership({ session, onSessionUpdate, onNavigate }) {
  const [alias, setAlias] = useState('');
  // Plan que se esta pagando ahora mismo con el formulario de Stripe
  // embebido -- null si no hay ningun pago en curso. El comprador nunca sale
  // de este sitio con este camino.
  const [payingPlan, setPayingPlan] = useState(null);
  // Si lo que se está pagando es la prueba de 14 días de ese plan.
  const [payingTrial, setPayingTrial] = useState(false);
  const [error, setError] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);
  // Pedido explicito: aceptación obligatoria de la política de reembolsos
  // antes de poder pagar -- no evita que alguien dispute con su banco (eso
  // lo decide el banco, no acá), pero le da a Stripe evidencia
  // real (aceptación explícita, CON FECHA) para pelear y ganar la disputa
  // si llega. `policyAcceptedAt` (null = no aceptó todavía) es lo que de
  // verdad viaja al backend (ver StripePaymentForm más abajo) -- se guarda el momento exacto del check, no `Date.now()` leído
  // de nuevo en cada render.
  const [policyAcceptedAt, setPolicyAcceptedAt] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const policyCheckboxRef = useRef(null);
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('payment'));
  const [revealedKey, setRevealedKey] = useState(null);
  const [keyCopied, setKeyCopied] = useState(false);
  // Clave de una licencia recién comprada sin cuenta: se muestra arriba para
  // que la guarde (es su única credencial).
  const [newLicenseKey, setNewLicenseKey] = useState(null);
  const [newKeyCopied, setNewKeyCopied] = useState(false);
  // Una compra sin cuenta guardada en este navegador que todavía no se
  // confirma (ver el efecto de recuperación más abajo).
  const [guestClaimPending, setGuestClaimPending] = useState(false);

  const aliasInputRef = useRef(null);
  const loginInputRef = useRef(null);
  // El enlace del encabezado lleva al acceso con clave, que está al final.
  const focusLogin = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    loginInputRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    loginInputRef.current?.focus({ preventScroll: true });
  };
  // Error propio del alias (no el `error` genérico de más abajo, que
  // renderiza al final de toda la página -- lejos del input, ver el
  // comentario en handleBuy) para que el aviso quede pegado al campo.
  const [aliasError, setAliasError] = useState('');

  // Un solo alias para la compra y para la prueba de 14 días.
  const requireAlias = () => {
    if (alias.trim()) return true;
    setAliasError('Elige un alias antes de continuar.');
    aliasInputRef.current?.focus();
    return false;
  };

  // Precios vigentes desde el backend (pueden diferir de los defaults de
  // PLANS de abajo si el admin los edito desde el panel de Licencias, ver
  // GET /api/pricing) -- null mientras no llego la respuesta, ahi se usa el
  // default como fallback para no dejar la vitrina en blanco un instante.
  const [livePrices, setLivePrices] = useState(null);
  // Lo demás que trae /api/pricing: el precio vigente del complemento de
  // Spotify (centavos) y los cupos de la app de Spotify de la plataforma
  // ({ total, used }) para avisar cuántos quedan a los primeros Lifetime.
  const [pricingExtras, setPricingExtras] = useState({ spotifyAddon: null, spotifySlots: null });
  useEffect(() => {
    fetch(`${backendUrl()}/api/pricing`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        setLivePrices(data.prices);
        setPricingExtras({ spotifyAddon: data.spotifyAddon ?? null, spotifySlots: data.spotifySlots ?? null });
      })
      .catch(() => {}); // sin precios en vivo, se sigue viendo el default
  }, []);
  const spotifyAddonMxn = pricingExtras.spotifyAddon != null ? pricingExtras.spotifyAddon / 100 : DEFAULT_SPOTIFY_ADDON_MXN;
  const spotifySlots = pricingExtras.spotifySlots;
  const spotifySlotsLeft = spotifySlots ? Math.max(0, spotifySlots.total - spotifySlots.used) : null;

  // Ingresar con una clave que ya tienes (admin, prueba gratis guardada de
  // antes, etc.) sin tener que entrar a un panel de juego bloqueado primero
  // — antes esta era la única forma de loguearse: el Login embebido que
  // aparece dentro de Rey del Trono/Zubastinis/etc. cuando no hay sesión.
  const [loginKey, setLoginKey] = useState('');
  const [loginError, setLoginError] = useState('');
  // idle | loading | success | error: lo cuenta el botón con su forma (ver MorphButton).
  const [loginStatus, setLoginStatus] = useState('idle');
  const loginLoading = loginStatus === 'loading' || loginStatus === 'success';

  const submitLogin = async (e) => {
    e.preventDefault();
    if (!loginKey.trim() || loginLoading) return;
    setLoginStatus('loading');
    setLoginError('');
    const minLoading = wait(MORPH_MIN_LOADING_MS); // ver Login.jsx
    try {
      const trimmedKey = loginKey.trim();
      const { token, license } = await loginWithKey(trimmedKey);
      await minLoading;
      saveSession({ token, licenseKey: trimmedKey, ...license });
      setLoginStatus('success');
      await wait(MORPH_SUCCESS_HOLD_MS);
      onSessionUpdate?.({ token, licenseKey: trimmedKey, ...license });
      setLoginKey('');
      setLoginStatus('idle');
    } catch (err) {
      await minLoading;
      setLoginError(err.message || 'Licencia inválida, revocada o expirada');
      setLoginStatus('error');
    }
  };

  useEffect(() => {
    if (!banner) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (banner === 'success' || banner === 'pending') {
      refreshSession().then(updated => {
        if (!updated) return;
        onSessionUpdate?.(updated);
        if (updated.revealedKey) setRevealedKey(updated.revealedKey);
      });
    }
  }, [banner, onSessionUpdate]);

  const currentPlanRank = PLAN_RANK[session?.licenseType] ?? -1;
  // Lo que se está pagando ahora: un plan, o el complemento de Spotify (que
  // viaja al backend como `spotifyAddon`, nunca como planType).
  const buyingAddon = payingPlan === SPOTIFY_ADDON_ID;
  const payingAmountMxn = buyingAddon
    ? spotifyAddonMxn
    : (livePrices?.[payingPlan] != null ? livePrices[payingPlan] / 100 : PLANS.find(p => p.id === payingPlan)?.mxn);
  // Qué incluye Spotify cada licencia, para el resumen y el bloque de
  // complementos (ver backend/spotify.js, isLicenseAllowed).
  const spotifyIncluded = !!session && (session.isAdmin || session.licenseType === 'annual' || session.licenseType === 'lifetime');
  // Solo el plan Mensual (o menor) sin el complemento puede comprarlo; se resalta arriba.
  const canBuyAddon = !!session && !spotifyIncluded && !session.spotifyAddon && session.licenseType === 'month';
  const spotifyStatusLabel = spotifyIncluded ? 'Incluido' : session?.spotifyAddon ? 'Complemento activo' : 'No incluido';

  const readyToPay = !!policyAcceptedAt;
  const payingPlanInfo = PLANS.find(p => p.id === payingPlan) || null;
  // Le queda tiempo pagado: el primer cobro de la suscripción espera a que
  // termine (el backend hace lo mismo, ver createPurchaseCheckoutSession).
  const firstChargeLater = !!session && !payingTrial && SUBSCRIPTION_PLANS.includes(payingPlan)
    && session.licenseType !== 'trial' && session.expiresAt > Date.now() + 2 * DAY_MS;

  // Botón "Continuar con el pago" (visible mientras no se acepte la
  // política): lleva el foco al checkbox y dice qué falta.
  const attemptContinue = () => {
    setPolicyError('Acepta la política de reembolsos para continuar.');
    policyCheckboxRef.current?.focus();
  };

  const copyRevealedKey = () => {
    navigator.clipboard.writeText(revealedKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  // Sin sesión solo hace falta el alias: no se crea nada hasta que el pago se
  // confirme (ver el comentario del componente). `trial`: la prueba de 14 días.
  const handleBuy = (planType, { trial = false } = {}) => {
    if (!planType) return;
    setError('');
    if (!session && !requireAlias()) return;
    setPayingTrial(trial);
    setPayingPlan(planType);
  };

  // La prueba es para empezar: no para una licencia que ya paga un plan
  // vigente, ni mientras ya hay una prueba en curso (el backend lo vuelve a
  // comprobar, y una tarjeta solo tiene una prueba).
  const paidActive = !!session && ['month', 'annual', 'lifetime'].includes(session.licenseType)
    && (session.expiresAt == null || session.expiresAt > Date.now());
  const billingInfo = session?.billing || null;
  const trialInProgress = !!session && session.licenseType === 'trial' && billingInfo?.status === 'trialing';
  const canTrial = !session || (!paidActive && !trialInProgress && !session.isAdmin);

  // Portal de Stripe: tarjeta, recibos y cancelar la suscripción (también
  // durante la prueba, antes del primer cobro).
  const openBillingPortal = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/billing/portal`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success || !data.url) throw new Error(data.error || 'No se pudo abrir la gestión de tu suscripción.');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBillingBusy(false);
    }
  };

  const cancelLifetimeTrial = async () => {
    if (billingBusy) return;
    if (!window.confirm('¿Cancelar tu prueba de Lifetime? No se te cobrará nada y tu acceso termina el día que acaba la prueba.')) return;
    setBillingBusy(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/billing/cancel-lifetime-trial`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo cancelar la prueba.');
      const updated = await refreshSession();
      if (updated) onSessionUpdate?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBillingBusy(false);
    }
  };

  // Compra sin cuenta aprobada: la licencia ya existe; se entra con ella y se
  // muestra la clave para que la guarde.
  const handleGuestPurchaseSuccess = ({ key, token, license }) => {
    const created = { token, licenseKey: key, ...license };
    saveSession(created);
    setPayingPlan(null);
    setPolicyAcceptedAt(null);
    setGuestClaimPending(false);
    setNewLicenseKey(key);
    setBanner(license?.licenseType === 'trial' ? 'trial-started' : 'created');
    onSessionUpdate?.(created);
  };

  const copyNewLicenseKey = () => {
    navigator.clipboard.writeText(newLicenseKey);
    setNewKeyCopied(true);
    setTimeout(() => setNewKeyCopied(false), 2000);
  };

  // Una compra sin cuenta que se pagó pero cuya clave no se llegó a recoger
  // (se cerró la pestaña o el banco sacó al comprador del sitio): al volver a
  // Membresía en este navegador se reclama sola.
  useEffect(() => {
    if (session) return undefined;
    const pending = loadPendingGuestPurchase();
    if (!pending) return undefined;
    let cancelled = false;
    confirmGuestPurchase({ backendUrl: backendUrl(), checkoutSessionId: pending.checkoutSessionId, claimToken: pending.claimToken, attempts: 2 })
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'approved') {
          clearPendingGuestPurchase();
          handleGuestPurchaseSuccess(result);
        } else if (result.status === 'gone') {
          clearPendingGuestPurchase();
        } else {
          setGuestClaimPending(true);
        }
      });
    return () => { cancelled = true; };
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se llama cuando /api/payments/charge confirma un pago aprobado -- mismo
  // flujo que ya usaba el banner de exito del redirect (refrescar la sesion
  // y mostrar la clave rotada si el plan nuevo genero una).
  const handlePaymentSuccess = async () => {
    setPayingPlan(null);
    setBanner(payingTrial ? 'trial-started' : 'success');
    const updated = await refreshSession();
    if (!updated) return;
    onSessionUpdate?.(updated);
    if (updated.revealedKey) setRevealedKey(updated.revealedKey);
  };

  return (
    <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-6 overflow-y-auto">
      <div className="w-full max-w-3xl flex flex-col gap-1">
        <p className="theme-accent-text tkc-eyebrow">Membresía</p>
        <h1 className="theme-heading text-2xl font-black">{session ? 'Tu plan y tus pagos' : 'Elige cómo empezar'}</h1>
        <p className="text-sm text-gray-500">
          {session
            ? 'Revisa tu plan actual, mejóralo o renuévalo cuando quieras.'
            : `Primero elige tu alias; luego compra un plan o pruébalo ${TRIAL_DAYS} días gratis. Tu clave es tu única credencial: guárdala en un lugar seguro.`}
        </p>
        {/* El acceso con clave quedó al final de la pantalla (lo primero son
            los planes): este enlace lleva directo a él. */}
        {!session && (
          <button type="button" onClick={focusLogin} className="theme-link self-start">
            ¿Ya tienes una clave? Entra aquí
          </button>
        )}
      </div>

      {/* El aviso del sistema (theme-notice, ver DESIGN.md › Avisos): mismo
          aspecto y contraste que el resto de los avisos, también en oscuro. */}
      {banner && (
        <div role={banner === 'failure' ? 'alert' : 'status'} className={['w-full max-w-3xl theme-notice theme-notice-roomy',
          banner === 'success' || banner === 'created' || banner === 'trial-started' ? 'theme-notice-success' : banner === 'pending' ? 'theme-notice-warning' : 'theme-notice-danger'].join(' ')}>
          {banner === 'success' && '¡PAGO APROBADO! TU LICENCIA YA SE ACTUALIZÓ.'}
          {banner === 'trial-started' && `¡LISTO! TU PRUEBA GRATIS DE ${TRIAL_DAYS} DÍAS YA EMPEZÓ.`}
          {banner === 'created' && '¡PAGO APROBADO! TU LICENCIA YA ESTÁ LISTA. GUARDA TU CLAVE.'}
          {banner === 'pending' && 'TU PAGO ESTÁ PENDIENTE DE APROBACIÓN — SE APLICA SOLO APENAS SE CONFIRME.'}
          {banner === 'failure' && 'EL PAGO NO SE PUDO COMPLETAR. PUEDES INTENTAR DE NUEVO CUANDO QUIERAS.'}
        </div>
      )}

      {newLicenseKey && (
        <div className="theme-surface theme-surface-featured w-full max-w-3xl p-4 flex flex-col gap-2">
          <p className="theme-label tkc-label">Guarda tu clave ahora</p>
          <p className="tkc-hint">
            Es tu única credencial: con ella entras desde cualquier dispositivo. Cópiala y guárdala en un lugar seguro.
          </p>
          <div className="flex items-center gap-2">
            <code className="theme-input flex-1 px-3 py-2 text-xs break-all select-all">{newLicenseKey}</code>
            <button type="button" onClick={copyNewLicenseKey} className="theme-btn-primary theme-btn-md font-bold whitespace-nowrap">
              <span key={newKeyCopied ? 'done' : 'idle'} className="tkc-pop">{newKeyCopied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>
      )}

      {!session && guestClaimPending && (
        <p role="status" className="w-full max-w-3xl theme-notice theme-notice-warning">
          Tienes un pago pendiente de confirmación. En cuanto se confirme, vuelve a abrir Membresía en este navegador y aquí aparecerá tu clave.
        </p>
      )}

      {/* Al comprar un plan, la key se rota para reflejar el nivel nuevo
          (ver backend/server.js) — el streamer la ve acá una sola vez y
          tiene que actualizar la URL de su overlay en OBS con la key nueva,
          la vieja deja de servir. */}
      {revealedKey && (
        <div className="theme-surface theme-surface-featured w-full max-w-3xl p-4 flex flex-col gap-2">
          <p className="theme-label tkc-label">Tu clave cambió: guárdala</p>
          <p className="tkc-hint">
            Tu plan nuevo viene con una clave nueva; entra con ella desde ahora. Tus enlaces de overlay siguen funcionando, salvo los muy antiguos que llevan la clave dentro: si alguno deja de conectar, cópialo de nuevo desde Overlays.
          </p>
          <div className="flex items-center gap-2">
            <code className="theme-input flex-1 px-3 py-2 text-xs break-all select-all">{revealedKey}</code>
            <button type="button" onClick={copyRevealedKey} className="theme-btn-primary theme-btn-md font-bold whitespace-nowrap">
              <span key={keyCopied ? 'done' : 'idle'} className="tkc-pop">{keyCopied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>
      )}

      {session && (
        <div className="theme-surface theme-surface-featured w-full max-w-3xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="theme-label tkc-label mb-0.5">Tu plan actual</p>
            <p className="text-sm font-black">{PLAN_LABELS[session?.licenseType] || session?.licenseType || '—'}</p>
          </div>
          <div>
            <p className="theme-label tkc-label mb-0.5">Vence</p>
            <p className="text-sm font-black">{session?.expiresAt ? new Date(session.expiresAt).toLocaleDateString('es-MX') : 'Nunca'}</p>
          </div>
          <div>
            <p className="theme-label tkc-label mb-0.5">Color Says</p>
            <p className="text-sm font-black">{DICE_TIER_LABELS[session?.diceTier] || 'Regular'}</p>
          </div>
          <div>
            <p className="theme-label tkc-label mb-0.5">Spotify</p>
            <p className="text-sm font-black">{spotifyStatusLabel}</p>
          </div>
          {billingInfo && (
            <div className="basis-full flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--surface-border-color)]">
              <p className="tkc-hint flex-1 basis-64">{billingSummary(billingInfo, session, livePrices)}</p>
              {billingInfo.hasSubscription && (
                <button type="button" onClick={openBillingPortal} disabled={billingBusy}
                  className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest disabled:opacity-40">
                  Gestionar suscripción
                </button>
              )}
              {billingInfo.lifetimeChargeAt && (
                <button type="button" onClick={cancelLifetimeTrial} disabled={billingBusy}
                  className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest disabled:opacity-40">
                  Cancelar prueba
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Paso 1: el alias, antes que el plan ("Comprar" lo marcaba en rojo sin
          que se supiera que iba primero). Va dentro de la clave. */}
      {!session && !payingPlan && (
        <section className="theme-surface w-full max-w-3xl p-5 flex flex-col gap-1.5 relative" aria-labelledby="alias-title">
          <HoneypotField />
          <p className="theme-accent-text tkc-eyebrow">Paso 1</p>
          <label id="alias-title" htmlFor="membership-alias" className="theme-label tkc-label block">Elige el alias de tu licencia</label>
          <input
            ref={aliasInputRef}
            id="membership-alias"
            value={alias}
            onChange={e => { setAlias(e.target.value); if (aliasError) setAliasError(''); }}
            placeholder="Por ejemplo: tu usuario de TikTok"
            autoComplete="off"
            style={aliasError ? { borderColor: '#ef4444' } : undefined}
            className={['theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm',
              aliasError ? 'ring-2 ring-red-500/30' : ''].join(' ')}
          />
          {aliasError ? (
            <p role="alert" className="text-xs font-bold text-red-500">{aliasError}</p>
          ) : (
            <p className="tkc-hint">Va dentro de tu clave (alias-plan-hash). Letras, números, "_" o "-". No se crea nada hasta que se apruebe tu pago o tu prueba gratis.</p>
          )}
        </section>
      )}

      {!payingPlan && (
      <section className="w-full max-w-3xl" aria-labelledby="plans-title">
        <div className="mb-2">
          {!session && <p className="theme-accent-text tkc-eyebrow">Paso 2</p>}
          <h2 id="plans-title" className="tkc-label theme-label">Elige tu plan</h2>
          <p className="tkc-hint">
            {!session && !alias.trim() ? 'Primero escribe tu alias en el paso 1. ' : ''}
            Mensual y Anual se renuevan solos y los cancelas cuando quieras. La prueba de {TRIAL_DAYS} días pide tarjeta: hoy no se cobra nada y, si no cancelas antes, se cobra al terminar.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map(plan => {
            const isCurrent = session?.licenseType === plan.id;
            const rank = PLAN_RANK[plan.id];
            const buttonLabel = currentPlanRank >= 1 ? 'Mejorar' : 'Comprar';
            return (
              <div key={plan.id} className={`${plan.savingsChip ? 'theme-surface-featured' : 'theme-surface'} p-4 text-left flex flex-col`}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <p className="tkc-label">{plan.label}</p>
                  {plan.savingsChip && <span className="theme-chip tkc-label px-2 py-0.5 rounded-full whitespace-nowrap">{plan.savingsChip}</span>}
                </div>
                {(() => {
                  const mxnPrice = livePrices?.[plan.id] != null ? livePrices[plan.id] / 100 : plan.mxn;
                  return (
                    <>
                      <p className="text-3xl font-black tabular-nums leading-tight">MX${mxnPrice.toLocaleString('es-MX')}</p>
                      <p className="tkc-hint">{plan.period} · referencia US${(mxnPrice / MXN_PER_USD).toFixed(2)}{SUBSCRIPTION_PLANS.includes(plan.id) ? ' · se renueva solo' : ''}</p>
                    </>
                  );
                })()}
                {/* Aviso de Spotify por plan (ver backend/spotify.js, "Quién
                    puede usarlo"): la app de Spotify de la plataforma solo
                    admite unos pocos usuarios, así que el resto conecta con
                    su propia app. El total y los cupos que quedan vienen de
                    /api/pricing (sin número si un backend anterior no lo manda). */}
                <p className="tkc-hint mt-3">
                  {plan.id === 'lifetime' && (
                    <>Incluye Spotify. {spotifySlots ? `Los ${spotifySlots.total} primeros Lifetime usan` : 'Los primeros Lifetime usan'} la app de Spotify de la plataforma
                      {spotifySlotsLeft != null && (spotifySlotsLeft > 0 ? ` (quedan ${spotifySlotsLeft} de ${spotifySlots.total})` : ' (cupos agotados)')};
                      el resto conecta con su propia app de Spotify, con guía paso a paso.</>
                  )}
                  {plan.id === 'annual' && <>Incluye Spotify: conectas con tu propia app de Spotify, con guía paso a paso.</>}
                  {plan.id === 'month' && <>Spotify es opcional: complemento de pago único (MX${spotifyAddonMxn.toLocaleString('es-MX')}).</>}
                </p>
                <div className="flex-1" />
                {isCurrent ? (
                  <p className="theme-chip tkc-label text-center mt-3 py-2 rounded-full">Plan actual</p>
                ) : trialInProgress && billingInfo?.plan === plan.id ? (
                  <p className="theme-chip tkc-label text-center mt-3 py-2 rounded-full">En prueba</p>
                ) : rank > currentPlanRank ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <button type="button" disabled={!session && !alias.trim()} onClick={() => handleBuy(plan.id)}
                      className="theme-btn-primary theme-btn-md w-full font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed">
                      {buttonLabel}
                    </button>
                    {canTrial && (
                      <button type="button" disabled={!session && !alias.trim()} onClick={() => handleBuy(plan.id, { trial: true })}
                        className="theme-btn-secondary theme-btn-md w-full font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed">
                        Probar {TRIAL_DAYS} días gratis
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {/* Condiciones de Lifetime: antes iban dentro de su tarjeta en letra de
            9px y la hacían el doble de alta que las otras. Mismo texto. */}
        <p className="text-xs text-gray-500 mt-2 px-1">Lifetime: {LIFETIME_LEGEND}</p>
      </section>
      )}

      {payingPlan && (
        <>
          {/* Resumen fijo del plan elegido: en el formulario de pago (largo)
              siempre se ve qué se está comprando y cuánto, y se puede volver
              a elegir otro sin perder el lugar. */}
          <div className="sticky top-0 z-20 w-full max-w-3xl theme-surface-featured px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="theme-label tkc-label">{payingTrial ? 'Prueba gratis' : 'Vas a pagar'}</p>
              <p className="text-sm font-black truncate">
                {buyingAddon
                  ? `Complemento de Spotify (pago único) · MX$ ${payingAmountMxn?.toLocaleString('es-MX')}`
                  : payingTrial
                    ? `Plan ${PLAN_LABELS[payingPlan] || payingPlan} · hoy MX$ 0`
                    : `Plan ${PLAN_LABELS[payingPlan] || payingPlan} · MX$ ${payingAmountMxn?.toLocaleString('es-MX')} ${payingPlanInfo?.period || ''}`}
              </p>
              {!session && <p className="tkc-hint truncate">Alias: {alias.trim()}</p>}
            </div>
            <button type="button" onClick={() => setPayingPlan(null)} className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest flex-shrink-0">
              {buyingAddon ? 'Volver' : 'Cambiar plan'}
            </button>
          </div>

          {/* Qué se cobra y cuándo, dicho antes de poner la tarjeta. */}
          {!buyingAddon && (payingTrial || SUBSCRIPTION_PLANS.includes(payingPlan)) && (
            <p className="w-full max-w-3xl theme-notice theme-notice-warning">
              {payingTrial
                ? `Hoy no se te cobra nada. El ${formatDate(Date.now() + TRIAL_DAYS * DAY_MS)} se cobrarán MX$${payingAmountMxn?.toLocaleString('es-MX')} ${payingPlanInfo?.after} a tu tarjeta, salvo que canceles antes desde Membresía.`
                : firstChargeLater
                  ? `Tu plan actual sigue hasta el ${formatDate(session.expiresAt)}: ese día será el primer cobro de MX$${payingAmountMxn?.toLocaleString('es-MX')}, y después ${payingPlanInfo?.after}.`
                  : `Se cobra MX$${payingAmountMxn?.toLocaleString('es-MX')} hoy y después ${payingPlanInfo?.after}, hasta que canceles desde Membresía.`}
            </p>
          )}

          {/* Pedido explicito: checkbox obligatorio antes de pagar --
              guarda `policyAcceptedAt` (fecha/hora exacta de la
              aceptación) para mandarlo con el pago como evidencia ante un
              contracargo de mala fe (ver comentario del estado más
              arriba). El texto completo vive en RefundPolicyModal.jsx. */}
          <div className="w-full max-w-3xl">
            <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                ref={policyCheckboxRef}
                type="checkbox"
                checked={!!policyAcceptedAt}
                onChange={e => {
                  setPolicyAcceptedAt(e.target.checked ? new Date().toISOString() : null);
                  if (policyError) setPolicyError('');
                }}
                className="mt-0.5 flex-shrink-0"
              />
              <span>
                Acepto la{' '}
                <button type="button" onClick={(e) => { e.preventDefault(); setShowPolicyModal(true); }} className="underline font-bold text-gray-300 hover:text-white">
                  política de reembolsos
                </button>
                {' '}(todas las ventas son finales, servicio digital de acceso inmediato)
                {!buyingAddon && SUBSCRIPTION_PLANS.includes(payingPlan) && ' y que el plan se renueve solo hasta que lo cancele'}
                {!buyingAddon && payingPlan === 'lifetime' && payingTrial && ' y el cobro único al terminar la prueba si no la cancelo antes'}.
              </span>
            </label>
            {policyError && <p className="text-xs font-bold text-red-500 mt-1">{policyError}</p>}
          </div>

          {readyToPay ? (
            <StripePaymentForm
              planType={buyingAddon ? undefined : payingPlan}
              spotifyAddon={buyingAddon}
              policyAcceptedAt={policyAcceptedAt}
              trial={payingTrial}
              guestAlias={session ? undefined : alias.trim()}
              onSuccess={session ? handlePaymentSuccess : handleGuestPurchaseSuccess}
              onCancel={() => setPayingPlan(null)}
            />
          ) : (
            <button type="button" onClick={attemptContinue}
              className="theme-btn-primary theme-btn-md w-full max-w-3xl font-black tracking-widest uppercase transition-all">
              Continuar con el pago
            </button>
          )}
        </>
      )}

      {/* Complemento de Spotify: pago único para quien está en el plan
          Mensual (Anual y Lifetime ya lo incluyen, ver backend/spotify.js).
          Se paga por el mismo formulario de tarjeta que un plan. Sin sesión
          no hay a qué licencia sumarlo todavía: solo informa. */}
      {!payingPlan && (
        <section className="w-full max-w-3xl" aria-labelledby="addons-title">
          <h2 id="addons-title" className="tkc-label theme-label mb-2">Complementos</h2>
          <div className={`theme-surface p-4 flex items-center justify-between flex-wrap gap-3 ${canBuyAddon ? 'ring-2 ring-[var(--accent)]' : ''}`}>
            <div className="min-w-0 flex-1 basis-64">
              <p className="tkc-label">Spotify · pago único</p>
              <p className="text-2xl font-black tabular-nums mt-0.5">MX${spotifyAddonMxn.toLocaleString('es-MX')}</p>
              <p className="tkc-hint mt-1">
                Pedidos de canciones con <code className="theme-chip px-1 py-0.5 rounded">!play</code>. Se paga una sola vez y queda en tu licencia:
                conectas con tu propia app de Spotify (te guiamos paso a paso) y necesitas Spotify Premium. Ya viene incluido en los planes Anual y Lifetime.
              </p>
            </div>
            {spotifyIncluded ? (
              <p className="theme-chip tkc-label text-center px-3 py-2 rounded-full">Incluido en tu plan</p>
            ) : session?.spotifyAddon ? (
              <p className="theme-chip tkc-label text-center px-3 py-2 rounded-full">Activo</p>
            ) : canBuyAddon ? (
              <button type="button" onClick={() => handleBuy(SPOTIFY_ADDON_ID)}
                className="theme-btn-primary theme-btn-sm font-black uppercase tracking-widest">
                Comprar complemento
              </button>
            ) : (
              <p className="tkc-hint max-w-[14rem]">Disponible con el plan Mensual (Anual y Lifetime lo incluyen).</p>
            )}
          </div>
        </section>
      )}

      {!session && (
        <form onSubmit={submitLogin} className="theme-surface w-full max-w-3xl p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3 relative">
          <HoneypotField />
          <div className="flex-1">
            <label htmlFor="membership-login-key" className="theme-label tkc-label block mb-1.5">¿Ya tienes una clave? Ingrésala aquí</label>
            <input ref={loginInputRef} id="membership-login-key" value={loginKey} onChange={e => { setLoginKey(e.target.value); if (loginStatus === 'error') setLoginStatus('idle'); }} readOnly={loginLoading} placeholder="Pega tu clave de licencia"
              className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
          </div>
          <div className="sm:w-32 flex-shrink-0">
            <MorphButton type="submit" status={loginStatus} loadingLabel="Verificando tu clave…" disabled={!loginLoading && !loginKey.trim()}
              className="theme-btn-primary theme-btn-md font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              Entrar
            </MorphButton>
          </div>
          {loginError && <p role="alert" className="text-xs font-bold text-red-500 sm:basis-full tkc-msg-enter">{loginError}</p>}
        </form>
      )}

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}

      {showPolicyModal && <RefundPolicyModal onClose={() => setShowPolicyModal(false)} />}

      {/* Donde se paga, a la vista: aviso legal, privacidad y cookies. */}
      <LegalLinks onNavigate={onNavigate} className="w-full max-w-3xl" />
    </div>
  );
}
