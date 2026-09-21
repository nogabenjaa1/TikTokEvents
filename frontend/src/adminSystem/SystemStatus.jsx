import { backendUrl } from '../auth';
import { formatUptime } from '../systemFormat';
import { useAdminData } from './api';
import { Kpi, PanelBar } from './ui';

// Cómo está el servidor ahora mismo (se refresca solo cada 15 s mientras esta pestaña está a la vista).
export default function SystemStatus({ onUnauthorized }) {
  const { data, error, loading, reload } = useAdminData('/api/admin/system', { onUnauthorized, refreshMs: 15000 });
  const system = data?.system;

  return (
    <section className="w-full max-w-3xl flex flex-col gap-4" aria-label="Estado del servidor">
      <PanelBar title="Estado del servidor" hint="Se actualiza solo cada 15 segundos." onRefresh={reload} loading={loading} />
      {error && <p role="alert" className="theme-notice">{error}</p>}
      {!system && !error && <p className="text-sm text-gray-500 italic">Cargando…</p>}

      {system && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Servidor" value={formatUptime(system.uptimeSeconds)} hint="encendido sin reiniciarse" />
            <Kpi
              label="Base de datos" value={system.db.ok ? 'Conectada' : 'Sin conexión'} tone={system.db.ok ? 'text-green-500' : 'text-red-500'}
              hint={`${system.db.latencyMs} ms${system.db.reason ? ` · ${system.db.reason}` : ''}`}
            />
            <Kpi label="Conexiones" value={system.sockets ?? '—'} hint="paneles y overlays abiertos" />
            <Kpi label="Licencias en uso" value={system.tenants} hint="con su espacio en memoria" />
            <Kpi label="Memoria" value={`${system.memoryMb.rss} MB`} hint={`de trabajo: ${system.memoryMb.heapUsed} MB`} />
            <Kpi
              label="Errores (24 h)" value={system.errors24h.distinct} tone={system.errors24h.distinct ? 'text-amber-500' : ''}
              hint={`${system.errors24h.occurrences} veces en total`}
            />
            <Kpi label="Almacenamiento" value={system.storageConfigured ? 'Configurado' : 'Sin configurar'} hint="archivos de las alertas" />
            <Kpi label="Versión de Node" value={system.node} hint={`arranque ${String(system.bootId || '').slice(0, 8)}`} />
          </div>

          <div className="theme-surface p-4 text-xs text-gray-400 leading-relaxed space-y-2">
            <p>
              <span className="font-bold text-white">¿Quieres que te avisen si la base de datos se cae?</span> Apunta un monitor externo (por ejemplo UptimeRobot) a{' '}
              <code className="theme-input px-1.5 py-0.5 select-all break-all">{`${backendUrl()}/health/deep`}</code>. Responde 200 si todo va bien y 503 si la base no contesta.
            </p>
            <p>
              <code className="theme-input px-1.5 py-0.5">/health</code> se queda solo para el reinicio automático del servidor: no mira la base a propósito, para que un bache no tumbe a todos los streamers que están en directo.
            </p>
            <p>El escritor de errores guardó {system.reporter.written} y descartó {system.reporter.dropped} por exceso de ráfagas desde que arrancó el servidor.</p>
          </div>
        </>
      )}
    </section>
  );
}
