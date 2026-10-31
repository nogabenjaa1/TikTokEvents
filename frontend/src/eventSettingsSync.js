// Sincronización de los ajustes de eventos entre este panel y el servidor, sin
// React ni sockets (App.jsx la conecta). Misma regla que settingsSync.js para
// el tema y los overlays: en cada conexión no se manda nada hasta recibir lo
// que tiene el servidor. Lo que cambia es la unidad: aquí se trabaja campo por
// campo dentro de cada evento, porque son seis paneles que se editan por
// separado y, mandando el mapa (o el evento) entero, un cambio en un campo
// podía llevarse por delante otro que se cambió en otra pestaña.
//
// `base` es lo último que este panel sabe que tiene el servidor (confirmado).
// Un campo "pendiente" es uno cuyo valor aquí no coincide con su base: un
// cambio de esta pestaña que el servidor todavía no confirmó (sin conexión,
// enviado y sin respuesta, o porque falló al guardarse). La base se guarda con
// la copia del navegador (ver eventSettingsStore.js): así lo pendiente
// sobrevive también a recargar o cerrar la pestaña.
//
// Regla: lo pendiente nunca se pisa con lo que llega del servidor; se conserva,
// se manda, y como es lo último que llega, gana (por campo). Si mientras tanto
// ESE MISMO campo cambió en otra pestaña o dispositivo, se avisa (`conflicts`)
// en vez de perder lo otro sin decir nada.
// Con extensión: este módulo se prueba con `node --test` tal cual.
import { EVENT_SETTINGS_IDS } from './eventSettingsSchema.js';

// Igualdad por contenido, sin depender del orden de las claves.
export function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

const fieldsOf = (...entries) => [...new Set(entries.flatMap((e) => (e ? Object.keys(e) : [])))];

// Los campos de `local` que no coinciden con `base`.
export function changedFields(local, base) {
  if (!local) return [];
  return fieldsOf(local, base).filter((k) => k in local && !sameValue(local[k], base?.[k]));
}

// Lo que un panel guarda: solo los campos que el streamer cambió desde la
// última vez (ver useEventDraft). El primer valor, el del montaje, es el punto
// de partida y no se guarda: es lo que el panel ya tenía (lo guardado, o los
// valores de fábrica), no un cambio. Así un panel abierto con valores viejos
// (porque otra pestaña cambió algo mientras se editaba aquí) no los vuelve a
// subir: solo manda el campo que se tocó. Devuelve el parche o null.
export function createFieldTracker() {
  let last = null;
  return (value) => {
    if (last === null) { last = value; return null; }
    const changed = fieldsOf(value, last).filter((k) => !sameValue(value?.[k], last?.[k]));
    last = value;
    if (!changed.length) return null;
    return Object.fromEntries(changed.map((k) => [k, value[k]]));
  };
}

export function createEventSync() {
  let base = {};
  let synced = false;
  let owner = null;
  // Lo que esta pestaña mandó y todavía no vio confirmado, por evento y campo.
  // El servidor anuncia cada guardado también a quien lo mandó: si mientras
  // tanto se cambió otra vez ese campo, el anuncio trae un valor propio más
  // viejo, que no es un cambio de otra pestaña (no hay conflicto que avisar).
  let sent = {};
  const ownValue = (id, k, value) => (sent[id]?.[k] || []).some((v) => sameValue(v, value));
  const patchFor = (local) => {
    const out = {};
    for (const id of EVENT_SETTINGS_IDS) {
      const fields = changedFields(local[id], base[id]);
      if (fields.length) out[id] = Object.fromEntries(fields.map((k) => [k, local[id][k]]));
    }
    return out;
  };
  return {
    canSend: () => synced,
    // Sesión nueva (otro inicio de sesión, otra cuenta, o la página recién
    // cargada): `confirmed` es lo último que se sabe confirmado para ESA
    // cuenta (guardado con la copia del navegador); si no se sabe, lo que se
    // ve. Lo que difiera de ahí es un cambio pendiente de esta cuenta.
    rebase(local, confirmed, forOwner = null) { synced = false; owner = forOwner; base = { ...(confirmed || local) }; sent = {}; },
    disconnected() { synced = false; },
    // Lo que tiene el servidor: al conectar, o porque otra pestaña cambió algo.
    // Devuelve qué mostrar (`merged`), qué eventos quedan con algo por mandar
    // (`pending`), qué eventos cambian en pantalla (`replaced`) y en cuáles un
    // mismo campo cambió en los dos lados a la vez (`conflicts`: gana lo de
    // aquí, que se manda después).
    receive(server = {}, local = {}) {
      const merged = { ...server };
      const conflicts = [];
      for (const id of EVENT_SETTINGS_IDS) {
        const fields = changedFields(local[id], base[id]);
        if (!fields.length) continue;
        const entry = { ...(server[id] || {}) };
        for (const k of fields) {
          entry[k] = local[id][k];
          const otherSide = server[id]?.[k];
          if (!sameValue(otherSide, base[id]?.[k]) && !sameValue(otherSide, local[id][k]) && !ownValue(id, k, otherSide) && !conflicts.includes(id)) conflicts.push(id);
        }
        merged[id] = entry;
      }
      const replaced = EVENT_SETTINGS_IDS.filter((id) => !sameValue(merged[id], local[id]));
      const pending = EVENT_SETTINGS_IDS.filter((id) => merged[id] !== undefined && !sameValue(merged[id], server[id]));
      // Ya confirmado (está en lo que tiene el servidor): no hace falta recordarlo.
      for (const id of Object.keys(sent)) if (!pending.includes(id)) delete sent[id];
      base = { ...server };
      synced = true;
      return { merged, pending, replaced, conflicts };
    },
    // Lo que hay que mandar ahora: solo los campos que cambiaron.
    outgoing(local = {}) {
      if (!synced) return null;
      const out = patchFor(local);
      for (const [id, fields] of Object.entries(out)) {
        sent[id] = sent[id] || {};
        for (const [k, v] of Object.entries(fields)) sent[id][k] = [...(sent[id][k] || []), v].slice(-10);
      }
      return Object.keys(out).length ? out : null;
    },
    // El servidor guardó estos eventos (con su forma final).
    accepted(map = {}) { base = { ...base, ...map }; },
    // La base, solo si es de esta cuenta (para guardarla con su copia).
    baseFor(forOwner) { return forOwner && forOwner === owner ? base : null; },
  };
}
