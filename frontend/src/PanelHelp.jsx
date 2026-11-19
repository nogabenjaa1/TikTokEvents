import { useState } from 'react';

// Ayudas compartidas por los paneles de juegos/contadores (Rey del Trono,
// Zubastinis, Eliminación, Ruleta, Extensible, Objetivo): una explicación
// corta de "cómo funciona" para quien es nuevo y un aviso claro de por qué
// INICIAR está deshabilitado.

// `storageKey`: id del panel; si el streamer la cierra, recuerda que la cerró
// (así a quien ya sabe cómo funciona no le estorba en cada visita).
export function HowItWorks({ storageKey, children }) {
  const key = `tkc_help_closed_${storageKey}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '1'; } catch { return true; }
  });
  const onToggle = (e) => {
    const nowOpen = e.currentTarget.open;
    setOpen(nowOpen);
    try { localStorage.setItem(key, nowOpen ? '0' : '1'); } catch { /* sin storage */ }
  };
  return (
    <details open={open} onToggle={onToggle} className="theme-input mb-6 px-4 py-3">
      <summary className="cursor-pointer tkc-field-label">¿Cómo funciona?</summary>
      <div className="mt-2 text-[13px] text-gray-300 leading-relaxed space-y-2">{children}</div>
    </details>
  );
}

// Aviso encima del botón INICIAR mientras todavía no hay un LIVE conectado.
// A propósito no bloquea nada de los ajustes: solo explica qué falta.
// `error`: mensaje al intentar iniciar sin algo obligatorio (regalo, palabra
// clave...) -- reemplaza a los antiguos alert() del navegador.
export function StartRequirement({ connectionStatus, active, error }) {
  const needsLive = !(active || connectionStatus === 'connected');
  const connecting = connectionStatus === 'connecting' || connectionStatus === 'checking';
  return (
    <>
      {error && <p role="alert" className="theme-notice mb-3">{error}</p>}
      {needsLive && (
        <p role="status" className="theme-notice theme-notice-warning mb-3">
          {connecting
            ? 'Conectando con tu LIVE... en cuanto se confirme podrás iniciar.'
            : 'Para iniciar necesitas estar conectado a un LIVE (hazlo desde Inicio). Mientras tanto puedes dejar todo configurado.'}
        </p>
      )}
    </>
  );
}

// Marcadores de carga (ver .tkc-skeleton en index.css): bloques del color de
// los campos que laten despacio con la forma aproximada de lo que viene, en
// lugar de un texto suelto "Cargando...". Cuando llega el dato, lo que lo
// reemplaza sube con .tkc-reveal.
export function SkeletonRows({ count = 3, label = 'Cargando...', height = 'h-12' }) {
  return (
    <div role="status" aria-label={label} className="tkc-skeleton flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`tkc-skeleton-block ${height}`} style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Grilla de cifras (Sistema, resumen del negocio).
export function SkeletonKpis({ count = 4, label = 'Cargando...', className = 'grid grid-cols-2 md:grid-cols-4 gap-2' }) {
  return (
    <div role="status" aria-label={label} className={`tkc-skeleton ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tkc-skeleton-block h-20" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Cuándo se aplica un ajuste si el evento ya está en curso. Mismo texto y
// aspecto en todos los paneles (antes cada uno decía algo distinto, y Rey del
// Trono decía "próx. ronda" en ajustes que en verdad se aplican al instante).
// Solo se muestra con el evento en curso: antes de iniciar, todo se aplica al
// iniciar y no hace falta decirlo.
// `when`: 'now' (al instante), 'button' (al tocar el botón de actualizar),
// 'restart' (al reiniciar) o 'stop' (requiere detener e iniciar uno nuevo).
// `title`: el detalle de qué pasa exactamente.
const LIVE_TAG_TEXT = { now: 'Al instante', button: 'Al actualizar', restart: 'Al reiniciar', stop: 'Al iniciar uno nuevo' };
export function LiveTag({ active, when = 'now', title }) {
  if (!active) return null;
  const live = when === 'now';
  return (
    <span
      title={title}
      className={`ml-2 inline-flex items-center gap-1 align-middle px-1.5 py-px rounded-full border text-[11px] font-semibold ${live ? 'text-green-300 border-green-500/40' : 'text-gray-400 border-gray-600/50'}`}
    >
      {live && <span className="w-1.5 h-1.5 rounded-full bg-green-400" aria-hidden="true" />}
      {LIVE_TAG_TEXT[when]}
    </span>
  );
}

// Resultado de un cambio en vivo (ver useLiveApplied en liveApply.js).
const APPLIED_TEXT = {
  pending: 'Aplicando el cambio...',
  applied: 'Cambio aplicado en vivo',
  unconfirmed: 'No se pudo confirmar el cambio. Revisa tu conexión: se volverá a enviar al cambiar cualquier ajuste.',
};
export function LiveAppliedNote({ phase }) {
  return (
    <p role="status" aria-live="polite" className={`tkc-hint min-h-[1.25rem] ${phase === 'applied' ? 'text-green-300' : phase === 'unconfirmed' ? 'text-amber-500' : ''}`}>
      {phase ? APPLIED_TEXT[phase] : ''}
    </p>
  );
}

// Botón de una acción que borra el progreso (Detener, Reiniciar): si hay algo
// que perder, el primer clic pide confirmación en el mismo botón (sin ventanas
// emergentes) y el segundo la ejecuta; se cancela solo a los pocos segundos,
// con Escape o al salir del botón con el teclado. Sin progreso, actúa al primer
// clic: no se pide confirmar lo que no tiene consecuencias.
export function ConfirmButton({ needsConfirm, onConfirm, confirmLabel = '¿Seguro? Toca otra vez', className = '', disabled, children }) {
  const [armed, setArmed] = useState(false);
  const [timer, setTimer] = useState(null);
  const disarm = () => { if (timer) clearTimeout(timer); setTimer(null); setArmed(false); };
  const onClick = () => {
    if (!needsConfirm || armed) { disarm(); onConfirm(); return; }
    setArmed(true);
    setTimer(setTimeout(() => setArmed(false), 4000));
  };
  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={() => armed && disarm()}
      onKeyDown={(e) => { if (e.key === 'Escape' && armed) { e.preventDefault(); disarm(); } }}
      disabled={disabled}
      aria-live="polite"
      className={`${className} ${armed ? 'ring-2 ring-offset-2 ring-[var(--accent)]' : ''}`}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

// Escenario de un juego (Rey del Trono, Zubastinis, Eliminación, Ruleta): el
// nombre, la fase en curso y el reloj arriba; lo propio de cada juego (quién
// tiene el trono, el top 3, los participantes) debajo. La fase da el tono: una
// línea fina arriba se enciende en el acento mientras el juego corre, en rojo
// durante el snipe o el reingreso, en ámbar en un desempate y en verde al
// terminar. Nada se mueve en reposo salvo el punto de "en curso".
// `tone`: idle | live | snipe | tiebreak | paused | finished | nowinner.
export function GameStage({ title, phase, tone = 'idle', timer, children }) {
  return (
    <section className="tkc-stage w-full" data-tone={tone} aria-label={`Estado de ${title}`}>
      <div className="tkc-stage-head">
        <div className="flex flex-col gap-2 min-w-0">
          <h2 className="tkc-card-title">{title}</h2>
          <span role="status" className={`tkc-phase tkc-phase-${tone}`}>
            <span className="tkc-phase-pip" aria-hidden="true" />{phase}
          </span>
        </div>
        {timer !== undefined && <p className={`tkc-timer tkc-timer-${tone}`} aria-label={`Tiempo: ${timer}`}>{timer}</p>}
      </div>
      {children}
    </section>
  );
}

// Encabezado de la tarjeta de ajustes de un juego.
export function SettingsTitle({ children = 'Ajustes' }) {
  return <h2 className="tkc-section-title text-base mb-4">{children}</h2>;
}
