// Sincronización de los ajustes de eventos entre este panel y el servidor, sin
// React ni sockets (App.jsx la conecta). Misma regla que settingsSync.js para
// el tema y los overlays: en cada conexión no se manda nada hasta recibir lo
// que tiene el servidor. Lo que cambia es la unidad: aquí se trabaja evento por
// evento, porque son seis paneles que se editan por separado y con el mapa
// entero un cambio en un evento podía llevarse por delante otro.
//
// `base` es lo último que este panel sabe que tiene el servidor, por evento.
// Un evento "pendiente" es uno cuyo valor aquí no coincide con su base: un
// cambio de esta pestaña que el servidor todavía no confirmó (sin conexión,
// o enviado y sin respuesta). Lo pendiente nunca se pisa con lo que llega del
// servidor: se conserva, se manda, y como es lo último que llega, gana. Si
// mientras tanto ese mismo evento cambió en otra pestaña o dispositivo, se
// avisa (`conflicts`) en vez de perder lo otro sin decir nada.
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

// Filtro del guardado de un panel (ver useEventDraft): el primer guardado,
// el del montaje, y los que llegan iguales a él no son cambios del streamer.
// Devuelve una función que dice si un valor se debe guardar.
export function createMountGuard() {
  let seen = false;
  let first = null;
  let touched = false;
  return (value) => {
    if (touched) return true;
    if (!seen) { seen = true; first = value; return false; }
    if (sameValue(value, first)) return false;
    touched = true;
    return true;
  };
}

export function pendingIds(local = {}, base = {}) {
  return EVENT_SETTINGS_IDS.filter((id) => !sameValue(local[id], base[id]));
}

export function createEventSync() {
  let base = {};
  let synced = false;
  return {
    canSend: () => synced,
    // Sesión nueva (otro inicio de sesión, otra cuenta): lo que se ve al
    // empezar es el punto de partida; lo que se cambie después, antes de que
    // llegue lo del servidor, cuenta como cambio de esta sesión.
    rebase(local) { synced = false; base = { ...local }; },
    disconnected() { synced = false; },
    // Lo que tiene el servidor: al conectar, o porque otra pestaña cambió algo.
    // Devuelve qué mostrar (`merged`), qué falta mandar (`pending`), qué
    // eventos cambiaron desde otro lado (`replaced`) y cuáles cambiaron en los
    // dos lados a la vez (`conflicts`: gana lo de aquí, que se manda después).
    receive(server = {}, local = {}) {
      const pending = pendingIds(local, base);
      const conflicts = pending.filter((id) => !sameValue(server[id], base[id]) && !sameValue(server[id], local[id]));
      const merged = { ...server };
      for (const id of pending) {
        if (local[id] === undefined) delete merged[id];
        else merged[id] = local[id];
      }
      const replaced = EVENT_SETTINGS_IDS.filter((id) => !pending.includes(id) && !sameValue(server[id], local[id]));
      base = { ...server };
      synced = true;
      return { merged, pending: pending.filter((id) => local[id] !== undefined && !sameValue(local[id], server[id])), replaced, conflicts };
    },
    // Lo que hay que mandar ahora: solo los eventos que cambiaron.
    outgoing(local = {}) {
      if (!synced) return null;
      const ids = pendingIds(local, base).filter((id) => local[id] !== undefined);
      if (!ids.length) return null;
      return Object.fromEntries(ids.map((id) => [id, local[id]]));
    },
    // El servidor aceptó estos eventos (con su forma final).
    accepted(map = {}) { base = { ...base, ...map }; },
    get base() { return base; },
  };
}
