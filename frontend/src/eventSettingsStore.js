// Ajustes guardados de cada evento (Rey del Trono, Zubastinis, Eliminación,
// Ruleta, Extensible, Objetivo), sin React: lo que el streamer dejó configurado
// aunque no lo haya iniciado. La fuente de verdad es el servidor
// (backend/lib/eventSettings.js); este navegador guarda una copia para pintar
// al instante y para no perder nada sin conexión. App.jsx los sincroniza con
// settingsSync.js, igual que el tema y la personalización de overlays.
//
// Antes cada panel guardaba lo suyo en el navegador con su propia clave (y tres
// formas distintas de hacerlo): desde otro navegador había que configurar todo
// de nuevo. Esas claves se leen una vez para no perder lo que ya había.
// Con extensión: este módulo se prueba con `node --test` tal cual.
import { readStorage, writeStorage } from './safeStorage.js';

export const EVENT_SETTINGS_IDS = ['king', 'zub', 'elim', 'roulette', 'extensible', 'goal'];
const STORAGE_KEY = 'tkc_event_settings';
// Claves de antes, por evento (solo se leen).
const LEGACY_KEYS = {
  king: 'tkc_king_draft',
  zub: 'tkc_zub_draft',
  elim: 'tkc_elim_draft',
  roulette: 'tkc_roulette_draft',
  extensible: 'tiktok-concurso-extensible-settings',
  goal: 'tiktok-concurso-goal-settings',
};

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function parse(raw) {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return isPlainObject(v) ? v : null; } catch { return null; }
}

export function loadLocalEventSettings(read = readStorage) {
  const saved = parse(read(STORAGE_KEY)) || {};
  const out = {};
  for (const id of EVENT_SETTINGS_IDS) {
    const entry = isPlainObject(saved[id]) ? saved[id] : parse(read(LEGACY_KEYS[id]));
    if (entry) out[id] = entry;
  }
  return out;
}

export function saveLocalEventSettings(map, write = writeStorage) {
  write(STORAGE_KEY, JSON.stringify(map));
}

// Al recibir lo del servidor por primera vez: lo del servidor manda, y los
// eventos que el servidor todavía no conoce se completan con lo de este
// navegador (así lo que ya estaba configurado aquí no se pierde al estrenar el
// guardado en el servidor). Devuelve también si hay algo que subir.
//
// Solo una vez por navegador (ver legacyMigrationPending): después, la copia de
// este navegador puede ser de OTRA cuenta que usó el mismo equipo, y completar
// con ella mezclaría los ajustes de dos cuentas.
export function mergeMissingEvents(server, local) {
  const merged = { ...(server || {}) };
  let added = false;
  for (const id of EVENT_SETTINGS_IDS) {
    if (!merged[id] && local?.[id]) { merged[id] = local[id]; added = true; }
  }
  return { merged, added };
}

const MIGRATED_KEY = 'tkc_event_settings_migrated';
export const legacyMigrationPending = (read = readStorage) => read(MIGRATED_KEY) !== '1';
export const markLegacyMigrationDone = (write = writeStorage) => write(MIGRATED_KEY, '1');

export const sameEventSettings = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
