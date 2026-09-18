import React, { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders, refreshSession, requestFreeTrial, saveSession, loadSession, loginWithKey } from './auth';
import CardPaymentForm from './CardPaymentForm';
import StripePaymentForm from './StripePaymentForm';
import CardVerifyForm from './CardVerifyForm';
import RewardedAdGate from './RewardedAdGate';
import RefundPolicyModal from './RefundPolicyModal';
import { TRIAL_UNLOCK_AD_COUNT } from './adConfig';

const PLANS = [
  { id: 'month', label: 'Mensual', mxn: 126, period: '/ mes' },
  { id: 'annual', label: 'Anual', mxn: 1080, period: '/ año', savingsChip: 'AHORRAS MX$430' },
  { id: 'lifetime', label: 'Lifetime', mxn: 1800, period: 'pago único' },
];
const PLAN_RANK = { month: 1, annual: 2, lifetime: 3 };
// Chequeo minimo de formato -- solo para decidir cuando ya hay un correo
// utilizable con el que crear el Card Payment Brick (ver mas abajo); el
// backend sigue siendo quien de verdad valida el formato antes de cobrar.
const EMAIL_RE = /^\S+@\S+\.\S+$/;
// Referencia aproximada MXN por USD -- pedido explicito: que la
// referencia en dolares que ve el streamer se recalcule sola en cuanto el
// admin cambie el precio en MXN desde el panel, en vez de quedar como un
// texto fijo desincronizado. Es solo informativa (MXN sigue siendo la
// unica moneda que de verdad cobra MercadoPago, ver pricing.js) -- si el
// tipo de cambio real se mueve mucho, alcanza con ajustar este numero.
const MXN_PER_USD = 18;

const PLAN_LABELS = { day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba (7 días)' };
// El WIN BONUS de Color Says dejó de venderse como addon PRO/VIP (pedido
// explícito: la dinámica debe ser transparente por default) — ahora es una
// excepción manual que un admin prende por licencia puntual desde el panel
// de Licencias, nunca algo que se compre acá. `DICE_TIER_LABELS` se
// mantiene solo para mostrar el nivel actual en el resumen de abajo — el
// nivel en sí ya no tiene una vitrina de compra.
const DICE_TIER_LABELS = { regular: 'Regular', pro: 'PRO', vip: 'VIP', admin: 'Admin' };

const LIFETIME_LEGEND = 'El acceso Lifetime cubre la plataforma y sus actualizaciones estándar. Funciones o servicios con costos operativos especiales —como IA, voces premium, servidores o integraciones de pago— podrán ofrecerse por separado.';

// Pantalla de autoservicio de pago (Checkout API + Card Payment Brick).
// Funciona con o sin sesión: sin sesión se ven los planes igual (precio
// público) pero hace falta un alias antes de pagar — se usa para crear la
// cuenta en el mismo paso (ver handleBuy), igual que la prueba gratis de
// Login.jsx. El formato final lo sigue validando el backend antes de
// cobrar (ver /api/payments/charge); EMAIL_RE de acá solo decide cuándo ya
// hay un correo usable para crear el Card Payment Brick (ver más abajo:
// crearlo antes, con el campo vacío, hacía que el propio Brick mostrara su
// propio input de correo duplicado, y ese quedaba clavado con el valor
// vacío de aquel momento aunque el streamer después completara el de
// arriba).
// `session` trae licenseType/expiresAt/diceTier ya guardados en el token
// (ver auth.js); `onSessionUpdate` deja que App.jsx refresque su estado
// después de crear la cuenta y/o de volver de un pago.

// Recuerda correo/direccion de pago en este navegador (localStorage) para
// que el streamer no los reescriba en cada compra -- son datos de
// contacto/envio, no de la tarjeta, asi que no hay problema en guardarlos
// tal cual del lado del cliente. Falla en silencio (modo privado, storage
// bloqueado, etc.): en ese caso simplemente no se precarga nada.
const BILLING_INFO_KEY = 'tte_billing_info';
function loadBillingInfo() {
  try {
    const raw = localStorage.getItem(BILLING_INFO_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveBillingInfo(info) {
  try {
    localStorage.setItem(BILLING_INFO_KEY, JSON.stringify(info));
  } catch {
    // localStorage no disponible -- se sigue funcionando, solo no se recuerda
  }
}

export default function Membership({ session, onSessionUpdate }) {
  const [alias, setAlias] = useState('');
  // Pedido explicito de MercadoPago (mitiga el rechazo "por motivos de
  // seguridad" del motor antifraude): mandar SIEMPRE un email de pagador en
  // la preferencia, aunque el streamer ya tenga sesion. Se precarga desde
  // localStorage (ver loadBillingInfo) para no pedirlo de nuevo en cada
  // compra en el mismo navegador.
  const [email, setEmail] = useState(() => loadBillingInfo().email || '');
  // Pedido explicito de MercadoPago (checklist de calidad, "Nombre/Apellido
  // del comprador"): antes se sacaban partiendo el nombre del titular que
  // ya pide el propio Card Payment Brick (formData.cardholderName), pero
  // eso deja el resultado a como el streamer haya escrito ESE campo (a
  // veces solo un nombre, sin apellido) -- pedirlos acá aparte, igual que
  // el correo, asegura que los dos campos que MercadoPago quiere lleguen
  // siempre completos.
  const [firstName, setFirstName] = useState(() => loadBillingInfo().firstName || '');
  const [lastName, setLastName] = useState(() => loadBillingInfo().lastName || '');
  // Pedido explicito de MercadoPago (checklist de calidad de
  // integracion, "Dirección del comprador"): opcional para el
  // streamer -- solo se manda si completa las 3 partes juntas (ver
  // CardPaymentForm.jsx). Ayuda a bajar rechazos del motor antifraude.
  // Tambien se precarga desde localStorage, mismo criterio que el email.
  const [zipCode, setZipCode] = useState(() => loadBillingInfo().zipCode || '');
  const [streetName, setStreetName] = useState(() => loadBillingInfo().streetName || '');
  const [streetNumber, setStreetNumber] = useState(() => loadBillingInfo().streetNumber || '');

  useEffect(() => {
    saveBillingInfo({ email, firstName, lastName, zipCode, streetName, streetNumber });
  }, [email, firstName, lastName, zipCode, streetName, streetNumber]);
  const [loadingTarget, setLoadingTarget] = useState(null); // null | planId
  // Plan que se esta pagando ahora mismo con el formulario embebido (Card
  // Payment Brick) -- null si no hay ningun pago en curso. Reemplaza al
  // redirect a mercadopago.com.mx/checkout/ mientras esa pagina hosteada
  // tenga el bug confirmado del challenge-orchestrator (ver el chat: el
  // boton "Pagar" de MP nunca se habilita, reproducido en dos navegadores
  // distintos). El comprador nunca sale de este sitio con este camino.
  const [payingPlan, setPayingPlan] = useState(null);
  // Pedido explicito: Stripe como forma de pago principal, MercadoPago como
  // secundaria seleccionable -- 'stripe' por default, el streamer puede
  // cambiar a MercadoPago antes de completar los datos de la tarjeta.
  const [paymentProvider, setPaymentProvider] = useState('stripe');
  const [error, setError] = useState('');
  // Validación de correo/nombre/apellido estilo "sitio moderno": el input
  // se pone en rojo y el error aparece pegado a ÉL (no uno genérico al
  // final) recién cuando el streamer ya lo tocó (onBlur) o intentó
  // continuar sin llenarlo -- pedido explícito, reemplaza el texto fijo
  // "Completa correo, nombre y apellido arriba..." que antes no decía CUÁL
  // campo faltaba.
  const [contactTouched, setContactTouched] = useState({ email: false, firstName: false, lastName: false });
  const emailInputRef = useRef(null);
  const firstNameInputRef = useRef(null);
  const lastNameInputRef = useRef(null);
  // Pedido explicito: aceptación obligatoria de la política de reembolsos
  // antes de poder pagar -- no evita que alguien dispute con su banco (eso
  // lo decide el banco, no acá), pero le da a Stripe/MercadoPago evidencia
  // real (aceptación explícita, CON FECHA) para pelear y ganar la disputa
  // si llega. `policyAcceptedAt` (null = no aceptó todavía) es lo que de
  // verdad viaja al backend (ver StripePaymentForm/CardPaymentForm más
  // abajo) -- se guarda el momento exacto del check, no `Date.now()` leído
  // de nuevo en cada render.
  const [policyAcceptedAt, setPolicyAcceptedAt] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const policyCheckboxRef = useRef(null);
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('payment'));
  const [revealedKey, setRevealedKey] = useState(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // Prueba gratis (mudada entera desde Login.jsx -- pedido explícito: que
  // el streamer elija entre probar gratis o comprar todo en un solo lugar,
  // en vez de repetido en cada panel bloqueado). Tres vías para las 7 días
  // gratis: ver anuncios, verificar una tarjeta real (sin cobro, ver
  // CardVerifyForm.jsx), o directo con un alias -- las tres terminan en el
  // mismo trialResult de abajo.
  const [showTrialAdForm, setShowTrialAdForm] = useState(false);
  // Hace falta reclamar el gate TRIAL_UNLOCK_AD_COUNT veces seguidas (no
  // solo una) -- RewardedAdGate resetea su propio estado interno en cada
  // claim(), así que basta con no cerrar el gate hasta llegar al total.
  const [showAdGate, setShowAdGate] = useState(false);
  const [adsWatched, setAdsWatched] = useState(0);
  const [showCardForm, setShowCardForm] = useState(false);
  const [trialError, setTrialError] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);
  // Se muestra ANTES de loguear (ver continueAfterTrial): la key es la
  // única credencial de esta licencia, y si se pierde antes de guardarla
  // no hay forma de recuperarla -- ver auth.requestFreeTrial.
  const [trialResult, setTrialResult] = useState(null); // { key, token, license }
  const [trialCopied, setTrialCopied] = useState(false);
  const aliasInputRef = useRef(null);
  // Error propio del alias (no el `error` genérico de más abajo, que
  // renderiza al final de toda la página -- lejos del input, ver el
  // comentario en handleBuy) para que el aviso quede pegado al campo.
  const [aliasError, setAliasError] = useState('');

  // Pedido explícito: un solo input de alias, compartido entre la prueba
  // gratis (las 3 vías) y la compra directa de un plan -- antes había uno
  // propio por vía (CardVerifyForm, el formulario post-anuncios, y el de
  // "comprar directo"), obligando a escribirlo hasta 2 veces si el
  // streamer cambiaba de idea entre probar gratis y comprar. Se valida acá
  // antes de abrir cualquiera de las vías (ver los onClick de más abajo);
  // `ensureSession` lo vuelve a chequear por su cuenta para el camino de
  // compra directa (mismo helper, mismo mensaje pegado al campo).
  const requireAlias = () => {
    if (alias.trim()) return true;
    setAliasError('Elige un alias antes de continuar.');
    aliasInputRef.current?.focus();
    return false;
  };

  const submitTrial = async () => {
    if (!alias.trim() || trialLoading) return;
    setTrialLoading(true);
    setTrialError('');
    try {
      const result = await requestFreeTrial(alias.trim());
      setTrialResult(result);
    } catch (err) {
      setTrialError(err.message || 'No se pudo crear la prueba gratis');
    } finally {
      setTrialLoading(false);
    }
  };

  const copyTrialKey = () => {
    navigator.clipboard.writeText(trialResult.key);
    setTrialCopied(true);
    setTimeout(() => setTrialCopied(false), 2000);
  };

  const continueAfterTrial = () => {
    const { token, key: trialKey, license } = trialResult;
    const created = { token, licenseKey: trialKey, ...license };
    saveSession(created);
    onSessionUpdate?.(created);
    setTrialResult(null);
  };

  // Precios vigentes desde el backend (pueden diferir de los defaults de
  // PLANS de abajo si el admin los edito desde el panel de Licencias, ver
  // GET /api/pricing) -- null mientras no llego la respuesta, ahi se usa el
  // default como fallback para no dejar la vitrina en blanco un instante.
  const [livePrices, setLivePrices] = useState(null);
  useEffect(() => {
    fetch(`${backendUrl()}/api/pricing`)
      .then(res => res.json())
      .then(data => { if (data.success) setLivePrices(data.prices); })
      .catch(() => {}); // sin precios en vivo, se sigue viendo el default
  }, []);

  // Ingresar con una clave que ya tienes (admin, prueba gratis guardada de
  // antes, etc.) sin tener que entrar a un panel de juego bloqueado primero
  // — antes esta era la única forma de loguearse: el Login embebido que
  // aparece dentro de Rey del Trono/Zubastinis/etc. cuando no hay sesión.
  const [loginKey, setLoginKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const submitLogin = async (e) => {
    e.preventDefault();
    if (!loginKey.trim() || loginLoading) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const trimmedKey = loginKey.trim();
      const { token, license } = await loginWithKey(trimmedKey);
      saveSession({ token, licenseKey: trimmedKey, ...license });
      onSessionUpdate?.({ token, licenseKey: trimmedKey, ...license });
      setLoginKey('');
    } catch (err) {
      setLoginError(err.message || 'Licencia inválida, revocada o expirada');
    } finally {
      setLoginLoading(false);
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

  const emailValid = EMAIL_RE.test(email.trim());
  const firstNameValid = !!firstName.trim();
  const lastNameValid = !!lastName.trim();
  const contactValid = emailValid && firstNameValid && lastNameValid;
  const readyToPay = contactValid && !!policyAcceptedAt;

  // Se llama al tocar el botón "Continuar con el pago" (visible mientras
  // falte algo) -- marca los tres campos como "tocados" de una (para que
  // se pinten en rojo aunque el streamer nunca haya llegado a enfocarlos)
  // y lleva el foco directo al primero que falta, en ese orden (el
  // checkbox de la política queda al final a propósito: si falta algo más
  // arriba, tiene prioridad).
  const attemptContinue = () => {
    setContactTouched({ email: true, firstName: true, lastName: true });
    if (!emailValid) { emailInputRef.current?.focus(); return; }
    if (!firstNameValid) { firstNameInputRef.current?.focus(); return; }
    if (!lastNameValid) { lastNameInputRef.current?.focus(); return; }
    if (!policyAcceptedAt) {
      setPolicyError('Acepta la política de reembolsos para continuar.');
      policyCheckboxRef.current?.focus();
    }
  };

  const copyRevealedKey = () => {
    navigator.clipboard.writeText(revealedKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  // Sin sesión, comprar crea la cuenta en el mismo paso (mismo endpoint que
  // "prueba gratis" en Login.jsx) usando el alias como identidad — así la
  // key resultante sigue el formato alias-TIER-hash desde el primer momento,
  // sin un paso de registro separado.
  const ensureSession = async () => {
    if (session?.licenseKey !== undefined || loadSession()?.token) return true;
    if (!requireAlias()) return false;
    const { token, key, license } = await requestFreeTrial(alias.trim());
    const created = { token, licenseKey: key, ...license };
    saveSession(created);
    onSessionUpdate?.(created);
    return true;
  };

  const handleBuy = async (planType) => {
    if (loadingTarget || !planType) return;
    setError('');
    setLoadingTarget(planType);
    try {
      const ok = await ensureSession();
      if (!ok) return;
      setPayingPlan(planType);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingTarget(null);
    }
  };

  // Se llama cuando /api/payments/charge confirma un pago aprobado -- mismo
  // flujo que ya usaba el banner de exito del redirect (refrescar la sesion
  // y mostrar la clave rotada si el plan nuevo genero una).
  const handlePaymentSuccess = async () => {
    setPayingPlan(null);
    setBanner('success');
    const updated = await refreshSession();
    if (!updated) return;
    onSessionUpdate?.(updated);
    if (updated.revealedKey) setRevealedKey(updated.revealedKey);
  };

  return (
    <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-6 overflow-y-auto">
      <div className="w-full max-w-2xl flex flex-col gap-1">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">💳 Membresía</p>
        <h1 className="theme-heading text-2xl font-black">{session ? 'Tu plan y tus pagos' : 'Elige cómo empezar'}</h1>
        <p className="text-xs text-gray-500">
          {session
            ? 'Revisa tu plan actual, mejóralo o renuévalo cuando quieras.'
            : 'Prueba gratis 7 días o elige un plan. Tu clave es tu única credencial: guárdala en un lugar seguro.'}
        </p>
      </div>

      {/* Mismo tratamiento que los avisos de Login.jsx (fondo teñido + borde
          fino parejo, no una franja lateral) — un solo lenguaje de "aviso"
          en toda la app en vez de introducir un segundo estilo de alerta. */}
      {banner && (
        <div role={banner === 'failure' ? 'alert' : 'status'} className={['w-full max-w-2xl rounded-lg px-4 py-3 text-xs font-bold border',
          banner === 'success' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600'
            : banner === 'pending' ? 'bg-amber-500/10 border-amber-500/40 text-amber-600'
            : 'bg-red-500/10 border-red-500/40 text-red-700'].join(' ')}>
          {banner === 'success' && '✅ ¡PAGO APROBADO! TU LICENCIA YA SE ACTUALIZÓ.'}
          {banner === 'pending' && '⏳ TU PAGO ESTÁ PENDIENTE DE APROBACIÓN — SE APLICA SOLO APENAS SE CONFIRME.'}
          {banner === 'failure' && '❌ EL PAGO NO SE PUDO COMPLETAR. PUEDES INTENTAR DE NUEVO CUANDO QUIERAS.'}
        </div>
      )}

      {/* Al comprar un plan, la key se rota para reflejar el nivel nuevo
          (ver backend/server.js) — el streamer la ve acá una sola vez y
          tiene que actualizar la URL de su overlay en OBS con la key nueva,
          la vieja deja de servir. */}
      {revealedKey && (
        <div className="theme-surface theme-surface-featured w-full max-w-2xl p-4 flex flex-col gap-2">
          <p className="theme-label text-[9px]">Tu clave cambió — actualiza tu overlay de OBS</p>
          <p className="text-[10px] text-gray-500 leading-snug">
            Tu plan nuevo necesitó una clave nueva. Cópiala y reemplaza la key en la URL del overlay que tengas guardada en OBS.
          </p>
          <div className="flex items-center gap-2">
            <code className="theme-input flex-1 px-3 py-2 text-xs break-all">{revealedKey}</code>
            <button type="button" onClick={copyRevealedKey} className="theme-btn-primary px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
              {keyCopied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {session && (
        <div className="theme-surface theme-surface-featured w-full max-w-2xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="theme-label text-[9px] mb-1">Tu plan actual</p>
            <p className="text-sm font-black">{PLAN_LABELS[session?.licenseType] || session?.licenseType || '—'}</p>
          </div>
          <div>
            <p className="theme-label text-[9px] mb-1">Vence</p>
            <p className="text-sm font-black">{session?.expiresAt ? new Date(session.expiresAt).toLocaleDateString('es-MX') : 'Nunca'}</p>
          </div>
          <div>
            <p className="theme-label text-[9px] mb-1">Color Says</p>
            <p className="text-sm font-black">{DICE_TIER_LABELS[session?.diceTier] || 'Regular'}</p>
          </div>
        </div>
      )}

      {!session && (
        <form onSubmit={submitLogin} className="theme-surface w-full max-w-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label className="theme-label block text-[10px] mb-2">¿Ya tienes una clave? Ingrésala aquí</label>
            <input value={loginKey} onChange={e => setLoginKey(e.target.value)} placeholder="Pega tu clave de licencia"
              className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
          </div>
          <button type="submit" disabled={loginLoading || !loginKey.trim()}
            className="theme-btn-primary px-6 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
            {loginLoading ? 'Verificando...' : 'Entrar'}
          </button>
          {loginError && <p role="alert" className="text-[10px] font-bold text-red-500 sm:basis-full">{loginError}</p>}
        </form>
      )}

      {/* Pedido explicito: un solo input de alias, compartido entre la
          prueba gratis (las 3 vías) y la compra directa de un plan -- antes
          había uno propio por vía, obligando a escribirlo hasta 2 veces si
          el streamer cambiaba de idea entre probar gratis y comprar. Vive
          acá junto a los planes (mudado entero desde Login.jsx) para que el
          streamer elija todo en un solo lugar, en vez de repetido en cada
          panel bloqueado (que ahora solo pide la clave si ya tienes una). */}
      {!session && (
        <div className="theme-surface w-full max-w-2xl p-6 flex flex-col gap-4">
          {trialResult ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="theme-label text-xs uppercase tracking-widest font-semibold">⚠️ Guarda tu clave ahora</p>
              <p className="text-[11px] text-gray-500">
                Es tu única credencial — cópiala antes de continuar. Si más adelante pasas a un
                plan pago, sigues usando esta misma clave (solo cambia el nivel, nunca el texto).
              </p>
              <div className="flex items-center gap-2">
                <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{trialResult.key}</code>
                <button type="button" onClick={copyTrialKey} className="theme-btn-primary px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
                  {trialCopied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <button
                type="button"
                onClick={continueAfterTrial}
                className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
              >
                Continuar
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="theme-label block text-[10px] mb-2">Elige un alias para tu licencia</label>
                <input
                  ref={aliasInputRef}
                  value={alias}
                  onChange={e => { setAlias(e.target.value); if (aliasError) setAliasError(''); }}
                  placeholder="Elige un alias"
                  style={aliasError ? { borderColor: '#ef4444' } : undefined}
                  className={['theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm',
                    aliasError ? 'ring-2 ring-red-500/30' : ''].join(' ')}
                />
                {aliasError ? (
                  <p role="alert" className="text-[10px] font-bold text-red-500 mt-1">{aliasError}</p>
                ) : (
                  <p className="text-[9px] text-gray-500 mt-1">Lo usas tanto para la prueba gratis como para comprar un plan — va incluido en tu clave (alias-plan-hash).</p>
                )}
              </div>

              {showCardForm ? (
                <CardVerifyForm
                  alias={alias} setAlias={setAlias}
                  onResult={(result) => { setShowCardForm(false); setTrialResult(result); }}
                  onCancel={() => setShowCardForm(false)}
                />
              ) : showTrialAdForm ? (
                <div className="flex flex-col gap-3">
                  <p className="theme-label text-xs uppercase tracking-widest font-semibold">Prueba gratis de 7 días</p>
                  <p className="text-[11px] text-gray-500">Ya viste los anuncios — confirma con el alias de arriba para activar tus 7 días.</p>
                  {trialError && <p role="alert" className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{trialError}</p>}
                  <button
                    type="button"
                    onClick={submitTrial}
                    disabled={trialLoading || !alias.trim()}
                    className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {trialLoading ? 'CREANDO...' : 'Solicitar prueba gratis'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="theme-label text-[10px] uppercase tracking-widest font-semibold text-center mb-1">
                    ¿No tienes una licencia? Elige cómo obtener 7 días gratis
                  </p>
                  <button
                    type="button"
                    onClick={() => { if (requireAlias()) setShowAdGate(true); }}
                    className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
                  >
                    Ver {TRIAL_UNLOCK_AD_COUNT} anuncios
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (requireAlias()) setShowCardForm(true); }}
                    className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
                  >
                    Verificar una tarjeta (sin cobro)
                  </button>
                  <p className="text-[10px] text-gray-500 text-center mt-1">O elige un plan más abajo para comprar directo con el mismo alias.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {payingPlan && (
        <>
          {/* Pedido explicito: estos campos solo estorban para quien ya
              tiene una licencia y solo entro a ver su plan (admin, key
              paga, etc.) -- se piden apenas aca, una vez que ya eligio
              un plan y esta por pagar. */}
          {/* Correo global a propósito: es el mismo dato para cualquiera de
              las dos formas de pago (a ese correo llegan los recibos, tanto
              el automático de Stripe como el de MercadoPago) -- pedido
              explícito de que este campo no se duplique por proveedor. */}
          <div className="w-full max-w-2xl">
            <label className="theme-label block text-[10px] mb-2">Correo para el pago (obligatorio, ahí llega tu recibo)</label>
            <input
              ref={emailInputRef}
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setContactTouched(t => ({ ...t, email: true }))}
              placeholder="tu@correo.com"
              style={contactTouched.email && !emailValid ? { borderColor: '#ef4444' } : undefined}
              className={['theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm',
                contactTouched.email && !emailValid ? 'ring-2 ring-red-500/30' : ''].join(' ')}
            />
            {contactTouched.email && !emailValid && (
              <p className="text-[10px] font-bold text-red-500 mt-1">Ingresa un correo válido para continuar.</p>
            )}
          </div>

          <div className="w-full max-w-2xl">
            <label className="theme-label block text-[10px] mb-2">Nombre y apellido (obligatorio para procesar el pago)</label>
            <div className="flex gap-2 items-start">
              <div className="flex-1 flex flex-col gap-1">
                <input
                  ref={firstNameInputRef}
                  value={firstName} onChange={e => setFirstName(e.target.value)}
                  onBlur={() => setContactTouched(t => ({ ...t, firstName: true }))}
                  placeholder="Nombre"
                  style={contactTouched.firstName && !firstNameValid ? { borderColor: '#ef4444' } : undefined}
                  className={['theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm',
                    contactTouched.firstName && !firstNameValid ? 'ring-2 ring-red-500/30' : ''].join(' ')}
                />
                {contactTouched.firstName && !firstNameValid && (
                  <p className="text-[10px] font-bold text-red-500">Ingresa tu nombre.</p>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <input
                  ref={lastNameInputRef}
                  value={lastName} onChange={e => setLastName(e.target.value)}
                  onBlur={() => setContactTouched(t => ({ ...t, lastName: true }))}
                  placeholder="Apellido"
                  style={contactTouched.lastName && !lastNameValid ? { borderColor: '#ef4444' } : undefined}
                  className={['theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm',
                    contactTouched.lastName && !lastNameValid ? 'ring-2 ring-red-500/30' : ''].join(' ')}
                />
                {contactTouched.lastName && !lastNameValid && (
                  <p className="text-[10px] font-bold text-red-500">Ingresa tu apellido.</p>
                )}
              </div>
            </div>
          </div>

          {/* Selector de forma de pago -- Stripe principal (pedido
              explícito), MercadoPago secundaria seleccionable. El correo/
              nombre/apellido de arriba son compartidos por las dos; lo único
              que cambia es el formulario de tarjeta de más abajo. */}
          <div className="w-full max-w-2xl">
            <label className="theme-label block text-[10px] mb-2">Método de pago</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaymentProvider('stripe')}
                className={['theme-surface p-3 text-xs font-bold text-left border-2 transition-all',
                  paymentProvider === 'stripe' ? 'border-current' : 'border-transparent opacity-60 hover:opacity-100'].join(' ')}>
                💳 Tarjeta de crédito/débito (Stripe)
              </button>
              <button type="button" onClick={() => setPaymentProvider('mercadopago')}
                className={['theme-surface p-3 text-xs font-bold text-left border-2 transition-all',
                  paymentProvider === 'mercadopago' ? 'border-current' : 'border-transparent opacity-60 hover:opacity-100'].join(' ')}>
                💳 Tarjeta de crédito/débito (MercadoPago)
              </button>
            </div>
          </div>

          {/* Dirección: solo la usa MercadoPago (ayuda a su motor
              antifraude, ver CardPaymentForm.jsx/server.js) -- no tiene
              sentido pedirla si el streamer eligió Stripe. */}
          {paymentProvider === 'mercadopago' && (
            <div className="w-full max-w-2xl">
              <label className="theme-label block text-[10px] mb-2">Dirección (opcional, ayuda a reducir rechazos por seguridad)</label>
              <div className="flex gap-2">
                <input value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="C.P."
                  className="theme-input w-24 p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
                <input value={streetName} onChange={e => setStreetName(e.target.value)} placeholder="Calle"
                  className="theme-input flex-1 p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
                <input value={streetNumber} onChange={e => setStreetNumber(e.target.value)} placeholder="Número"
                  className="theme-input w-24 p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
              </div>
            </div>
          )}

          {/* Pedido explicito: checkbox obligatorio antes de pagar --
              guarda `policyAcceptedAt` (fecha/hora exacta de la
              aceptación) para mandarlo con el pago como evidencia ante un
              contracargo de mala fe (ver comentario del estado más
              arriba). El texto completo vive en RefundPolicyModal.jsx. */}
          <div className="w-full max-w-2xl">
            <label className="flex items-start gap-2 text-[11px] text-gray-400 cursor-pointer">
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
                {' '}(todas las ventas son finales, servicio digital de acceso inmediato).
              </span>
            </label>
            {policyError && <p className="text-[10px] font-bold text-red-500 mt-1">{policyError}</p>}
          </div>

          {readyToPay ? (
            paymentProvider === 'stripe' ? (
              <StripePaymentForm
                planType={payingPlan}
                amount={livePrices?.[payingPlan] != null ? livePrices[payingPlan] / 100 : PLANS.find(p => p.id === payingPlan)?.mxn}
                email={email.trim()}
                firstName={firstName.trim()}
                lastName={lastName.trim()}
                policyAcceptedAt={policyAcceptedAt}
                onSuccess={handlePaymentSuccess}
                onCancel={() => setPayingPlan(null)}
              />
            ) : (
              <CardPaymentForm
                planType={payingPlan}
                amount={livePrices?.[payingPlan] != null ? livePrices[payingPlan] / 100 : PLANS.find(p => p.id === payingPlan)?.mxn}
                email={email.trim()}
                firstName={firstName.trim()}
                lastName={lastName.trim()}
                zipCode={zipCode.trim()}
                streetName={streetName.trim()}
                streetNumber={streetNumber.trim()}
                policyAcceptedAt={policyAcceptedAt}
                onSuccess={handlePaymentSuccess}
                onCancel={() => setPayingPlan(null)}
              />
            )
          ) : (
            <button type="button" onClick={attemptContinue}
              className="theme-btn-primary w-full max-w-2xl py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all">
              Continuar con el pago
            </button>
          )}
        </>
      )}

      {!payingPlan && (
      <div className="w-full max-w-2xl">
        <p className="theme-label text-[10px] mb-3">Elige tu plan</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map(plan => {
            const isCurrent = session?.licenseType === plan.id;
            const rank = PLAN_RANK[plan.id];
            const buttonLabel = currentPlanRank >= 1 ? 'Mejorar' : 'Comprar';
            return (
              <div key={plan.id} className="theme-surface p-4 text-left flex flex-col">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <p className="text-xs font-black uppercase tracking-widest">{plan.label}</p>
                  {plan.savingsChip && <span className="theme-chip text-[9px] font-black whitespace-nowrap">{plan.savingsChip}</span>}
                </div>
                {(() => {
                  const mxnPrice = livePrices?.[plan.id] != null ? livePrices[plan.id] / 100 : plan.mxn;
                  return (
                    <>
                      <p className="text-2xl font-black">MX${mxnPrice.toLocaleString('es-MX')}</p>
                      <p className="text-[10px] text-gray-500 mb-1">{plan.period} · referencia US${(mxnPrice / MXN_PER_USD).toFixed(2)}</p>
                    </>
                  );
                })()}
                {plan.id === 'lifetime' && (
                  <p className="text-[9px] text-gray-500 leading-snug mt-2">{LIFETIME_LEGEND}</p>
                )}
                <div className="flex-1" />
                {isCurrent ? (
                  <p className="theme-chip text-[9px] font-black uppercase tracking-widest text-center mt-3 py-2">Plan actual</p>
                ) : rank > currentPlanRank ? (
                  <button type="button" disabled={!!loadingTarget} onClick={() => handleBuy(plan.id)}
                    className="theme-btn-primary w-full mt-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed">
                    {loadingTarget === plan.id ? 'Cargando...' : buttonLabel}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}

      <RewardedAdGate
        open={showAdGate}
        onClaim={() => {
          const next = adsWatched + 1;
          setAdsWatched(next);
          if (next >= TRIAL_UNLOCK_AD_COUNT) {
            setShowAdGate(false);
            setShowTrialAdForm(true);
          }
          // Si todavía faltan rondas, el gate se queda abierto — ya se
          // reseteó solo (ver RewardedAdGate.reset() en cada claim()) y
          // vuelve a mostrar el link para el siguiente anuncio.
        }}
        onCancel={() => { setShowAdGate(false); setAdsWatched(0); }}
        title={`Anuncio ${Math.min(adsWatched + 1, TRIAL_UNLOCK_AD_COUNT)} de ${TRIAL_UNLOCK_AD_COUNT}`}
        claimLabel={adsWatched + 1 >= TRIAL_UNLOCK_AD_COUNT ? 'Reclamar' : 'Continuar'}
        description="Mira este anuncio corto para avanzar — nos ayuda a mantener el servicio gratis."
      />

      {showPolicyModal && <RefundPolicyModal onClose={() => setShowPolicyModal(false)} />}
    </div>
  );
}
