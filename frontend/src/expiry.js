// Reglas puras del aviso de vencimiento (sin React), para poder probarlas.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Con cuánta anticipación avisar según el plan: una licencia de un día no
// puede avisar con tres de margen (siempre estaría el aviso), y una anual
// necesita más tiempo para decidir que una semanal.
const WARN_BEFORE_DAYS = { day: 0.25, week: 2, trial: 3, month: 5, annual: 14 };
const DEFAULT_WARN_DAYS = 3;

// null si no hay nada que avisar: sin sesión, admin, licencia que no vence
// (lifetime) o que todavía tiene margen. Si no, { level, trial, message }:
// `urgent` cuando queda un día o menos (o ya venció), `soon` antes de eso.
export function expiryNotice(session, now = Date.now()) {
  if (!session || session.isAdmin || !session.expiresAt) return null;
  const msLeft = session.expiresAt - now;
  const warnMs = (WARN_BEFORE_DAYS[session.licenseType] ?? DEFAULT_WARN_DAYS) * DAY_MS;
  if (msLeft > warnMs) return null;

  const trial = session.licenseType === 'trial';
  const subject = trial ? 'Tu prueba gratis' : 'Tu licencia';
  let when;
  if (msLeft <= 0) when = 'ya venció';
  else if (msLeft < DAY_MS) {
    const hours = Math.max(1, Math.ceil(msLeft / HOUR_MS));
    when = `vence en ${hours} hora${hours === 1 ? '' : 's'}`;
  } else {
    const days = Math.ceil(msLeft / DAY_MS);
    when = `vence en ${days} día${days === 1 ? '' : 's'}`;
  }
  return {
    level: msLeft <= DAY_MS ? 'urgent' : 'soon',
    trial,
    message: `${subject} ${when}.`,
    detail: trial
      ? 'Elige un plan para conservar tus configuraciones y seguir en vivo sin interrupciones.'
      : 'Renueva ahora: los días que te sobren se suman al nuevo periodo, no se pierden.',
  };
}

// El aviso se puede cerrar y vuelve a aparecer al día siguiente (o si cambia
// la fecha de vencimiento, por ejemplo tras renovar y volver a estar cerca).
export function dismissalKey(session, now = new Date()) {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `${day}|${session?.expiresAt ?? ''}`;
}
