// Borrador de configuración de cada modo de juego (Rey del Trono/Zubastinis/Eliminación/Ruleta), por
// navegador. Reporte real del streamer: configuraba el regalo objetivo y los demás ajustes, salía a
// otra pantalla del panel SIN presionar Iniciar, volvía, y tenía que elegir todo de nuevo -- el panel de
// cada modo se desmonta al cambiar de pestaña (ver EventsSection.jsx) y esos ajustes solo vivían en su
// estado local de React, que se pierde con el componente.
//
// Mismo criterio que loadOverlayCustomization/saveOverlayCustomization (overlayCustomization.js):
// persistido en este dispositivo, cargado una sola vez al montar. Mientras el juego está EN VIVO (o ya
// se inició alguna vez, aunque ahora esté detenido -- el servidor no borra el último regalo/ajustes al
// detener, ver stopKingContest/etc. en el backend) el servidor sigue siendo la fuente de verdad, como ya
// era antes de esto: este borrador solo llena el hueco de "todavía no arranqué nada".
// Con extensión (a diferencia del resto del código base): así este módulo se puede
// probar con `node --test` tal cual, sin bundler de por medio -- Vite acepta la
// extensión explícita igual de bien que sin ella, así que no cambia nada en la app.
import { readStorage, writeStorage } from './safeStorage.js';

export function loadDraft(key, fallback) {
  const raw = readStorage(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback; // borrador corrupto (o de una versión vieja): se ignora, nunca rompe el panel
  }
}

export function saveDraft(key, value) {
  writeStorage(key, JSON.stringify(value));
}
