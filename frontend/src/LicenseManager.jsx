import { SkeletonRows } from './PanelHelp';
import MorphButton from './MorphButton';
import { MORPH_MIN_LOADING_MS, MORPH_SUCCESS_HOLD_MS, wait } from './motion';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';
import AdminStats from './AdminStats';

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

// Precios editables (pedido explicito: "Modificacion manual de precios de
// licencias desde el panel de administracion") -- los 3 planes de venta
// autoservicio (Mensual/Anual/Lifetime, ver backend/pricing.js
// PLAN_PRICES_CENTS) y el complemento de Spotify (pago unico, tambien en
// pricing.js: no es un plan, por eso /api/pricing lo manda aparte y aca se
// junta con los planes para editarlo en la misma lista); los addons de Color
// Says quedan afuera del pedido.
const PRICING_PLAN_LABELS = { month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', spotify_addon: 'Complemento Spotify' };
const MIN_PRICE_MXN = 1; // piso pedido explicitamente: 1 peso

const STATUS_FILTERS = [
  { id: 'all',      label: 'Todas' },
  { id: 'active',   label: 'Activas' },
  { id: 'expiring', label: 'Por vencer' },
  { id: 'expired',  label: 'Expiradas' },
  { id: 'revoked',  label: 'Revocadas' },
  { id: 'trial',    label: 'Prueba' },
];

function statusOf(license) {
  if (license.revoked) return { id: 'revoked', label: 'Revocada', className: 'text-red-400 bg-red-500/15 border-red-500/50' };
  if (license.expiresAt !== null && license.expiresAt <= Date.now()) return { id: 'expired', label: 'Expirada', className: 'text-gray-500 bg-[var(--surface-bg-alt)] border-[var(--surface-border-color)]' };
  if (license.expiresAt !== null && license.expiresAt - Date.now() <= EXPIRING_SOON_MS) return { id: 'expiring', label: 'Por vencer', className: 'text-amber-400 bg-amber-500/15 border-amber-500/50' };
  return { id: 'active', label: 'Activa', className: 'text-green-400 bg-green-500/15 border-green-500/50' };
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}

// Toasts con los tokens de tema (theme-surface + color de texto fijo según
// el tipo) — mismo criterio que los badges de estado: el color es fijo
// (verde éxito / rojo error), no sigue el acento, pero el fondo sí respeta
// el material activo en vez de quedar un cuadro oscuro fijo. Un ícono
// (en vez del borde lateral grueso de antes) distingue éxito/error de forma
// más sutil.
function ToastStack({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-72">
      {toasts.map(t => (
        <div key={t.id} className={[
          'theme-surface px-4 py-3 text-xs font-bold shadow-lg flex items-center gap-2',
          t.type === 'error' ? 'text-red-700' : 'text-emerald-700',
          t.leaving ? 'tkc-leaving' : '',
        ].join(' ')}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// Fila de interruptor con título y ayuda, para el formulario de edición.
function EditSwitch({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-xs font-bold text-gray-200">{label}</span>
        {hint && <span className="block text-[10px] text-gray-500 leading-snug">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <span aria-hidden="true" className="tkc-switch flex-shrink-0" />
    </label>
  );
}

// Panel de administración de licencias — solo visible si la sesión actual
// tiene isAdmin (hoy, la única es notbenjaa1). No confundir con
// AdminPanel.jsx, que es el panel de juego de Rey del Trono.
//
// Bug real corregido: el mensaje "Tu sesión ya no es válida" podía aparecer
// acá mientras el resto del sitio (el socket, ya conectado y autenticado de
// antes) seguía andando normal — no porque la sesión NO se hubiera
// invalidado de verdad, sino porque cada acción de este panel es un fetch
// HTTP nuevo que revalida el token contra la DB en cada llamada (ver
// requireAuth en backend/auth.js), mientras que un socket YA conectado
// nunca se re-valida a sí mismo entre eventos — así que un cambio de
// session_id que ocurre DESPUÉS de conectar el socket (otro login con la
// misma licencia, incluso en otra pestaña/dispositivo) recién se nota acá,
// en el próximo fetch, no en el socket. Dos cambios:
//  1. `onSessionInvalid` (ver App.jsx) engancha esto al MISMO flujo limpio
//     de "te desconectaron" que ya usa el socket (`session_replaced`) —
//     antes esto solo dejaba un cartel de error suelto en este panel, con
//     el resto de la app fingiendo que todo seguía bien.
//  2. La carga inicial reintenta UNA vez ante un 401 antes de asumir que la
//     sesión de verdad se invalidó — cubre el caso de un cambio de
//     session_id que todavía no terminó de propagarse (p. ej. justo después
//     de loguearse desde otro lado) en vez de mostrar el cartel por un hipo
//     de un instante.
export default function LicenseManager({ onSessionInvalid }) {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [licenseType, setLicenseType] = useState('week');
  const [diceTier, setDiceTier] = useState('regular');
  // Complemento de Spotify de regalo al crear la licencia (ver backend/spotify.js:
  // un Mensual solo tiene Spotify con el complemento).
  const [spotifyAddon, setSpotifyAddon] = useState(false);
  // idle | loading | success | error: lo cuenta el botón con su forma (ver MorphButton).
  const [createStatus, setCreateStatus] = useState('idle');
  const creating = createStatus === 'loading' || createStatus === 'success';
  const [newKey, setNewKey] = useState(null); // se muestra una sola vez: { key, username, regenerated? }
  // El panel de la clave nueva vive arriba de todo y la lista de licencias
  // queda muy abajo: al regenerar una clave hay que llevarlo a la vista.
  const newKeyPanelRef = useRef(null);
  useEffect(() => {
    if (newKey) newKeyPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [newKey]);
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // Edición de una licencia: un solo formulario con todas sus opciones (ver
  // openEditor / saveEdit). `renew` vacío = no cambiar plan ni vencimiento.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editStatus, setEditStatus] = useState('idle');
  const savingEdit = editStatus === 'loading' || editStatus === 'success';
  // La licencia recién editada destella un momento en la lista, para que se
  // vea dónde quedó el cambio; las que se eliminan se desvanecen antes de irse.
  const [flashId, setFlashId] = useState(null);
  const [leavingIds, setLeavingIds] = useState(() => new Set());

  // Selección para eliminar en bloque (pedido explícito: evitar revocar +
  // eliminar licencia por licencia una por una). Un Set de ids, filtrado
  // por lo que el filtro/búsqueda actual muestra -- ver filteredLicenses.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Precios de licencias -- separado del CRUD de licencias de arriba a
  // proposito: son dos conceptos distintos (una licencia puntual vs. lo que
  // cuesta cada plan para TODOS), aunque compartan el mismo panel de admin.
  const [prices, setPrices] = useState(null); // { month, annual, lifetime } en centavos
  const [priceInputs, setPriceInputs] = useState({});
  const [priceStatus, setPriceStatus] = useState({ plan: null, status: 'idle' });
  const [priceHistory, setPriceHistory] = useState(null); // null = nunca se pidio
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    // Se desvanece antes de irse, en vez de desaparecer de golpe.
    setTimeout(() => setToasts(t => t.map(x => (x.id === id ? { ...x, leaving: true } : x))), 3200);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Único punto que decide qué hacer con un 401: reintentar (posible hipo
  // transitorio) o reportar "sesión inválida de verdad" hacia arriba — lo
  // usan tanto la carga inicial como cada acción de mutación de más abajo.
  const handleUnauthorized = useCallback(async (res) => {
    const data = await res.json().catch(() => ({}));
    onSessionInvalid?.(data.error || 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
  }, [onSessionInvalid]);

  // `quiet`: refresco después de una acción. La lista se actualiza en su
  // lugar; el marcador de carga es solo para la primera vez (antes la lista
  // entera desaparecía y volvía a aparecer con cada cambio).
  const fetchLicenses = useCallback(async ({ isRetry = false, quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/licenses`, { headers: authHeaders() });
      if (res.status === 401) {
        if (!isRetry) {
          // Ver el comentario grande del componente: puede ser un cambio de
          // session_id que todavía no terminó de propagarse — se reintenta
          // una vez antes de asumir que de verdad hay que volver a loguearse.
          await new Promise(r => setTimeout(r, 800));
          return fetchLicenses({ isRetry: true, quiet });
        }
        await handleUnauthorized(res);
        return;
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudieron cargar las licencias');
      setLicenses(data.licenses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized]);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

  // Endpoint público (el mismo que usa la vitrina de Membership.jsx): no
  // necesita authHeaders.
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/pricing`);
      const data = await res.json();
      if (data.success) {
        // El complemento de Spotify viaja aparte de los planes (ver
        // PRICING_PLAN_LABELS): se junta aquí para editarlo con los demás.
        const all = data.spotifyAddon != null ? { ...data.prices, spotify_addon: data.spotifyAddon } : data.prices;
        setPrices(all);
        setPriceInputs(Object.fromEntries(Object.entries(all).map(([k, cents]) => [k, (cents / 100).toString()])));
      }
    } catch { /* el panel sigue funcionando sin precios cargados */ }
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  const savePrice = async (planType) => {
    const pesos = parseFloat(priceInputs[planType]);
    if (!Number.isFinite(pesos) || pesos < MIN_PRICE_MXN) {
      pushToast(`El precio mínimo es de ${MIN_PRICE_MXN.toFixed(2)} MXN`, 'error');
      return;
    }
    const amountCents = Math.round(pesos * 100);
    setPriceStatus({ plan: planType, status: 'loading' });
    const minLoading = wait(MORPH_MIN_LOADING_MS);
    try {
      const res = await fetch(`${backendUrl()}/api/admin/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planType, amountCents }),
      });
      if (res.status === 401) { setPriceStatus({ plan: null, status: 'idle' }); await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar el precio');
      await minLoading;
      setPriceStatus({ plan: planType, status: 'success' });
      pushToast(`Precio de ${PRICING_PLAN_LABELS[planType]} actualizado`);
      await wait(MORPH_SUCCESS_HOLD_MS);
      await fetchPrices();
      if (historyOpen) fetchHistory();
      setPriceStatus({ plan: null, status: 'idle' });
    } catch (err) {
      await minLoading;
      pushToast(err.message, 'error');
      setPriceStatus({ plan: planType, status: 'error' });
    }
  };

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${backendUrl()}/api/admin/pricing/history`, { headers: authHeaders() });
      if (res.status === 401) { await handleUnauthorized(res); return; }
      const data = await res.json();
      if (data.success) setPriceHistory(data.history);
    } catch { /* el historial es informativo, no bloquea nada si falla */ }
    finally { setHistoryLoading(false); }
  }, [handleUnauthorized]);

  const toggleHistory = () => {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && priceHistory === null) fetchHistory();
  };

  const createLicense = async (e) => {
    e.preventDefault();
    if (!username.trim() || creating) return;
    setCreateStatus('loading');
    setError('');
    const minLoading = wait(MORPH_MIN_LOADING_MS);
    try {
      const res = await fetch(`${backendUrl()}/api/licenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: username.trim(), licenseType, diceTier, spotifyAddon: spotifyAddon ? true : undefined }),
      });
      if (res.status === 401) { setCreateStatus('idle'); await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo crear la licencia');
      await minLoading;
      setCreateStatus('success');
      await wait(MORPH_SUCCESS_HOLD_MS);
      setNewKey({ key: data.key, username: data.license.username });
      setUsername('');
      setSpotifyAddon(false);
      fetchLicenses({ quiet: true });
      setCreateStatus('idle');
    } catch (err) {
      await minLoading;
      pushToast(err.message, 'error');
      setCreateStatus('error');
    }
  };

  const revoke = async (id) => {
    if (!window.confirm('¿Revocar esta licencia? El usuario perderá el acceso de inmediato.')) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${id}/revoke`, { method: 'POST', headers: authHeaders() });
      if (res.status === 401) { await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo revocar');
      pushToast('Licencia revocada');
      setFlashId(id);
      fetchLicenses({ quiet: true });
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  // Borrado real de la fila (a diferencia de revocar). Pedido explícito:
  // un solo paso -- si la licencia todavía está activa, el backend ahora
  // la revoca automáticamente antes de borrarla (ya no hace falta
  // revocarla a mano primero).
  const deleteLicenseRow = async (lic) => {
    if (!window.confirm(`¿Eliminar para siempre la licencia de @${lic.username}? Esto no se puede deshacer.${lic.revoked ? '' : ' Se revoca automáticamente antes de borrarla.'}`)) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${lic.id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.status === 401) { await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo eliminar');
      await removeRows([lic.id]);
      pushToast('Licencia eliminada');
      setSelectedIds(prev => { if (!prev.has(lic.id)) return prev; const next = new Set(prev); next.delete(lic.id); return next; });
      fetchLicenses({ quiet: true });
    } catch (err) {
      pushToast(err.message, 'error');
    }
  };

  // Las filas borradas se desvanecen (.tkc-leaving) y recién después salen de
  // la lista, en vez de desaparecer de golpe.
  const removeRows = async (ids) => {
    setLeavingIds(new Set(ids));
    await wait(280);
    setLicenses(prev => prev.filter(l => !ids.includes(l.id)));
    setLeavingIds(new Set());
  };

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Eliminación en bloque -- misma idea que deleteLicenseRow (revoca
  // automático si hace falta), pero en un solo request para toda la
  // selección en vez de N llamadas.
  const bulkDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`¿Eliminar para siempre ${ids.length} licencia(s)? Esto no se puede deshacer. Las que sigan activas se revocan automáticamente antes de borrarlas.`)) return;
    setBulkDeleting(true);
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids }),
      });
      if (res.status === 401) { await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo eliminar el lote');
      pushToast(
        data.skipped > 0
          ? `${data.deleted} licencia(s) eliminada(s), ${data.skipped} omitida(s)`
          : `${data.deleted} licencia(s) eliminada(s)`
      );
      await removeRows(ids);
      setSelectedIds(new Set());
      fetchLicenses({ quiet: true });
    } catch (err) {
      pushToast(err.message, 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const openEditor = (lic) => {
    setEditStatus('idle');
    if (editingId === lic.id) { setEditingId(null); return; }
    setEditingId(lic.id);
    setEditForm({
      multiDevice: !!lic.multiDevice,
      spotifyAddon: !!lic.spotifyAddon,
      winBonus: !!lic.diceWinBonusUnlocked,
      diceTier: lic.diceTier || 'regular',
      renew: '',
    });
  };

  // Un solo request con lo que cambió (ver POST /api/licenses/:id/edit).
  const saveEdit = async (lic) => {
    const body = {};
    if (editForm.renew) body.licenseType = editForm.renew;
    if (editForm.diceTier !== (lic.diceTier || 'regular')) body.diceTier = editForm.diceTier;
    if (editForm.multiDevice !== !!lic.multiDevice) body.multiDevice = editForm.multiDevice;
    if (editForm.spotifyAddon !== !!lic.spotifyAddon) body.spotifyAddon = editForm.spotifyAddon;
    if (editForm.winBonus !== !!lic.diceWinBonusUnlocked) body.winBonus = editForm.winBonus;
    if (Object.keys(body).length === 0) { setEditingId(null); return; }
    if (body.multiDevice && !window.confirm(`¿Convertir la licencia de @${lic.username} en "todopoderosa"? Va a poder usarse en cualquier cantidad de dispositivos a la vez, sin restricciones.`)) return;
    setEditStatus('loading');
    const minLoading = wait(MORPH_MIN_LOADING_MS);
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${lic.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { setEditStatus('idle'); await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar');
      await minLoading;
      setEditStatus('success');
      pushToast(`Licencia de @${lic.username} actualizada`);
      await Promise.all([fetchLicenses({ quiet: true }), wait(MORPH_SUCCESS_HOLD_MS)]);
      setEditingId(null);
      setEditStatus('idle');
      setFlashId(lic.id);
    } catch (err) {
      await minLoading;
      pushToast(err.message, 'error');
      setEditStatus('error');
    }
  };

  // Regenera la clave con el formato alias-etiqueta-hash (ver el endpoint en
  // backend/server.js): la forma de arreglar las licencias que se emitieron
  // con el hash suelto de antes. La clave vieja deja de servir para cualquier
  // conexión nueva, también las URLs de overlay de OBS (llevan la key cruda),
  // por eso se pide confirmación.
  const regenerateKey = async (lic) => {
    if (!window.confirm(`¿Regenerar la clave de @${lic.username}? La clave actual deja de servir: tendrá que entrar con la nueva y volver a pegar la URL de sus overlays en OBS.`)) return;
    try {
      const res = await fetch(`${backendUrl()}/api/licenses/${lic.id}/regenerate-key`, { method: 'POST', headers: authHeaders() });
      if (res.status === 401) { await handleUnauthorized(res); return; }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo regenerar la clave');
      setNewKey({ key: data.key, username: data.license.username, regenerated: true });
      setFlashId(lic.id);
      fetchLicenses({ quiet: true });
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

  // Nunca se puede eliminar una licencia admin -- ver el mismo criterio en
  // el backend (/api/licenses/:id, /api/licenses/bulk-delete).
  const selectableLicenses = useMemo(() => filteredLicenses.filter(l => !l.isAdmin), [filteredLicenses]);

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">Licencias</p>

      {/* Modal simple: key nueva, se muestra UNA sola vez */}
      {newKey && (
        <div ref={newKeyPanelRef} className="w-full max-w-lg theme-notice theme-notice-warning theme-notice-roomy tkc-rise">
          <p className="text-xs font-black uppercase tracking-widest mb-2">Guarda esta clave ahora — no se vuelve a mostrar</p>
          <p className="text-sm text-gray-300 mb-2">
            {newKey.regenerated ? 'Clave nueva' : 'Licencia'} para <strong className="text-white">@{newKey.username}</strong>:
          </p>
          {newKey.regenerated && (
            <p className="text-[11px] text-gray-400 mb-2">La clave anterior ya no sirve: hay que entregarle esta y volver a pegar la URL de sus overlays en OBS.</p>
          )}
          <div className="flex items-center gap-2">
            <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all select-all">{newKey.key}</code>
            <button onClick={copyKey} className="theme-btn-primary theme-btn-md font-bold whitespace-nowrap">
              <span key={copied ? 'copied' : 'copy'} className="tkc-pop">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="theme-link mt-1">Cerrar</button>
        </div>
      )}

      {/* Resumen del negocio: ingresos, licencias por plan, por vencer, conversión */}
      <AdminStats onUnauthorized={handleUnauthorized} />

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
        {/* Complemento de Spotify de regalo (o cobrado por fuera): la licencia
            nace con acceso a Spotify aunque sea Mensual. Anual y Lifetime ya
            lo incluyen, así que ahí no cambia nada. */}
        <EditSwitch label="Complemento de Spotify" hint="Pago único. Sirve sobre todo para el plan Mensual: Anual y Lifetime ya lo incluyen."
          checked={spotifyAddon} onChange={setSpotifyAddon} />
        <MorphButton type="submit" status={createStatus} loadingLabel="Creando la licencia…" disabled={!creating && !username.trim()}
          className="theme-btn-primary theme-btn-md font-black tracking-widest uppercase disabled:opacity-40 disabled:cursor-not-allowed">
          Crear licencia
        </MorphButton>
      </form>

      {/* Precios de licencias -- pedido explicito: "Modificacion manual de
          precios de licencias desde el panel de administracion". Mismo
          patron visual que el formulario de "Crear licencia" de arriba. */}
      <div className="theme-surface w-full max-w-lg p-5 flex flex-col gap-3">
        <p className="theme-label text-xs uppercase tracking-widest font-semibold">Precios de licencias</p>
        {prices === null ? (
          <SkeletonRows count={3} label="Cargando precios…" />
        ) : (
          <div className="flex flex-col gap-2">
            {/* En pantallas angostas la etiqueta (la más larga es "Complemento
                Spotify") ocupa su propia línea y el campo se puede encoger
                (min-w-0): con el ancho fijo de antes el botón Guardar se salía
                de la pantalla. */}
            {Object.keys(PRICING_PLAN_LABELS).map((planType) => (
              <div key={planType} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-gray-300 w-full sm:w-36 shrink-0">{PRICING_PLAN_LABELS[planType]}</span>
                <span className="text-[11px] text-gray-500 shrink-0">MX$</span>
                <input
                  type="number" min={MIN_PRICE_MXN} step="0.01"
                  value={priceInputs[planType] ?? ''}
                  onChange={e => setPriceInputs(p => ({ ...p, [planType]: e.target.value }))}
                  className="theme-input flex-1 min-w-0 p-2 outline-none text-sm"
                />
                <div className="w-24 flex-shrink-0">
                  <MorphButton
                    type="button"
                    onClick={() => { if (priceStatus.status !== 'loading' && priceStatus.status !== 'success') savePrice(planType); }}
                    status={priceStatus.plan === planType ? priceStatus.status : 'idle'}
                    loadingLabel="Guardando el precio…"
                    disabled={priceStatus.plan !== planType && priceInputs[planType] === (prices[planType] / 100).toString()}
                    className="theme-btn-primary theme-btn-sm font-black uppercase tracking-widest whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Guardar
                  </MorphButton>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-gray-500 mt-1">Precio mínimo por plan: MX${MIN_PRICE_MXN.toFixed(2)}. El cambio se refleja de inmediato en la compra de los streamers.</p>
            <button onClick={toggleHistory} className="theme-link theme-link-info self-start">
              {historyOpen ? 'Ocultar historial de cambios' : 'Ver historial de cambios'}
            </button>
            {historyOpen && (
              <div className="theme-input p-2 mt-1 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {historyLoading ? (
                  <SkeletonRows count={2} height="h-6" label="Cargando historial…" />
                ) : !priceHistory || priceHistory.length === 0 ? (
                  <p className="text-[10px] text-gray-500 italic">Todavía no hay cambios registrados.</p>
                ) : priceHistory.map(h => (
                  <p key={h.id} className="text-[10px] text-gray-400">
                    {fmtDate(h.changedAt)} · {PRICING_PLAN_LABELS[h.planType] || h.planType} · @{h.changedBy} ·{' '}
                    {h.oldAmountCents != null && <>MX${(h.oldAmountCents / 100).toLocaleString('es-MX')} → </>}
                    MX${(h.newAmountCents / 100).toLocaleString('es-MX')}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="theme-notice">{error}</p>}

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
        {/* Eliminar en bloque -- pedido explícito: evitar revocar +
            eliminar licencia por licencia una por una. */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest cursor-pointer">
            <input
              type="checkbox"
              checked={selectableLicenses.length > 0 && selectableLicenses.every(l => selectedIds.has(l.id))}
              onChange={e => setSelectedIds(e.target.checked ? new Set(selectableLicenses.map(l => l.id)) : new Set())}
              disabled={selectableLicenses.length === 0}
            />
            Seleccionar todas (visibles)
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={bulkDeleteSelected}
              disabled={bulkDeleting}
              className="theme-link theme-link-danger disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {bulkDeleting ? 'Eliminando...' : `Eliminar seleccionadas (${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>

      {/* Listado */}
      <div className="w-full max-w-lg flex flex-col gap-2">
        {loading ? (
          <SkeletonRows count={4} label="Cargando licencias..." />
        ) : filteredLicenses.length === 0 ? (
          <p className="text-gray-600 text-sm italic text-center">
            {licenses.length === 0 ? 'No hay licencias todavía.' : 'Ninguna licencia coincide con el filtro.'}
          </p>
        ) : filteredLicenses.map(lic => {
          const status = statusOf(lic);
          return (
            <div key={lic.id} className={['theme-surface p-4 flex flex-col gap-1', leavingIds.has(lic.id) ? 'tkc-leaving' : '', flashId === lic.id ? 'tkc-flash' : ''].join(' ')}
              onAnimationEnd={(e) => { if (e.animationName === 'tkc-flash') setFlashId(null); }}>
              {/* Con las insignias de Spotify el nombre puede llevar bastante texto:
                  el grupo baja de línea (flex-wrap + min-w-0) en vez de empujar
                  la etiqueta de estado fuera de la tarjeta. */}
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-gray-100 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  {!lic.isAdmin && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lic.id)}
                      onChange={() => toggleSelected(lic.id)}
                      aria-label={`Seleccionar la licencia de @${lic.username}`}
                      className="shrink-0 w-4 h-4"
                    />
                  )}
                  @{lic.username} {lic.isAdmin && <span className="text-yellow-400 text-[10px] ml-1">ADMIN</span>}
                  {lic.multiDevice && <span className="text-emerald-400 text-[10px] ml-1">MULTI-DISPOSITIVO</span>}
                  {lic.diceWinBonusUnlocked && <span className="text-pink-400 text-[10px] ml-1">WIN BONUS</span>}
                  {/* Quién tiene hoy cupo en la app de Spotify de la
                      plataforma: es a quien hay que cargar en User
                      Management del dashboard de Spotify (ver
                      backend/spotify.js). El resto conecta con su propia app. */}
                  {lic.spotifySharedSlot && <span className="text-green-400 text-[10px] ml-1">CUPO SPOTIFY</span>}
                  {lic.spotifyAddon && <span className="text-green-400 text-[10px] ml-1">COMPLEMENTO</span>}
                  {/* A qué cuenta de Spotify está vinculada. El tope de Spotify
                      cuenta cuentas DISTINTAS: dos licencias con la misma cuenta
                      valen un solo lugar, y aquí se ve quién la comparte. */}
                  {lic.spotifyAccount && (
                    <span className="text-green-400 text-[10px] ml-1">
                      {lic.spotifyAccount.displayName || 'cuenta vinculada'}{lic.spotifyAccount.ownApp ? ' (app propia)' : ''}
                      {lic.spotifyAccount.sharedWith?.length > 0 && ` · misma cuenta que ${lic.spotifyAccount.sharedWith.map(name => `@${name}`).join(', ')}`}
                    </span>
                  )}
                </span>
                <span key={status.id} className={`tkc-pop text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border shrink-0 ${status.className}`}>{status.label}</span>
              </div>
              <p className="text-[11px] text-gray-500">clave: {lic.keyPrefix}••••••••• · tipo: {DURATION_LABELS[lic.licenseType] || lic.licenseType} · nivel Color Says: {DICE_TIERS[lic.diceTier] || lic.diceTier}</p>
              <p className="text-[11px] text-gray-500">creada: {fmtDate(lic.createdAt)} · expira: {lic.expiresAt ? fmtDate(lic.expiresAt) : 'Nunca'}</p>
              <p className="text-[11px] text-gray-600">último login: {fmtDate(lic.lastLoginAt)}</p>
              <p className="text-[11px] text-gray-600">
                uso — Rey {lic.kingStarts ?? 0} · Zubastinis {lic.zubStarts ?? 0} · Eliminación {lic.elimStarts ?? 0}
                {lic.lastActiveAt ? <> · última actividad: {fmtDate(lic.lastActiveAt)}</> : null}
              </p>
              {lic.licenseType === 'trial' && (
                <p className="text-[11px] text-amber-500">
                  alias: {lic.trialAlias || '—'} · usuario de TikTok conectado: {lic.trialConnectedUsername || 'ninguno todavía'}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-1">
                <button type="button" onClick={() => openEditor(lic)} aria-expanded={editingId === lic.id}
                  className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest">
                  {editingId === lic.id ? 'Cerrar' : 'Editar'}
                </button>
              </div>

              {editingId === lic.id && editForm && (
                <div className="theme-input p-4 mt-2 flex flex-col gap-4 tkc-msg-enter" role="group" aria-label={`Editar la licencia de @${lic.username}`}>
                  <div className="flex flex-col gap-3">
                    <EditSwitch label="Multi-dispositivo" hint="Se puede usar en cualquier cantidad de dispositivos a la vez."
                      checked={editForm.multiDevice} onChange={v => setEditForm(f => ({ ...f, multiDevice: v }))} />
                    <EditSwitch label="Complemento de Spotify" hint={lic.licenseType === 'month' || lic.licenseType === 'day' || lic.licenseType === 'week' || lic.licenseType === 'trial' ? 'Da acceso a Spotify a esta licencia sin que lo compre.' : 'Anual y Lifetime ya incluyen Spotify; se conserva si cambia de plan.'}
                      checked={editForm.spotifyAddon} onChange={v => setEditForm(f => ({ ...f, spotifyAddon: v }))} />
                    <EditSwitch label="Win Bonus (Color Says)" hint="Excepción manual del bono de victoria."
                      checked={editForm.winBonus} onChange={v => setEditForm(f => ({ ...f, winBonus: v }))} />
                  </div>

                  {!lic.isAdmin && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="theme-label text-[10px] uppercase tracking-widest font-semibold">Nivel Color Says</span>
                        <select value={editForm.diceTier} onChange={e => setEditForm(f => ({ ...f, diceTier: e.target.value }))}
                          className="theme-input p-2.5 outline-none text-xs">
                          {Object.entries(DICE_TIERS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="theme-label text-[10px] uppercase tracking-widest font-semibold">Membresía</span>
                        <select value={editForm.renew} onChange={e => setEditForm(f => ({ ...f, renew: e.target.value }))}
                          className="theme-input p-2.5 outline-none text-xs">
                          <option value="">Sin cambios ({lic.expiresAt ? `vence ${fmtDate(lic.expiresAt)}` : 'no vence'})</option>
                          {Object.entries(CREATE_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>Renovar: {label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-40 flex-shrink-0">
                      <MorphButton type="button" onClick={() => { if (!savingEdit) saveEdit(lic); }} status={editStatus} loadingLabel="Guardando los cambios…"
                        className="theme-btn-primary theme-btn-sm font-black uppercase tracking-widest">
                        Guardar cambios
                      </MorphButton>
                    </div>
                    <button type="button" onClick={() => setEditingId(null)} disabled={savingEdit}
                      className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest">
                      Cancelar
                    </button>
                    {!lic.isAdmin && (
                      <button type="button" onClick={() => deleteLicenseRow(lic)} disabled={savingEdit}
                        className="ml-auto theme-btn-danger theme-btn-sm font-black uppercase tracking-widest">
                        Eliminar
                      </button>
                    )}
                  </div>

                  {!lic.isAdmin && (
                    <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-[var(--surface-border-color)]">
                      {!lic.revoked && (
                        <button type="button" onClick={() => revoke(lic.id)} className="theme-link theme-link-danger">
                          Revocar acceso
                        </button>
                      )}
                      {!lic.revoked && (
                        <button type="button" onClick={() => regenerateKey(lic)} className="theme-link theme-link-warning">
                          Regenerar clave
                        </button>
                      )}
                      <span className="text-[10px] text-gray-500">Eliminar revoca la licencia automáticamente antes de borrarla.</span>
                    </div>
                  )}
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
