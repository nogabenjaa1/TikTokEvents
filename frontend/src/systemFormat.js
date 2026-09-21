// Textos y formatos del panel de Sistema (admin): cómo se ven las acciones del historial, los errores, los tamaños
// de archivo y los pagos. Sin DOM ni red, para poder probarlo aparte de AdminSystem.jsx.

export const PLAN_NAMES = {
  day: '1 día', week: '1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime', trial: 'Prueba',
};

export const mxn = (cents) => `MX$ ${((Number(cents) || 0) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function formatUptime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return 'menos de 1 min';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function formatWhen(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Errores ───────────────────────────────────────────────────
export const SOURCE_LABELS = { frontend: 'Navegador', backend: 'Servidor', csp: 'Seguridad' };
export const sourceLabel = (source) => SOURCE_LABELS[source] || source;

const KIND_LABELS = {
  render: 'Fallo al dibujar', error: 'Error', promise: 'Promesa rechazada', csp: 'Política de seguridad',
  exception: 'Excepción', rejection: 'Promesa rechazada', http: 'Petición HTTP',
};
export const kindLabel = (kind) => KIND_LABELS[kind] || kind;

// ── Historial del admin ───────────────────────────────────────
const ACTION_LABELS = {
  'license.create': 'Creó una licencia',
  'license.regenerate_key': 'Regeneró la clave',
  'license.revoke': 'Revocó la licencia',
  'license.multi_device': 'Cambió multi-dispositivo',
  'license.win_bonus': 'Cambió el Win Bonus de Color Says',
  'license.spotify_addon': 'Cambió el complemento de Spotify',
  'license.edit': 'Editó la licencia',
  'license.extend': 'Extendió la licencia',
  'license.delete': 'Eliminó la licencia',
  'license.bulk_delete': 'Eliminó varias licencias',
  'pricing.set': 'Cambió un precio',
  'errors.clear': 'Limpió los errores',
  'storage.cleanup': 'Limpió archivos huérfanos',
  'payment.apply_failure': 'Aplicó un pago pendiente',
  'payment.apply_stripe': 'Aplicó un cobro de Stripe',
};
export const actionLabel = (action) => ACTION_LABELS[action] || String(action);

const plan = (type) => PLAN_NAMES[type] || type;

// Sobre qué se hizo una acción: una licencia (@usuario) o, en los cambios de precio, un plan.
export function describeTarget({ action, target, targetLicenseId }) {
  if (!target) return '';
  if (action === 'pricing.set') return plan(target);
  return targetLicenseId || String(action).startsWith('license.') ? `@${target}` : String(target);
}
const onOff = (value) => (value ? 'activado' : 'desactivado');
const provider = (name) => (name === 'stripe' ? 'Stripe' : 'MercadoPago');

const EDIT_LABELS = { licenseType: 'plan', diceTier: 'nivel de Color Says', multiDevice: 'multi-dispositivo', spotifyAddon: 'Spotify', winBonus: 'Win Bonus' };

// Resumen corto de los detalles de una acción (lo que la base guarda como texto JSON).
export function describeDetails(action, details) {
  if (!details || typeof details !== 'object') return '';
  switch (action) {
    case 'license.create':
      return `Plan ${plan(details.licenseType)}${details.spotifyAddon ? ' con Spotify' : ''}`;
    case 'license.extend':
      return `Plan ${plan(details.licenseType)}`;
    case 'license.edit':
      return Object.entries(details).map(([key, value]) => (
        typeof value === 'boolean' ? `${EDIT_LABELS[key] || key} ${onOff(value)}` : `${EDIT_LABELS[key] || key}: ${key === 'licenseType' ? plan(value) : value}`
      )).join(' · ');
    case 'license.multi_device':
    case 'license.win_bonus':
    case 'license.spotify_addon':
      return details.enabled ? 'Activado' : 'Desactivado';
    case 'license.bulk_delete':
      return `${details.deleted ?? 0} eliminadas, ${details.skipped ?? 0} omitidas`;
    case 'pricing.set':
      return `${mxn(details.oldAmountCents)} → ${mxn(details.newAmountCents)}`;
    case 'errors.clear':
      return `${details.removed ?? 0} errores borrados`;
    case 'storage.cleanup':
      return `${details.deleted ?? 0} borrados, ${details.failed ?? 0} con error, ${details.orphans ?? 0} huérfanos encontrados`;
    case 'payment.apply_failure':
      return `${provider(details.provider)} · ${details.paymentId ?? ''}`.trim();
    case 'payment.apply_stripe':
      return `${details.paymentIntentId ?? ''}${details.alreadyProcessed ? ' (ya estaba registrado)' : ''}`.trim();
    default:
      try { return JSON.stringify(details); } catch { return ''; }
  }
}

// ── Pagos ─────────────────────────────────────────────────────
const REASON_LABELS = {
  apply_failed: 'No se pudo guardar el cambio en la licencia',
  license_missing: 'La licencia no existía en ese momento',
};
export const reasonLabel = (reason) => REASON_LABELS[reason] || reason;

export const providerLabel = provider;

// Qué compró el pago, en una línea: "Anual + Spotify", "PRO", "Complemento de Spotify".
export function describePurchase({ planType, diceTier, spotifyAddon }) {
  const parts = [];
  if (planType) parts.push(plan(planType));
  if (diceTier && diceTier !== 'regular') parts.push(`Color Says ${String(diceTier).toUpperCase()}`);
  if (spotifyAddon) parts.push(parts.length ? 'Spotify' : 'Complemento de Spotify');
  return parts.length ? parts.join(' + ') : 'Sin detalle';
}
