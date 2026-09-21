import { useMemo, useState } from 'react';
import { formatWhen, kindLabel, sourceLabel } from '../systemFormat';
import { adminRequest, useAdminData } from './api';
import { Badge, EmptyNote, PanelBar } from './ui';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'frontend', label: 'Navegador' },
  { id: 'backend', label: 'Servidor' },
  { id: 'csp', label: 'Seguridad' },
];

const SOURCE_TONES = { frontend: 'info', backend: 'danger', csp: 'warning' };

// Lo que falló en los navegadores de los streamers (y en sus overlays de OBS), en el servidor y los avisos de la
// política de seguridad. El mismo error repetido es UNA fila con un contador.
export default function SystemErrors({ onUnauthorized }) {
  const { data, error, loading, reload } = useAdminData('/api/admin/errors', { onUnauthorized });
  const [filter, setFilter] = useState('all');
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState('');

  const errors = useMemo(() => data?.errors || [], [data]);
  const counts = useMemo(() => {
    const result = { all: errors.length, frontend: 0, backend: 0, csp: 0 };
    for (const item of errors) if (item.source in result) result[item.source]++;
    return result;
  }, [errors]);
  const visible = filter === 'all' ? errors : errors.filter((item) => item.source === filter);

  const clearAll = async () => {
    if (!window.confirm('¿Borrar todos los errores registrados? Los que sigan ocurriendo volverán a aparecer.')) return;
    setClearing(true);
    setActionError('');
    try {
      await adminRequest('/api/admin/errors', { method: 'DELETE', onUnauthorized });
      await reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="w-full max-w-3xl flex flex-col gap-4" aria-label="Errores registrados">
      <PanelBar
        title="Errores registrados" onRefresh={reload} loading={loading}
        hint="Se guardan 30 días y hasta 500 distintos. Un error que se repite suma al contador de su fila."
      >
        <button type="button" onClick={clearAll} disabled={clearing || errors.length === 0} className="theme-link theme-link-danger disabled:opacity-40">
          {clearing ? 'Borrando…' : 'Borrar todo'}
        </button>
      </PanelBar>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por origen">
        {FILTERS.map((item) => (
          <button
            key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id}
            className={`${filter === item.id ? 'theme-btn-primary' : 'theme-btn-secondary'} theme-btn-sm font-black uppercase tracking-widest`}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>

      {(error || actionError) && <p role="alert" className="theme-notice">{actionError || error}</p>}
      {!data && !error && <p className="text-sm text-gray-500 italic">Cargando…</p>}
      {data && visible.length === 0 && <EmptyNote>No hay errores registrados{filter === 'all' ? '' : ' de este origen'}. Buena señal.</EmptyNote>}

      {data && data.last24h && errors.length > 0 && (
        <p className="text-[11px] text-gray-500">En las últimas 24 horas: {data.last24h.distinct} distintos, {data.last24h.occurrences} veces en total.</p>
      )}

      <ul className="flex flex-col gap-2">
        {visible.map((item) => (
          <li key={item.id}>
            <details className="theme-surface p-3">
              <summary className="cursor-pointer flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge tone={SOURCE_TONES[item.source] || 'muted'}>{sourceLabel(item.source)}</Badge>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{kindLabel(item.kind)}</span>
                <span className="text-xs font-bold text-white break-words min-w-0 flex-1 basis-56">{item.message}</span>
                <span className="text-[11px] font-black theme-accent-text whitespace-nowrap">×{item.occurrences}</span>
                <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatWhen(item.lastSeen)}</span>
              </summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-gray-500">Licencia</dt>
                <dd className="break-words">{item.license ? `@${item.license}` : 'Sin sesión / no aplica'}</dd>
                <dt className="text-gray-500">Primera vez</dt>
                <dd>{formatWhen(item.firstSeen)}</dd>
                <dt className="text-gray-500">Dónde</dt>
                <dd className="break-all">{item.context || '—'}</dd>
                <dt className="text-gray-500">Navegador</dt>
                <dd className="break-words">{item.userAgent || '—'}</dd>
              </dl>
              {item.stack && <pre className="theme-input mt-3 p-3 text-[10px] leading-snug whitespace-pre-wrap break-words max-h-64 overflow-auto">{item.stack}</pre>}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
