import React, { useState, useEffect, useCallback } from 'react';
import { backendUrl, authHeaders } from './auth';

const DURATION_LABELS = { day: '1 día', week: '1 semana', month: '1 mes', lifetime: 'Lifetime' };
const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

function statusOf(license) {
  if (license.revoked) return { label: 'Revocada', className: 'text-red-400 bg-red-950/40 border-red-800/50' };
  if (license.expiresAt !== null && license.expiresAt <= Date.now()) return { label: 'Expirada', className: 'text-gray-500 bg-[#130E24] border-[#2D1B4E]' };
  if (license.expiresAt !== null && license.expiresAt - Date.now() <= EXPIRING_SOON_MS) return { label: 'Por vencer', className: 'text-amber-400 bg-amber-950/40 border-amber-800/50' };
  return { label: 'Activa', className: 'text-green-400 bg-green-950/40 border-green-800/50' };
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
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
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // se muestra una sola vez
  const [copied, setCopied] = useState(false);

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
        body: JSON.stringify({ username: username.trim(), licenseType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo crear la licencia');
      setNewKey({ key: data.key, username: data.license.username });
      setUsername('');
      fetchLicenses();
    } catch (err) {
      setError(err.message);
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
      fetchLicenses();
    } catch (err) {
      setError(err.message);
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
      fetchLicenses();
    } catch (err) {
      setError(err.message);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🔑 Licencias</p>

      {/* Modal simple: key nueva, se muestra UNA sola vez */}
      {newKey && (
        <div className="w-full max-w-lg bg-yellow-950/30 border-2 border-yellow-600/50 rounded-2xl p-5">
          <p className="text-xs font-black uppercase tracking-widest text-yellow-400 mb-2">⚠️ Guardá esta key ahora — no se vuelve a mostrar</p>
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
            placeholder="username del TikToker"
            className="theme-input flex-1 p-3 outline-none text-sm placeholder-gray-600"
          />
          <select
            value={licenseType} onChange={e => setLicenseType(e.target.value)}
            className="theme-input p-3 outline-none text-sm"
          >
            {Object.entries(DURATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={creating || !username.trim()}
          className="theme-btn-primary py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed">
          {creating ? 'CREANDO...' : 'CREAR LICENCIA'}
        </button>
      </form>

      {error && <p className="text-red-400 text-xs font-bold">❌ {error}</p>}

      {/* Listado */}
      <div className="w-full max-w-lg flex flex-col gap-2">
        {loading ? (
          <p className="text-gray-600 text-sm italic text-center">Cargando licencias...</p>
        ) : licenses.length === 0 ? (
          <p className="text-gray-600 text-sm italic text-center">No hay licencias todavía.</p>
        ) : licenses.map(lic => {
          const status = statusOf(lic);
          return (
            <div key={lic.id} className="theme-surface p-4 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-100">
                  @{lic.username} {lic.isAdmin && <span className="text-yellow-400 text-[10px] ml-1">ADMIN</span>}
                  {lic.multiDevice && <span className="text-emerald-400 text-[10px] ml-1">🔓 MULTI-DISPOSITIVO</span>}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border ${status.className}`}>{status.label}</span>
              </div>
              <p className="text-[11px] text-gray-500">key: {lic.keyPrefix}••••••••• · tipo: {DURATION_LABELS[lic.licenseType] || lic.licenseType}</p>
              <p className="text-[11px] text-gray-500">creada: {fmtDate(lic.createdAt)} · expira: {lic.expiresAt ? fmtDate(lic.expiresAt) : 'Nunca'}</p>
              <p className="text-[11px] text-gray-600">último login: {fmtDate(lic.lastLoginAt)}</p>
              <p className="text-[11px] text-gray-600">
                uso — 👑 {lic.kingStarts ?? 0} · 🏆 {lic.zubStarts ?? 0} · 💀 {lic.elimStarts ?? 0}
                {lic.lastActiveAt ? <> · última actividad: {fmtDate(lic.lastActiveAt)}</> : null}
              </p>
              <div className="flex gap-3 mt-1">
                {!lic.revoked && !lic.isAdmin && (
                  <button onClick={() => revoke(lic.id)} className="self-start text-[10px] font-bold text-red-400 hover:text-red-300 underline">
                    Revocar
                  </button>
                )}
                {!lic.revoked && (
                  <button onClick={() => toggleMultiDevice(lic)} className="self-start text-[10px] font-bold text-emerald-400 hover:text-emerald-300 underline">
                    {lic.multiDevice ? 'Quitar multi-dispositivo' : 'Hacer multi-dispositivo'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
