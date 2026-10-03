import { useMemo, useState } from 'react';
import { useAdminData } from './api';
import { EmptyNote, Kpi, PanelBar } from './ui';
import { SkeletonKpis } from '../PanelHelp';

// Analítica propia, sin cookies (ver backend/lib/analytics.js): visitas y
// visitantes únicos por día, las páginas más vistas y de dónde llega la gente.
const RANGES = [7, 30, 90];

const PAGE_NAMES = {
  '/': 'Inicio', '/dashboard': 'Dashboard', '/membership': 'Membresía', '/colordice': 'ColorDice',
  '/overlays': 'Overlays', '/downloader': 'Downloader', '/theme': 'Tema', '/licenses': 'Licencias', '/system': 'Sistema',
  '/aviso-legal': 'Aviso legal', '/privacidad': 'Aviso de privacidad', '/cookies': 'Cookies', '/tiktokevents': 'TikTokEvents',
};
const pageName = (path) => PAGE_NAMES[path] || (path.startsWith('/tiktokevents/') ? `TikTokEvents · ${path.split('/')[2]}` : path);

function shortDay(day) {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export default function SystemAnalytics({ onUnauthorized }) {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useAdminData(`/api/admin/analytics?days=${days}`, { onUnauthorized });

  // Una fila por día del rango, aunque ese día no haya visitas.
  const series = useMemo(() => {
    if (!data) return [];
    const views = Object.fromEntries((data.daily || []).map((r) => [r.day, r.views]));
    const visitors = Object.fromEntries((data.visitors || []).map((r) => [r.day, r.visitors]));
    const out = [];
    const start = new Date(`${data.since}T12:00:00Z`);
    for (let i = 0; i < data.days; i++) {
      const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      out.push({ day, views: views[day] || 0, visitors: visitors[day] || 0 });
    }
    return out;
  }, [data]);
  const totals = series.reduce((acc, d) => ({ views: acc.views + d.views, visitors: acc.visitors + d.visitors }), { views: 0, visitors: 0 });
  const max = Math.max(1, ...series.map((d) => d.views));

  return (
    <section className="w-full max-w-3xl flex flex-col gap-4" aria-label="Visitas">
      <PanelBar title="Visitas" hint="Sin cookies ni datos personales: no cuenta a quien pide no ser rastreado." onRefresh={reload} loading={loading}>
        <div role="radiogroup" aria-label="Periodo" className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r} type="button" role="radio" aria-checked={days === r} onClick={() => setDays(r)}
              className={['h-8 px-2.5 rounded-lg border text-[10px] font-black uppercase tracking-wider', days === r ? 'theme-nav-btn-active theme-accent-text' : 'text-gray-500'].join(' ')}
              style={days === r ? undefined : { borderColor: 'var(--surface-border-color)' }}
            >
              {r} días
            </button>
          ))}
        </div>
      </PanelBar>
      {error && <p role="alert" className="theme-notice">{error}</p>}
      {!data && !error && <SkeletonKpis count={3} label="Cargando visitas…" className="grid grid-cols-3 gap-2" />}

      {data && (
        <div className="tkc-reveal contents">
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Visitas" value={totals.views.toLocaleString('es-MX')} hint={`últimos ${data.days} días`} />
            <Kpi label="Visitantes por día" value={series.length ? Math.round(totals.visitors / series.length).toLocaleString('es-MX') : '0'} hint="promedio de únicos diarios" />
            <Kpi label="Hoy" value={(series.at(-1)?.views || 0).toLocaleString('es-MX')} hint={`${series.at(-1)?.visitors || 0} visitantes`} />
          </div>

          <div className="theme-surface p-4">
            <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-3">Visitas por día</p>
            {totals.views === 0 ? (
              <p className="text-sm text-gray-500">Todavía no hay visitas registradas en este periodo.</p>
            ) : (
              <ol className="flex items-end gap-[2px] h-32" aria-label="Visitas por día">
                {series.map((d) => (
                  <li key={d.day} className="flex-1 h-full flex items-end" title={`${shortDay(d.day)}: ${d.views} visitas, ${d.visitors} visitantes`}>
                    <div className="w-full theme-accent-bg rounded-t-sm" style={{ height: `${Math.max(d.views ? 4 : 1, (d.views / max) * 100)}%`, opacity: d.views ? 1 : 0.25 }} />
                  </li>
                ))}
              </ol>
            )}
            {series.length > 0 && (
              <div className="flex justify-between text-[10px] text-gray-500 mt-1"><span>{shortDay(series[0].day)}</span><span>{shortDay(series.at(-1).day)}</span></div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="theme-surface p-4">
              <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">Páginas más vistas</p>
              {(data.paths || []).length === 0 ? <p className="text-sm text-gray-500">Sin datos.</p> : (
                <ul className="flex flex-col gap-1">
                  {data.paths.map((p) => (
                    <li key={p.path} className="flex justify-between gap-2 text-xs"><span className="truncate">{pageName(p.path)}</span><span className="font-black tabular-nums">{p.views.toLocaleString('es-MX')}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="theme-surface p-4">
              <p className="theme-label text-[10px] uppercase tracking-widest font-semibold mb-2">De dónde llegan</p>
              {(data.sources || []).length === 0 ? <p className="text-sm text-gray-500">Todavía nadie llegó desde otro sitio.</p> : (
                <ul className="flex flex-col gap-1">
                  {data.sources.map((s) => (
                    <li key={s.source} className="flex justify-between gap-2 text-xs"><span className="truncate">{s.source}</span><span className="font-black tabular-nums">{s.views.toLocaleString('es-MX')}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {data && totals.views === 0 && (data.paths || []).length === 0 && <EmptyNote>Las visitas empiezan a contarse con este cambio.</EmptyNote>}
    </section>
  );
}
