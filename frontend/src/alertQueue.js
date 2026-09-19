export const ANIM_DURATION_MS = 400;

// Una cola por reproductor. Los eventos guardan su propio contenido y nunca
// dependen de la llegada de otro evento para avanzar.
export function createAlertQueue(onChange, schedule = setTimeout, cancel = clearTimeout) {
  const pending = [];
  let active = false;
  let disposed = false;
  let sequence = 0;
  let timers = [];
  function advance() {
    if (disposed || active || !pending.length) return;
    const alert = pending.shift();
    active = true;
    const duration = Math.min(15000, Math.max(500, Number(alert.durationMs) || 5000));
    const animationDuration = Math.min(ANIM_DURATION_MS, duration / 2);
    onChange(alert, 'entering');
    timers = [
      schedule(() => onChange(alert, 'visible'), animationDuration),
      schedule(() => onChange(alert, 'exiting'), duration - animationDuration),
      schedule(() => {
        timers = [];
        active = false;
        onChange(null, 'visible');
        advance();
      }, duration),
    ];
  }
  return {
    enqueue(alert) {
      if (disposed || !alert) return;
      pending.push({ ...alert, playbackId: ++sequence });
      advance();
    },
    dispose() {
      disposed = true;
      timers.forEach(cancel);
      pending.length = 0;
    },
  };
}
