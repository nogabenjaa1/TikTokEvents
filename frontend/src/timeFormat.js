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
