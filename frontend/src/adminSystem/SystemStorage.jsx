import { useCallback, useState } from 'react';
import { formatBytes, formatWhen } from '../systemFormat';
import { adminRequest } from './api';
import { EmptyNote, Kpi, PanelBar } from './ui';

// Los archivos de las alertas (imágenes, GIF, videos y sonidos) que están en el almacenamiento. Revisar recorre todo
// el almacenamiento, así que solo se hace al pulsar el botón. Un "huérfano" es un archivo que ninguna alerta ni ningún
// sonido de Objetivo usa y que tiene más de 24 horas (una subida reciente todavía puede estar guardándose).
export default function SystemStorage({ onUnauthorized }) {
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const runScan = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      setScan(await adminRequest('/api/admin/storage', { onUnauthorized }));
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }, [onUnauthorized]);

  const cleanup = async () => {
    const { orphans, orphanBytes } = scan.totals;
    if (!window.confirm(`¿Borrar ${orphans} ${orphans === 1 ? 'archivo huérfano' : 'archivos huérfanos'} (${formatBytes(orphanBytes)})? Son archivos que ninguna alerta ni sonido de Objetivo usa y que tienen más de 24 horas. No se puede deshacer.`)) return;
    setCleaning(true);
    setError('');
    setNotice('');
    try {
      const result = await adminRequest('/api/admin/storage/cleanup', { method: 'POST', onUnauthorized });
      setNotice(`Se borraron ${result.deleted} ${result.deleted === 1 ? 'archivo' : 'archivos'}${result.failed ? `; ${result.failed} no se pudieron borrar` : ''}.${result.remaining ? ` Quedan ${result.remaining}: repite la limpieza.` : ''}`);
      await runScan();
    } catch (err) {
      setError(err.message);
    } finally {
      setCleaning(false);
    }
  };

  const totals = scan?.totals;
  const busy = scanning || cleaning;

  return (
    <section className="w-full max-w-3xl flex flex-col gap-4" aria-label="Archivos en el almacenamiento">
      <PanelBar
        title="Archivos de las alertas"
        hint="Revisar recorre todo el almacenamiento y puede tardar unos segundos. Al eliminar una licencia sus archivos se borran solos; esto limpia lo que haya quedado suelto."
      >
        <button type="button" onClick={runScan} disabled={busy} className="theme-btn-primary theme-btn-md font-black uppercase tracking-widest disabled:opacity-50">
          {scanning ? 'Revisando…' : scan ? 'Revisar de nuevo' : 'Revisar el almacenamiento'}
        </button>
      </PanelBar>

      {error && <p role="alert" className="theme-notice">{error}</p>}
      {notice && <p role="status" className="theme-notice theme-notice-success">{notice}</p>}
      {scan && !scan.configured && <EmptyNote>El almacenamiento (Supabase) no está configurado en este servidor.</EmptyNote>}

      {scan?.configured && totals && (
        <>
          {scan.truncated && (
            <p role="status" className="theme-notice theme-notice-warning">La revisión no alcanzó a recorrer todo (hay demasiados archivos), así que los números son parciales. Repítela para seguir limpiando.</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Archivos" value={totals.files.toLocaleString('es-MX')} />
            <Kpi label="Tamaño total" value={formatBytes(totals.bytes)} />
            <Kpi label="Huérfanos" value={totals.orphans.toLocaleString('es-MX')} tone={totals.orphans ? 'text-amber-500' : ''} />
            <Kpi label="Se libera" value={formatBytes(totals.orphanBytes)} hint="al borrar los huérfanos" />
          </div>

          {scan.top.length > 0 && (
            <div className="theme-surface p-4">
              <h3 className="text-xs font-black uppercase tracking-widest mb-2">Quién ocupa más espacio</h3>
              <ol className="flex flex-col gap-1 text-[11px]">
                {scan.top.map((entry) => (
                  <li key={entry.licenseId} className="flex flex-wrap justify-between gap-2">
                    <span className="font-bold text-gray-200">{entry.license.startsWith('(') ? entry.license : `@${entry.license}`}</span>
                    <span className="text-gray-500">{entry.files} {entry.files === 1 ? 'archivo' : 'archivos'} · {formatBytes(entry.bytes)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {totals.orphans === 0 ? (
            <EmptyNote>No hay archivos huérfanos. Todo lo que hay lo usa una alerta o un sonido de Objetivo.</EmptyNote>
          ) : (
            <div className="theme-surface p-4 flex flex-col gap-3">
              <h3 className="text-xs font-black uppercase tracking-widest">Archivos huérfanos</h3>
              <ul className="flex flex-col gap-1 text-[11px]">
                {scan.orphans.map((orphan) => (
                  <li key={orphan.path} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                    <code className="break-all text-gray-300">{orphan.path}</code>
                    <span className="text-gray-500 whitespace-nowrap">{formatBytes(orphan.size)} · {formatWhen(orphan.createdAt)}</span>
                  </li>
                ))}
              </ul>
              {totals.orphans > scan.orphans.length && <p className="text-[11px] text-gray-500">y {totals.orphans - scan.orphans.length} más.</p>}
              <button
                type="button" onClick={cleanup} disabled={busy}
                className="theme-btn-danger theme-btn-md self-start font-black uppercase tracking-widest disabled:opacity-50"
              >
                {cleaning ? 'Borrando…' : `Borrar ${totals.orphans} ${totals.orphans === 1 ? 'huérfano' : 'huérfanos'}`}
              </button>
              <p className="text-[10px] text-gray-500">Se borran de a 500 por vez. La lista de arriba se vuelve a calcular en el servidor al borrar: nunca se toca un archivo en uso.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
