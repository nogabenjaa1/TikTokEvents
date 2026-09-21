import { useState } from 'react';
import { actionLabel, describeDetails, describeTarget, formatDateTime, formatWhen } from '../systemFormat';
import { adminRequest, useAdminData } from './api';
import { EmptyNote, PanelBar } from './ui';

const PAGE_SIZE = 50;

// Quién hizo qué desde el panel de administración (licencias, precios, limpiezas, pagos aplicados a mano).
// Nunca guarda claves: solo quién, qué y sobre qué licencia. Se conserva un año.
export default function SystemAudit({ onUnauthorized }) {
  const { data, error, loading, reload } = useAdminData(`/api/admin/audit?limit=${PAGE_SIZE}`, { onUnauthorized });
  const [older, setOlder] = useState([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');

  const first = data?.entries || [];
  const entries = [...first, ...older];
  const canLoadMore = !exhausted && first.length >= PAGE_SIZE;

  const refresh = async () => {
    setOlder([]);
    setExhausted(false);
    setMoreError('');
    await reload();
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError('');
    try {
      const before = entries[entries.length - 1].at;
      const page = await adminRequest(`/api/admin/audit?limit=${PAGE_SIZE}&before=${before}`, { onUnauthorized });
      setOlder((current) => [...current, ...page.entries]);
      if (page.entries.length < PAGE_SIZE) setExhausted(true);
    } catch (err) {
      setMoreError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="w-full max-w-3xl flex flex-col gap-4" aria-label="Historial de acciones del administrador">
      <PanelBar
        title="Historial del administrador" onRefresh={refresh} loading={loading}
        hint="Lo que se hizo desde este panel, lo más nuevo primero. No guarda claves. Se conserva un año."
      />
      {(error || moreError) && <p role="alert" className="theme-notice">{moreError || error}</p>}
      {!data && !error && <p className="text-sm text-gray-500 italic">Cargando…</p>}
      {data && entries.length === 0 && <EmptyNote>Todavía no hay acciones registradas.</EmptyNote>}

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => {
          const detail = describeDetails(entry.action, entry.details);
          const target = describeTarget(entry);
          return (
            <li key={entry.id} className="theme-surface p-3 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-xs font-bold text-white">{actionLabel(entry.action)}{target ? <span className="theme-accent-text"> · {target}</span> : null}</span>
                <time dateTime={new Date(entry.at).toISOString()} className="text-[11px] text-gray-500 whitespace-nowrap" title={formatDateTime(entry.at)}>
                  {formatDateTime(entry.at)} · {formatWhen(entry.at)}
                </time>
              </div>
              <p className="text-[11px] text-gray-500">Por @{entry.admin}{detail ? ` · ${detail}` : ''}</p>
            </li>
          );
        })}
      </ul>

      {canLoadMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="theme-btn-secondary theme-btn-md self-center font-black uppercase tracking-widest disabled:opacity-50">
          {loadingMore ? 'Cargando…' : 'Ver más antiguas'}
        </button>
      )}
    </section>
  );
}
