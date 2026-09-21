// Cuánto de su cupo de alertas lleva una licencia. El servidor decide el tope según el plan (Mensual 50, Anual 150,
// Lifetime sin límite; ver backend/lib/alertQuota.js) y lo manda junto con la lista; aquí solo se convierte en lo
// que el panel muestra. `used` es lo que hay en la lista ahora, que es lo más al día que hay tras crear o borrar.

const WARN_FROM = 0.9; // desde el 90 % del cupo se avisa

// null si el servidor no mandó cupo (una respuesta vieja o un error): el panel entonces no muestra nada.
export function quotaSummary(quota, used, limitMessage = null) {
  if (!quota || typeof quota !== 'object') return null;
  if (quota.unlimited || !Number.isFinite(quota.max) || quota.max <= 0) {
    return { unlimited: true, used, max: null, label: 'Alertas ilimitadas en tu plan', percent: 0, level: 'ok', full: false, message: null };
  }
  const { max } = quota;
  const full = used >= max;
  return {
    unlimited: false,
    used,
    max,
    label: `${used} de ${max} alertas`,
    percent: Math.min(100, Math.round((used / max) * 100)),
    level: full ? 'full' : used >= Math.ceil(max * WARN_FROM) ? 'warn' : 'ok',
    full,
    message: full ? (limitMessage || `Llegaste al límite de ${max} alertas de tu plan. Borra alguna o elige un plan mayor.`) : null,
  };
}
