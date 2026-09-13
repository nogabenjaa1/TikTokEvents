// Formato MM:SS para cualquier cuenta regresiva del panel/overlay — pedido
// explícito de reemplazar los segundos sueltos ("180") por minutos:segundos
// ("3:00"). Los segundos SIGUEN siendo la unidad real que vive en el
// estado/backend (sin cambios ahí) — esto es puramente de presentación.
export function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Formato HH:MM:SS — pedido explícito solo para el modo Extensible, que
// puede correr tiempos mucho más largos (hasta 120 min de base, más lo que
// sumen follows/regalos en vivo, sin techo) y donde "180:00" en MM:SS se ve
// truncado/confuso. Mismo criterio que formatMMSS: puramente de
// presentación, los segundos siguen siendo la unidad real en el estado.
export function formatHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
