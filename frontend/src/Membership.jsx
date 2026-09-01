import React, { useState, useEffect } from 'react';
import { Die } from './colorsData';
import { rollFair, rollWithPairBias, PRO_WIN_BONUS } from './diceBias';
import { backendUrl, authHeaders, refreshSession, requestFreeTrial, saveSession, loadSession } from './auth';

const PLANS = [
  { id: 'month', label: 'Mensual', usd: '6.99', mxn: 126, period: '/ mes' },
  { id: 'annual', label: 'Anual', usd: '59.99', mxn: 1080, period: '/ año', savingsChip: 'AHORRAS MX$430' },
  { id: 'lifetime', label: 'Lifetime', usd: '99.99', mxn: 1800, period: 'pago único' },
];
const PLAN_RANK = { month: 1, annual: 2, lifetime: 3 };

// rank: para nunca ofrecer un downgrade y para calcular qué addons mostrar
// según lo que ya tiene la licencia (ver DICE_RANK más abajo).
const ADDONS = [
  {
    id: 'pro', label: 'PRO', usd: '1', mxn: 18, rank: 1, demoBias: PRO_WIN_BONUS,
    desc: 'Activa un sesgo fijo y discreto a favor de sacar pares. Tú prendes o apagas el interruptor cuando quieras — intensidad fija, no ajustable.',
  },
  {
    id: 'vip', label: 'VIP', usd: '3', mxn: 54, rank: 2, demoBias: 0.7,
    desc: 'El mismo interruptor que PRO, pero con un slider de intensidad de 0% a 100% — tú eliges qué tan marcado se nota el sesgo.',
  },
];

const PLAN_LABELS = { day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba (7 días)' };
const DICE_TIER_LABELS = { regular: 'Regular', pro: 'PRO', vip: 'VIP', admin: 'Admin' };
const DICE_RANK = { regular: 0, pro: 1, vip: 2, admin: 3 };

const LIFETIME_LEGEND = 'El acceso Lifetime cubre la plataforma y sus actualizaciones estándar. Funciones o servicios con costos operativos especiales —como IA, voces premium, servidores o integraciones de pago— podrán ofrecerse por separado.';

// Evidencia real, no una animación inventada: se simulan tiradas de verdad
// con la misma función que usa el juego (rollFair/rollWithPairBias, ver
// ./diceBias) y se cuenta cuántas salieron con algún par — así el % que se
// muestra en la comparativa antes/después es el que realmente le tocaría al
// streamer, no un número de marketing.
function samplePairRate(rollFn, trials = 300) {
  let pairs = 0;
  for (let i = 0; i < trials; i++) {
    const seen = new Set();
    for (const v of rollFn()) {
      if (seen.has(v)) { pairs++; break; }
      seen.add(v);
    }
  }
  return Math.round((pairs / trials) * 100);
}

function AddonPreview({ addon }) {
  const [fairRoll, setFairRoll] = useState(() => rollFair(4));
  const [biasRoll, setBiasRoll] = useState(() => rollWithPairBias(4, addon.demoBias));
  const [stats] = useState(() => ({
    fair: samplePairRate(() => rollFair(4)),
    biased: samplePairRate(() => rollWithPairBias(4, addon.demoBias)),
  }));

  const reroll = () => {
    setFairRoll(rollFair(4));
    setBiasRoll(rollWithPairBias(4, addon.demoBias));
  };

  // Radio fijo y moderado a propósito, NO var(--surface-radius) — es una
  // excepción pedida por el dueño del producto: esta caja compara dos
  // grupos de 4 dados lado a lado y necesita leerse como panel de datos
  // ordenado, no como una píldora (que en Kawaii/Cute aprieta el contenido
  // hacia el centro y hace que los 8 dados se vean como un solo bloque).
  // El fondo sigue el token del material (var(--surface-bg-alt)); solo la
  // forma queda fija.
  return (
    <div className="w-full p-4" style={{ background: 'var(--surface-bg-alt)', borderRadius: '14px' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="text-center">
          <p className="theme-label text-[9px] mb-3">Sin sesgo</p>
          <div className="flex justify-center gap-2 flex-wrap">
            {fairRoll.map((c, i) => <Die key={i} colorIdx={c} rolling={false} size="w-9 h-9 text-lg" />)}
          </div>
        </div>
        <div className="self-stretch w-px" style={{ background: 'var(--surface-border-color)' }} />
        <div className="text-center">
          <p className="theme-label text-[9px] mb-3 theme-accent-text">Con {addon.label}</p>
          <div className="flex justify-center gap-2 flex-wrap">
            {biasRoll.map((c, i) => <Die key={i} colorIdx={c} rolling={false} size="w-9 h-9 text-lg" />)}
          </div>
        </div>
      </div>
      <button type="button" onClick={reroll}
        className="theme-btn-secondary w-full mt-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest">
        Tirar de nuevo
      </button>
      <p className="text-[9px] text-gray-500 mt-3 leading-snug text-center">
        En 300 tiradas simuladas de 4 dados: <span className="text-gray-400 font-bold">{stats.fair}%</span> salió con algún
        par sin sesgo, vs. <span className="theme-accent-text font-bold">{stats.biased}%</span> con {addon.label}.
      </p>
    </div>
  );
}

// Pantalla de autoservicio de pago (MercadoPago Checkout Pro). Funciona con
// o sin sesión: sin sesión se ven los planes igual (precio público) pero
// hace falta un alias antes de pagar — se usa para crear la cuenta en el
// mismo paso (ver handleBuy), igual que la prueba gratis de Login.jsx.
// `session` trae licenseType/expiresAt/diceTier ya guardados en el token
// (ver auth.js); `onSessionUpdate` deja que App.jsx refresque su estado
// después de crear la cuenta y/o de volver de un pago.
export default function Membership({ session, onSessionUpdate }) {
  const [alias, setAlias] = useState('');
  const [selectedAddon, setSelectedAddon] = useState(null); // null | 'pro' | 'vip'
  const [previewOpen, setPreviewOpen] = useState(null);
  const [loadingTarget, setLoadingTarget] = useState(null); // null | 'addon' | planId
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(() => new URLSearchParams(window.location.search).get('payment'));
  const [revealedKey, setRevealedKey] = useState(null);
  const [keyCopied, setKeyCopied] = useState(false);

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
  const currentDiceRank = DICE_RANK[session?.diceTier] ?? 0;
  const visibleAddons = ADDONS.filter(a => a.rank > currentDiceRank);
  const previewAddon = ADDONS.find(a => a.id === previewOpen);

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
    if (loadingTarget) return;
    if (!planType && !selectedAddon) return;
    setError('');
    setLoadingTarget(planType || 'addon');
    try {
      const ok = await ensureSession();
      if (!ok) { setLoadingTarget(null); return; }
      const res = await fetch(`${backendUrl()}/api/payments/create-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planType: planType || undefined, diceTier: selectedAddon || undefined }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar el pago');
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
      setLoadingTarget(null);
    }
  };

  const selectedAddonData = ADDONS.find(a => a.id === selectedAddon);

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
        <div className="w-full max-w-2xl">
          <label className="theme-label block text-[10px] mb-2">Alias para tu licencia (obligatorio)</label>
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

      {visibleAddons.length > 0 && (
        <div className="w-full max-w-2xl">
          <p className="theme-label text-[10px] mb-3">Addons opcionales — Color Says</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleAddons.map(addon => (
              <div key={addon.id} className={['theme-surface p-4', selectedAddon === addon.id ? 'theme-surface-featured' : ''].join(' ')}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <p className="text-xs font-black uppercase tracking-widest">{addon.label}</p>
                  <p className="text-sm font-black whitespace-nowrap">+MX${addon.mxn} <span className="text-[9px] text-gray-500 font-normal">(US${addon.usd})</span></p>
                </div>
                <p className="text-[10px] text-gray-500 leading-snug mb-3">{addon.desc}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedAddon(id => id === addon.id ? null : addon.id)}
                    className={[selectedAddon === addon.id ? 'theme-btn-primary' : 'theme-btn-secondary', 'flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest'].join(' ')}>
                    {selectedAddon === addon.id ? 'Seleccionado ✓' : 'Quiero este'}
                  </button>
                  <button type="button" onClick={() => setPreviewOpen(id => id === addon.id ? null : addon.id)}
                    className="theme-btn-secondary flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest">
                    {previewOpen === addon.id ? 'Ocultar preview' : 'Ver preview'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Fuera de la grilla de 2 columnas a propósito: adentro de una
              tarjeta angosta, 8 dados (4 sin sesgo + 4 con addon) uno al
              lado del otro se veían amontonados. Acá abajo tiene todo el
              ancho de la pantalla para respirar. */}
          {previewAddon && (
            <div className="mt-3">
              <p className="theme-label text-[9px] mb-2">Preview — {previewAddon.label}</p>
              <AddonPreview addon={previewAddon} />
            </div>
          )}
          {selectedAddonData && (
            <button type="button" disabled={!!loadingTarget} onClick={() => handleBuy(undefined)}
              className="theme-btn-primary w-full mt-3 px-12 py-4 rounded-xl font-black tracking-widest uppercase text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {loadingTarget === 'addon' ? 'REDIRIGIENDO A MERCADOPAGO...' : `PAGAR MX$${selectedAddonData.mxn} — SOLO ${selectedAddonData.label}`}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
}
