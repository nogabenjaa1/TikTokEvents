// Cuántas alertas puede tener guardadas una licencia según su plan. Sin tope,
// alguien podría llenar con archivos el almacenamiento que comparten todos los
// streamers. Un solo lugar para cambiar los números.
//   Mensual: 50 · Anual: 150 · Lifetime (y la licencia admin): sin límite.
// Las licencias de prueba, de 1 día y de 1 semana no tienen una cifra propia:
// usan la del plan más chico (50).

const DEFAULT_LIMIT = 50;
const PLAN_LIMITS = { trial: 50, day: 50, week: 50, month: 50, annual: 150, lifetime: null };
const PLAN_LABELS = { trial: 'de prueba', day: 'de 1 día', week: 'de 1 semana', month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' };

// null = sin límite.
function alertLimitFor(license) {
    if (!license || license.is_admin) return null;
    return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, license.license_type) ? PLAN_LIMITS[license.license_type] : DEFAULT_LIMIT;
}

// Lo que el panel muestra: "12 de 50".
function quotaInfo(license, used) {
    const max = alertLimitFor(license);
    return { max, used, unlimited: max === null, plan: license?.license_type || null };
}

function limitMessage(license) {
    const max = alertLimitFor(license);
    const label = PLAN_LABELS[license?.license_type] || '';
    const name = label ? `Tu plan ${label}` : 'Tu plan';
    if (license?.license_type === 'annual') return `${name} permite hasta ${max} alertas. Borra alguna o pasa al plan Lifetime (ilimitadas).`;
    if (license?.license_type === 'month') return `${name} permite hasta ${max} alertas. Borra alguna o pasa al plan Anual (150) o Lifetime (ilimitadas).`;
    return `${name} permite hasta ${max} alertas. Borra alguna o elige un plan mayor.`;
}

// ¿Puede crear una alerta nueva teniendo `used`?
function canCreateAlert(license, used) {
    const max = alertLimitFor(license);
    return max === null || used < max;
}

module.exports = { alertLimitFor, quotaInfo, limitMessage, canCreateAlert, PLAN_LIMITS, DEFAULT_LIMIT };
