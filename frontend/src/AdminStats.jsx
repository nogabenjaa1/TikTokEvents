import { useCallback, useEffect, useState } from 'react';
import { backendUrl, authHeaders } from './auth';

const PLAN_NAMES = {
  day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba',
  spotify_addon: 'Complemento Spotify', dice_pro: 'Color Says PRO', dice_vip: 'Color Says VIP', otro: 'Otro',
};
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const mxn = (cents) => `MX$ ${((cents || 0) / 100).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
const monthLabel = (key) => MONTH_NAMES[Number(key.split('-')[1]) - 1] || key;
const dayLabel = (ms) => new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

function daysUntil(ms) {
  const days = Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoy';
  return days === 1 ? 'mañana' : `en ${days} días`;
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className="theme-input p-3 flex flex-col gap-0.5 min-w-0">
      <span className="theme-label text-[9px] uppercase tracking-widest font-semibold">{label}</span>
      <span className={`text-xl font-black leading-tight ${tone || ''}`}>{value}</span>
      {hint && <span className="text-[10px] text-gray-500 leading-snug">{hint}</span>}
    </div>
  );
}

// Cambio frente al mes anterior. Va con flecha Y texto para que no dependa
// solo del color.
function deltaText(now, before) {
  if (!before) return now > 0 ? '▲ primer mes con ventas' : 'sin ventas todavía';
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return '= igual que el mes pasado';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs. el mes pasado`;
}

// Resumen del negocio para el admin (ver GET /api/admin/stats): ingresos,
// licencias por plan, quién vence pronto y cuántas pruebas se vuelven pago.
export default function AdminStats({ onUnauthorized }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/admin/stats`, { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized?.(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudieron cargar las estadísticas');
      setStats(data.stats);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => { load(); }, [load]);

  const rev = stats?.revenue;
  const maxMonth = rev ? Math.max(1, ...rev.months.map((m) => m.cents)) : 1;

  return (
    <section className="theme-surface w-full max-w-lg p-5 flex flex-col gap-4" aria-labelledby="admin-stats-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="admin-stats-title" className="theme-label text-xs uppercase tracking-widest font-semibold">📊 Resumen del negocio</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={load} disabled={loading} className="text-[10px] font-bold text-sky-700 hover:underline disabled:opacity-40 py-2">
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[10px] font-bold text-gray-400 hover:text-white underline py-2">
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {open && error && <p role="alert" className="text-xs font-bold text-red-700">{error}</p>}
      {open && !stats && !error && <p className="text-sm text-gray-500 italic">Cargando resumen…</p>}

      {open && stats && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Ingresos del mes" value={mxn(rev.thisMonthCents)} hint={`${rev.thisMonthCount} pago${rev.thisMonthCount === 1 ? '' : 's'} · ${deltaText(rev.thisMonthCents, rev.lastMonthCents)}`} />
            <Kpi label="Licencias activas" value={stats.licenses.active} hint={`de ${stats.licenses.total} (${stats.licenses.expired} vencidas, ${stats.licenses.revoked} revocadas)`} />
            <Kpi label={`Vencen en ${stats.licenses.expiringWindowDays} días`} value={stats.licenses.expiringSoonCount} hint="candidatas a renovar" />
            <Kpi label="Prueba → pago" value={stats.trials.conversionRate === null ? '—' : `${Math.round(stats.trials.conversionRate * 100)}%`} hint={`${stats.trials.converted} de ${stats.trials.total} pruebas · ${stats.trials.active} activas`} />
          </div>

          <div>
            <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">Ingresos, últimos {rev.months.length} meses</p>
            <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${rev.months.length}, minmax(0, 1fr))` }}>
              {rev.months.map((m) => (
                <li key={m.key} className="flex flex-col items-center gap-1 min-w-0">
                  <span className="text-[9px] font-bold text-gray-400 truncate max-w-full">{m.cents ? mxn(m.cents) : '—'}</span>
                  <div className="w-full h-20 flex items-end">
                    <div className="w-full theme-accent-bg rounded-t" style={{ height: `${Math.max(m.cents ? 6 : 2, (m.cents / maxMonth) * 100)}%`, opacity: m.cents ? 1 : 0.25 }} />
                  </div>
                  <span className="text-[10px] uppercase font-bold text-gray-500">{monthLabel(m.key)}</span>
                </li>
              ))}
            </ol>
            <p className="text-[10px] text-gray-500 mt-1">Total histórico: {mxn(rev.totalCents)} en {rev.paymentsCount} pago{rev.paymentsCount === 1 ? '' : 's'}.</p>
          </div>

          <div>
            <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">Licencias activas por plan</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.licenses.byPlan).length === 0 && <span className="text-[11px] text-gray-500">Todavía no hay licencias activas.</span>}
              {Object.entries(stats.licenses.byPlan).sort((a, b) => b[1] - a[1]).map(([plan, count]) => (
                <span key={plan} className="theme-chip px-2.5 py-1 rounded-full text-[10px] font-bold">{PLAN_NAMES[plan] || plan}: {count}</span>
              ))}
              {stats.licenses.spotifyAddon > 0 && <span className="theme-chip px-2.5 py-1 rounded-full text-[10px] font-bold">🎵 Con Spotify: {stats.licenses.spotifyAddon}</span>}
              {stats.licenses.multiDevice > 0 && <span className="theme-chip px-2.5 py-1 rounded-full text-[10px] font-bold">🔓 Multi-dispositivo: {stats.licenses.multiDevice}</span>}
            </div>
          </div>

          {stats.licenses.expiringSoon.length > 0 && (
            <div>
              <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">Por vencer</p>
              <ul className="flex flex-col gap-1">
                {stats.licenses.expiringSoon.map((l) => (
                  <li key={`${l.username}-${l.expiresAt}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-gray-200 truncate">@{l.username}</span>
                    <span className="text-gray-500 whitespace-nowrap">{PLAN_NAMES[l.licenseType] || l.licenseType} · vence {daysUntil(l.expiresAt)} ({dayLabel(l.expiresAt)})</span>
                  </li>
                ))}
              </ul>
              {stats.licenses.expiringSoonCount > stats.licenses.expiringSoon.length && (
                <p className="text-[10px] text-gray-500 mt-1">y {stats.licenses.expiringSoonCount - stats.licenses.expiringSoon.length} más (usa el filtro «Por vencer» de la lista).</p>
              )}
            </div>
          )}

          {rev.recent.length > 0 && (
            <div>
              <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">Últimos pagos</p>
              <ul className="flex flex-col gap-1">
                {rev.recent.map((p, i) => (
                  <li key={`${p.createdAt}-${i}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate"><span className="font-bold text-gray-200">@{p.username}</span> <span className="text-gray-500">· {PLAN_NAMES[p.item] || p.item} · {p.provider === 'stripe' ? 'Stripe' : 'MercadoPago'}</span></span>
                    <span className="whitespace-nowrap"><strong>{mxn(p.amountCents)}</strong> <span className="text-gray-500">{dayLabel(p.createdAt)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
