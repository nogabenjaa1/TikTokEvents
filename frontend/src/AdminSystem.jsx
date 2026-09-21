import { useState } from 'react';
import ScrollRow from './ScrollRow';
import SystemAudit from './adminSystem/SystemAudit';
import SystemErrors from './adminSystem/SystemErrors';
import SystemPayments from './adminSystem/SystemPayments';
import SystemStatus from './adminSystem/SystemStatus';
import SystemStorage from './adminSystem/SystemStorage';

const TABS = [
  { id: 'status', label: 'Estado', icon: '📈' },
  { id: 'errors', label: 'Errores', icon: '🐞' },
  { id: 'audit', label: 'Historial', icon: '📜' },
  { id: 'payments', label: 'Pagos', icon: '💳' },
  { id: 'storage', label: 'Archivos', icon: '🗂️' },
];

// Sección "Sistema" (solo administradores): cómo está el servidor, qué errores hay, qué se hizo desde este panel, si
// todo lo cobrado quedó aplicado y qué archivos sobran. Cada pestaña se monta solo mientras está abierta, así que
// ninguna consulta corre en segundo plano.
export default function AdminSystem({ onSessionInvalid }) {
  const [tab, setTab] = useState('status');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center w-full min-w-0 px-3 py-3 flex-shrink-0 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
        <ScrollRow label="Secciones del sistema">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              className={[
                'theme-nav-btn h-9 px-4 rounded-full border flex items-center gap-2 transition-all duration-200 flex-shrink-0',
                tab === t.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
              ].join(' ')}
            >
              <span className="text-base leading-none" aria-hidden="true">{t.icon}</span>
              <span className={['text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', tab === t.id ? 'theme-accent-text' : 'text-gray-500'].join(' ')}>
                {t.label}
              </span>
            </button>
          ))}
        </ScrollRow>
      </div>

      <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-5 font-sans flex-1 overflow-y-auto">
        <div className="w-full max-w-3xl">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black mb-1">🛠️ Administración</p>
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">Sistema</h1>
        </div>
        {tab === 'status' && <SystemStatus onUnauthorized={onSessionInvalid} />}
        {tab === 'errors' && <SystemErrors onUnauthorized={onSessionInvalid} />}
        {tab === 'audit' && <SystemAudit onUnauthorized={onSessionInvalid} />}
        {tab === 'payments' && <SystemPayments onUnauthorized={onSessionInvalid} />}
        {tab === 'storage' && <SystemStorage onUnauthorized={onSessionInvalid} />}
      </div>
    </div>
  );
}
