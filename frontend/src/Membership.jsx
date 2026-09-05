import React, { useState, useEffect } from 'react';
import { backendUrl, authHeaders, refreshSession, requestFreeTrial, saveSession, loadSession, loginWithKey } from './auth';

const PLANS = [
  { id: 'month', label: 'Mensual', usd: '6.99', mxn: 126, period: '/ mes' },
  { id: 'annual', label: 'Anual', usd: '59.99', mxn: 1080, period: '/ año', savingsChip: 'AHORRAS MX$430' },
  { id: 'lifetime', label: 'Lifetime', usd: '99.99', mxn: 1800, period: 'pago único' },
];
const PLAN_RANK = { month: 1, annual: 2, lifetime: 3 };

const PLAN_LABELS = { day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba (7 días)' };
// El WIN BONUS de Color Says dejó de venderse como addon PRO/VIP (pedido
// explícito: la dinámica debe ser transparente por default) — ahora es una
// excepción manual que un admin prende por licencia puntual desde el panel
// de Licencias, nunca algo que se compre acá. `DICE_TIER_LABELS` se
// mantiene solo para mostrar el nivel actual en el resumen de abajo — el
// nivel en sí ya no tiene una vitrina de compra.
const DICE_TIER_LABELS = { regular: 'Regular', pro: 'PRO', vip: 'VIP', admin: 'Admin' };

const LIFETIME_LEGEND = 'El acceso Lifetime cubre la plataforma y sus actualizaciones estándar. Funciones o servicios con costos operativos especiales —como IA, voces premium, servidores o integraciones de pago— podrán ofrecerse por separado.';

// Pantalla de autoservicio de pago (MercadoPago Checkout Pro). Funciona con
// o sin sesión: sin sesión se ven los planes igual (precio público) pero
// hace falta un alias antes de pagar — se usa para crear la cuenta en el
// mismo paso (ver handleBuy), igual que la prueba gratis de Login.jsx.
// `session` trae licenseType/expiresAt/diceTier ya guardados en el token
// (ver auth.js); `onSessionUpdate` deja que App.jsx refresque su estado
// después de crear la cuenta y/o de volver de un pago.
export default function Membership({ session, onSessionUpdate }) {
  const [alias, setAlias] = useState('');
  const [loadingTarget, setLoadingTarget] = useState(null); // null | planId
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('payment'));
  const [revealedKey, setRevealedKey] = useState(null);
  const [keyCopied, setKeyCopied] = useState(false);

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
    const cleanAlias = alias.trim();
    if (!cleanAlias) {
      setError('Escribe un alias para tu licencia antes de continuar.');
      return false;
    }
    const { token, key, license } = await requestFreeTrial(cleanAlias);
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
      if (!ok) { setLoadingTarget(null); return; }
      const res = await fetch(`${backendUrl()}/api/payments/create-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar el pago');
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
      setLoadingTarget(null);
    }
  };

  return (
    <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-6 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">💳 Membresía</p>

      {/* Mismo tratamiento que los avisos de Login.jsx (fondo teñido + borde
          fino parejo, no una franja lateral) — un solo lenguaje de "aviso"
          en toda la app en vez de introducir un segundo estilo de alerta. */}
      {banner && (
        <div className={['w-full max-w-2xl rounded-lg px-4 py-3 text-xs font-bold border',
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
          {loginError && <p className="text-[10px] font-bold text-red-500 sm:basis-full">{loginError}</p>}
        </form>
      )}

      {!session && (
        <div className="w-full max-w-2xl">
          <label className="theme-label block text-[10px] mb-2">¿Nueva? Elige un alias para tu licencia (obligatorio para comprar o probar gratis)</label>
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Elige un alias"
            className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
          <p className="text-[9px] text-gray-500 mt-1">Se usa para crear tu cuenta y va incluido en tu clave (alias-plan-hash).</p>
        </div>
      )}

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
                <p className="text-2xl font-black">MX${plan.mxn.toLocaleString('es-MX')}</p>
                <p className="text-[10px] text-gray-500 mb-1">{plan.period} · referencia US${plan.usd}</p>
                {plan.id === 'lifetime' && (
                  <p className="text-[9px] text-gray-500 leading-snug mt-2">{LIFETIME_LEGEND}</p>
                )}
                <div className="flex-1" />
                {isCurrent ? (
                  <p className="theme-chip text-[9px] font-black uppercase tracking-widest text-center mt-3 py-2">Plan actual</p>
                ) : rank > currentPlanRank ? (
                  <button type="button" disabled={!!loadingTarget} onClick={() => handleBuy(plan.id)}
                    className="theme-btn-primary w-full mt-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed">
                    {loadingTarget === plan.id ? 'Redirigiendo...' : buttonLabel}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
}
