import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { backendUrl, authHeaders } from './auth';

// Tipos que el admin puede elegir a mano (crear o extender). Las pruebas
// gratis ('trial') se generan solo desde /api/free-trial, autoservicio —
// no aparecen acá como opción para crear, solo se muestran si ya existen.
const CREATE_TYPES = { day: '1 día', week: '1 semana', month: '1 mes', annual: '1 año', lifetime: 'De por vida' };
const DURATION_LABELS = { ...CREATE_TYPES, trial: 'Prueba (7 días)' };
const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

// Nivel de Color Says — independiente del tipo/duración de la licencia y
// de isAdmin (ver el comentario en backend/db.js): 'admin' acá es el nivel
// más alto que se le puede vender a cualquier licencia paga, no permisos
// reales de administración de la plataforma.
const DICE_TIERS = { regular: 'Regular', pro: 'PRO', vip: 'VIP', admin: 'Admin' };

const STATUS_FILTERS = [
  { id: 'all',      label: 'Todas' },
  { id: 'active',   label: 'Activas' },
  { id: 'expiring', label: 'Por vencer' },
  { id: 'expired',  label: 'Expiradas' },
  { id: 'revoked',  label: 'Revocadas' },
  { id: 'trial',    label: 'Prueba' },
];

function statusOf(license) {
  if (license.revoked) return { id: 'revoked', label: 'Revocada', className: 'text-red-400 bg-red-950/40 border-red-800/50' };
  if (license.expiresAt !== null && license.expiresAt <= Date.now()) return { id: 'expired', label: 'Expirada', className: 'text-gray-500 bg-[var(--surface-bg-alt)] border-[var(--surface-border-color)]' };
  if (license.expiresAt !== null && license.expiresAt - Date.now() <= EXPIRING_SOON_MS) return { id: 'expiring', label: 'Por vencer', className: 'text-amber-400 bg-amber-950/40 border-amber-800/50' };
  return { id: 'active', label: 'Activa', className: 'text-green-400 bg-green-950/40 border-green-800/50' };
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}

// Toasts con los tokens de tema (theme-surface + borde de color fijo según
// el tipo) — mismo criterio que los badges de estado: el color es fijo
// (verde éxito / rojo error), no sigue el acento, pero el fondo sí respeta
// el material activo en vez de quedar un cuadro oscuro fijo.
function ToastStack({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-72">
      {toasts.map(t => (
        <div key={t.id} className={[
          'theme-surface px-4 py-3 text-xs font-bold shadow-lg border-l-4',
          t.type === 'error' ? 'border-l-red-500 text-red-700' : 'border-l-emerald-500 text-emerald-700',
        ].join(' ')}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// Panel de administración de licencias — solo visible si la sesión actual
// tiene isAdmin (hoy, la única es notbenjaa1). No confundir con
// AdminPanel.jsx, que es el panel de juego de Rey del Trono.
export default function LicenseManager() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [licenseType, setLicenseType] = useState('week');
  const [diceTier, setDiceTier] = useState('regular');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // se muestra una sola vez
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [extendingId, setExtendingId] = useState(null);
  const [extendType, setExtendType] = useState('week');
  const [extendDiceTier, setExtendDiceTier] = useState('regular');

  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const fetchLicenses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/licenses`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudieron cargar las licencias');
      setLicenses(data.licenses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

  const createLicense = async (e) => {
    e.preventDefault();
    if (!username.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/licenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: username.trim(), licenseType, diceTier }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo crear la licencia');
      setNewKey({ key: data.key, username: data.license.username });
      setUsername('');
      fetchLicenses();
    } catch (err) {
      pushToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id) => {
    if (!window.confirm('¿Revocar esta licencia? El usuario perderá el acceso de inmediato.')) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${id}/revoke`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo revocar');
      pushToast('Licencia revocada');
      fetchLicenses();
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  // Borrado real de la fila (a diferencia de revocar). El backend ya
  // rechaza borrar una licencia todavía activa, pero se confirma igual acá
  // para no depender solo de esa barrera.
  const deleteLicenseRow = async (lic) => {
    if (!window.confirm(`¿Eliminar para siempre la licencia de @${lic.username}? Esto no se puede deshacer.`)) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${lic.id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo eliminar');
      pushToast('Licencia eliminada');
      fetchLicenses();
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  const extendLicense = async (id) => {
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${id}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ licenseType: extendType, diceTier: extendDiceTier }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo extender');
      pushToast('Licencia actualizada');
      setExtendingId(null);
      fetchLicenses();
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  // "Todopoderosa": se salta la restricción de un solo dispositivo por
  // completo. Pensado para el owner (notbenjaa1), no para licencias de pago.
  const toggleMultiDevice = async (lic) => {
    const turningOn = !lic.multiDevice;
    if (turningOn && !window.confirm(`¿Convertir la licencia de @${lic.username} en "todopoderosa"? Va a poder usarse en cualquier cantidad de dispositivos a la vez, sin restricciones.`)) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${lic.id}/multi-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: turningOn }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo actualizar');
      pushToast(turningOn ? 'Licencia convertida en multi-dispositivo' : 'Multi-dispositivo desactivado');
      fetchLicenses();
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const summary = useMemo(() => ({
    total: licenses.length,
    active: licenses.filter(l => statusOf(l).id === 'active').length,
    trial: licenses.filter(l => l.licenseType === 'trial').length,
    revoked: licenses.filter(l => l.revoked).length,
  }), [licenses]);

  const filteredLicenses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return licenses.filter(lic => {
      if (term && !lic.username.toLowerCase().includes(term)) return false;
      if (statusFilter === 'trial') return lic.licenseType === 'trial';
      if (statusFilter !== 'all') return statusOf(lic).id === statusFilter;
      return true;
    });
  }, [licenses, search, statusFilter]);

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🔑 Licencias</p>

      {/* Modal simple: key nueva, se muestra UNA sola vez */}
      {newKey && (
        <div className="w-full max-w-lg bg-red-500/10 border-2 border-red-500/40 rounded-2xl p-5">
          <p className="text-xs font-black uppercase tracking-widest text-red-700 mb-2">Guarda esta clave ahora — no se vuelve a mostrar</p>
          <p className="text-sm text-gray-300 mb-2">Licencia para <strong className="text-white">@{newKey.username}</strong>:</p>
          <div className="flex items-center gap-2">
            <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{newKey.key}</code>
            <button onClick={copyKey} className="theme-btn-primary px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
              {copied ? '✅ Copiado' : 'Copiar'}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-3 text-[11px] text-gray-500 hover:text-gray-300 underline">Cerrar</button>
        </div>
      )}

      {/* Crear licencia */}
      <form onSubmit={createLicense} className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
        <p className="theme-label text-xs uppercase tracking-widest font-semibold">Nueva licencia</p>
        <div className="flex gap-2">
          <input
            value={username} onChange={e => setUsername(e.target.value)}
            placeholder="usuario de TikTok"
            className="theme-input flex-1 p-3 outline-none text-sm placeholder-gray-600"
          />
          <select
            value={licenseType} onChange={e => setLicenseType(e.target.value)}
            className="theme-input p-3 outline-none text-sm"
          >
            {Object.entries(CREATE_TYPES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="theme-label text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap">Nivel Color Says</span>
          <select
            value={diceTier} onChange={e => setDiceTier(e.target.value)}
            className="theme-input flex-1 p-3 outline-none text-sm"
          >
            {Object.entries(DICE_TIERS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={creating || !username.trim()}
          className="theme-btn-primary py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed">
          {creating ? 'CREANDO...' : 'CREAR LICENCIA'}
        </button>
      </form>

      {error && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{error}</p>}

      {/* Resumen + filtros */}
      <div className="w-full max-w-lg flex flex-col gap-3">
        <div className="flex gap-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
          <span>Total <strong className="text-gray-200">{summary.total}</strong></span>
          <span>· Activas <strong className="text-green-400">{summary.active}</strong></span>
          <span>· Prueba <strong className="text-amber-400">{summary.trial}</strong></span>
          <span>· Revocadas <strong className="text-red-400">{summary.revoked}</strong></span>
        </div>
        <div className="flex gap-2">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por usuario"
            className="theme-input flex-1 p-3 outline-none text-sm placeholder-gray-600"
          />
          <select
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="theme-input p-3 outline-none text-sm"
          >
            {STATUS_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {/* Listado */}
      <div className="w-full max-w-lg flex flex-col gap-2">
        {loading ? (
          <p className="text-gray-600 text-sm italic text-center">Cargando licencias...</p>
        ) : filteredLicenses.length === 0 ? (
          <p className="text-gray-600 text-sm italic text-center">
            {licenses.length === 0 ? 'No hay licencias todavía.' : 'Ninguna licencia coincide con el filtro.'}
          </p>
        ) : filteredLicenses.map(lic => {
          const status = statusOf(lic);
          const deletable = lic.revoked || status.id === 'expired';
          return (
            <div key={lic.id} className="theme-surface p-4 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-100">
                  @{lic.username} {lic.isAdmin && <span className="text-yellow-400 text-[10px] ml-1">ADMIN</span>}
                  {lic.multiDevice && <span className="text-emerald-400 text-[10px] ml-1">🔓 MULTI-DISPOSITIVO</span>}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border ${status.className}`}>{status.label}</span>
              </div>
              <p className="text-[11px] text-gray-500">clave: {lic.keyPrefix}••••••••• · tipo: {DURATION_LABELS[lic.licenseType] || lic.licenseType} · nivel Color Says: {DICE_TIERS[lic.diceTier] || lic.diceTier}</p>
              <p className="text-[11px] text-gray-500">creada: {fmtDate(lic.createdAt)} · expira: {lic.expiresAt ? fmtDate(lic.expiresAt) : 'Nunca'}</p>
              <p className="text-[11px] text-gray-600">último login: {fmtDate(lic.lastLoginAt)}</p>
              <p className="text-[11px] text-gray-600">
                uso — 👑 {lic.kingStarts ?? 0} · 🏆 {lic.zubStarts ?? 0} · 💀 {lic.elimStarts ?? 0}
                {lic.lastActiveAt ? <> · última actividad: {fmtDate(lic.lastActiveAt)}</> : null}
              </p>
              {lic.licenseType === 'trial' && (
                <p className="text-[11px] text-amber-500">
                  alias: {lic.trialAlias || '—'} · usuario de TikTok conectado: {lic.trialConnectedUsername || 'ninguno todavía'}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-1">
                {!lic.revoked && !lic.isAdmin && (
                  <button onClick={() => revoke(lic.id)} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline">
                    Revocar
                  </button>
                )}
                {!lic.revoked && (
                  <button onClick={() => toggleMultiDevice(lic)} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 underline">
                    {lic.multiDevice ? 'Quitar multi-dispositivo' : 'Hacer multi-dispositivo'}
                  </button>
                )}
                {!lic.isAdmin && (
                  <button onClick={() => {
                    setExtendingId(extendingId === lic.id ? null : lic.id);
                    setExtendType('week');
                    setExtendDiceTier(lic.diceTier || 'regular');
                  }} className="text-[10px] font-bold text-sky-400 hover:text-sky-300 underline">
                    Extender
                  </button>
                )}
                {deletable && !lic.isAdmin && (
                  <button onClick={() => deleteLicenseRow(lic)} className="text-[10px] font-bold text-gray-400 hover:text-red-400 underline">
                    Eliminar
                  </button>
                )}
              </div>

              {extendingId === lic.id && (
                <div className="theme-input flex items-center gap-2 p-2 mt-1">
                  <select
                    value={extendType} onChange={e => setExtendType(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-xs"
                  >
                    {Object.entries(CREATE_TYPES).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    value={extendDiceTier} onChange={e => setExtendDiceTier(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-xs"
                  >
                    {Object.entries(DICE_TIERS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button onClick={() => extendLicense(lic.id)} className="theme-btn-primary px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                    Confirmar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}
