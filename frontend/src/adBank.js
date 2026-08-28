// Banco de horas sin anuncios para invitados (sin sesión) en Color Says.
// Vive en localStorage porque un invitado no tiene cuenta del lado del
// servidor con la que atarlo — se acepta que borrar los datos del
// navegador (o modo incógnito) resetea el banco: costo proporcional a un
// beneficio de un minijuego gratuito, no de una licencia paga.
import { GUEST_BANK_HOUR_MS, GUEST_BANK_CAP_MS } from './adConfig';

const BANK_KEY = 'tkc_colorsays_ad_bank';

function readBankedUntil() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Number(parsed.bankedUntil) || 0;
  } catch {
    return 0;
  }
}

function writeBankedUntil(bankedUntil) {
  localStorage.setItem(BANK_KEY, JSON.stringify({ bankedUntil }));
}

// Milisegundos de uso sin ads que quedan, o 0 si no hay banco activo.
export function getBankedRemainingMs() {
  return Math.max(0, readBankedUntil() - Date.now());
}

// Suma una hora al banco (tras completar el anuncio recompensado), sin
// pasar nunca el tope de 48hs acumuladas desde este momento.
export function addBankedHour() {
  const now = Date.now();
  const base = Math.max(now, readBankedUntil());
  const capped = Math.min(base + GUEST_BANK_HOUR_MS, now + GUEST_BANK_CAP_MS);
  writeBankedUntil(capped);
  return capped;
}

export function isBankFull() {
  return getBankedRemainingMs() >= GUEST_BANK_CAP_MS;
}

// "2h 15min" / "40min" — para mostrar el tiempo restante del banco en la UI.
export function formatBankedDuration(ms) {
  const totalMinutes = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
