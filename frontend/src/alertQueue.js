export const ANIM_DURATION_MS = 400;

const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 15000;

// Tiempos de una alerta: la duración configurada (entre 0.5 y 15 s) y lo que
// duran las animaciones de entrada y de salida, que se acortan si la alerta es
// corta para que las dos quepan dentro. Es la única fuente de estos números: la
// cola, la vista previa y el CSS (--tkc-anim-ms) leen la misma.
export function alertTiming(alert) {
  const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Number(alert?.durationMs) || 5000));
  return { duration, animation: Math.min(ANIM_DURATION_MS, duration / 2) };
}

function phaseAt(elapsed, duration, animation) {
  if (elapsed < animation) return 'entering';
  if (elapsed < duration - animation) return 'visible';
  return 'exiting';
}

// Una cola por reproductor: las alertas se muestran de a una, en orden de
// llegada, y se pueden seguir agregando mientras corre la actual.
//
// El avance NO depende de una cadena de setTimeout: el navegador embebido de
// OBS / TikTok Studio congela o frena los temporizadores de una fuente que no
// se está pintando, y con eso la alerta activa se quedaba "pegada" y las demás
// esperando hasta que otro evento las soltaba de golpe. Ahora todo sale del
// reloj real (now): tick() mira qué hora es y decide en qué fase está la alerta
// actual, si ya terminó y cuál sigue. tick() lo llaman un temporizador propio,
// un ticker en Worker (ver ticker.js), el cambio de visibilidad de la página y
// cada alerta nueva, así que da igual cuál de ellos sea el que despierte.
//
// Si la página estuvo congelada y al volver la alerta actual ya se pasó de su
// tiempo, se da por terminada y la SIGUIENTE arranca completa desde ahora (cada
// una con su duración entera, una tras otra), en vez de disparar todas juntas.
export function createAlertQueue(onChange, schedule = setTimeout, cancel = clearTimeout, now = Date.now) {
  const pending = [];
  let current = null; // { alert, startedAt, duration, animation, phase }
  let timer = null;
  let disposed = false;
  let sequence = 0;

  function disarm() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  // Un solo temporizador, para el próximo cambio de fase o el final.
  function arm() {
    disarm();
    if (!current) return;
    const elapsed = now() - current.startedAt;
    const next = elapsed < current.animation ? current.animation
      : elapsed < current.duration - current.animation ? current.duration - current.animation
        : current.duration;
    timer = schedule(tick, Math.max(0, next - elapsed));
  }

  function begin(alert) {
    const { duration, animation } = alertTiming(alert);
    current = { alert, startedAt: now(), duration, animation, phase: 'entering' };
    onChange(alert, 'entering');
    arm();
  }

  function tick() {
    if (disposed) return;
    timer = null;
    if (current) {
      const elapsed = now() - current.startedAt;
      if (elapsed >= current.duration) {
        current = null;
        onChange(null, 'visible');
      } else {
        const phase = phaseAt(elapsed, current.duration, current.animation);
        if (phase !== current.phase) {
          current.phase = phase;
          onChange(current.alert, phase);
        }
        arm();
        return;
      }
    }
    if (pending.length) begin(pending.shift());
  }

  return {
    enqueue(alert) {
      if (disposed || !alert) return;
      pending.push({ ...alert, playbackId: ++sequence });
      tick();
    },
    tick,
    get size() { return pending.length + (current ? 1 : 0); },
    dispose() {
      disposed = true;
      disarm();
      current = null;
      pending.length = 0;
    },
  };
}
