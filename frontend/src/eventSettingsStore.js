// Ajustes guardados de cada evento (Rey del Trono, Zubastinis, Eliminación,
// Ruleta, Extensible, Objetivo), sin React: lo que el streamer dejó configurado
// aunque no lo haya iniciado. La fuente de verdad es el servidor
// (backend/lib/eventSettings.js); este navegador guarda una copia para pintar
// al instante y para no perder nada sin conexión. App.jsx los sincroniza con
// eventSettingsSync.js.
//
// La copia de este navegador lleva el dueño (el id de la licencia): en un
// equipo que usan varias cuentas, una nunca ve ni sube los ajustes de otra.
//
// Antes cada panel guardaba lo suyo en el navegador con su propia clave, sin
// dueño. Esas claves se suben al servidor una sola vez (ver
// planLegacyMigration) y nunca se usan para pintar el panel.
// Con extensión: este módulo se prueba con `node --test` tal cual.
import { readStorage, writeStorage } from './safeStorage.js';
import { EVENT_SETTINGS_IDS, normalizeEventEntry, normalizeEventSettings } from './eventSettingsSchema.js';
import { sameValue } from './eventSettingsSync.js';

export { EVENT_SETTINGS_IDS };
const STORAGE_KEY = 'tkc_event_settings';
const MIGRATED_KEY = 'tkc_event_settings_migrated';
const LEGACY_OWNER_KEY = 'tkc_event_settings_legacy_owner';
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

// El id de la licencia dentro del token de sesión (`sub`). Solo se usa para
// separar las copias locales por cuenta: no valida nada (eso lo hace el servidor).
export function ownerFromToken(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.sub === 'string' && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}

export function loadLocalEventSettings(owner, read = readStorage) {
  return loadLocalEventCache(owner, read).settings;
}

// La copia completa: lo que se ve (`settings`) y lo último que el servidor
// confirmó (`base`, ver eventSettingsSync.js). Lo que difiere entre las dos es
// un cambio que todavía no llegó al servidor: guardar la base hace que eso no
// se pierda al recargar (antes, al volver a cargar, se tomaba todo lo de aquí
// como ya confirmado y lo del servidor lo pisaba sin avisar).
// `base` es null si no se sabe (copia de antes, o de otra cuenta).
export function loadLocalEventCache(owner, read = readStorage) {
  if (!owner) return { settings: {}, base: null };
  const saved = parse(read(STORAGE_KEY));
  if (!saved || saved.owner !== owner) return { settings: {}, base: null };
  return {
    settings: normalizeEventSettings(saved.settings),
    base: isPlainObject(saved.base) ? normalizeEventSettings(saved.base) : null,
  };
}

export function saveLocalEventSettings(owner, map, base = null, write = writeStorage) {
  if (!owner) return;
  write(STORAGE_KEY, JSON.stringify(base ? { owner, settings: map, base } : { owner, settings: map }));
}

export function readLegacyEventSettings(read = readStorage) {
  const out = {};
  for (const id of EVENT_SETTINGS_IDS) {
    const entry = normalizeEventEntry(id, parse(read(LEGACY_KEYS[id])));
    if (entry && Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

// Qué subir de las claves de antes al recibir lo del servidor. Reglas:
// - Una sola vez por navegador, y se da por hecha solo cuando el servidor
//   confirma que la recibió (markLegacyMigrationDone): si se corta a mitad,
//   se vuelve a intentar en la próxima conexión.
// - Solo para la cuenta dueña de esas claves: la primera cuenta que entra en
//   este navegador con esta versión (las claves de antes no decían de quién
//   eran; lo más probable es que sean de quien ya estaba usando el equipo).
//   Otra cuenta en el mismo navegador nunca las recibe.
// - Lo del servidor siempre gana: solo se completan los eventos que el
//   servidor no tiene (nunca se pisa algo guardado, que es más nuevo).
// Devuelve el mapa parcial a subir, o null.
export function planLegacyMigration({ owner, server = {} }, read = readStorage, write = writeStorage) {
  if (!owner || read(MIGRATED_KEY) === '1') return null;
  const legacy = readLegacyEventSettings(read);
  if (!Object.keys(legacy).length) { write(MIGRATED_KEY, '1'); return null; }
  const legacyOwner = read(LEGACY_OWNER_KEY);
  if (!legacyOwner) write(LEGACY_OWNER_KEY, owner);
  else if (legacyOwner !== owner) return null;
  const missing = Object.fromEntries(Object.entries(legacy).filter(([id]) => !server[id]));
  if (!Object.keys(missing).length) { write(MIGRATED_KEY, '1'); return null; }
  return missing;
}

export function markLegacyMigrationDone(write = writeStorage) {
  write(MIGRATED_KEY, '1');
}

export const sameEventSettings = sameValue;
