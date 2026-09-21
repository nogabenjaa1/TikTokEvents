// Piezas que comparten las pantallas de Sistema.

// Un dato con su etiqueta (mismo aspecto que las tarjetas de AdminStats.jsx).
export function Kpi({ label, value, hint, tone }) {
  return (
    <div className="theme-input p-3 flex flex-col gap-0.5 min-w-0">
      <span className="theme-label text-[9px] uppercase tracking-widest font-semibold">{label}</span>
      <span className={`text-xl font-black leading-tight break-words ${tone || ''}`}>{value}</span>
      {hint && <span className="text-[10px] text-gray-500 leading-snug break-words">{hint}</span>}
    </div>
  );
}

const BADGE_TONES = {
  danger: 'text-red-400 bg-red-500/15 border-red-500/50',
  warning: 'text-amber-400 bg-amber-500/15 border-amber-500/50',
  success: 'text-green-400 bg-green-500/15 border-green-500/50',
  info: 'text-sky-400 bg-sky-500/15 border-sky-500/50',
  muted: 'text-gray-500 bg-[var(--surface-bg-alt)] border-[var(--surface-border-color)]',
};

// Etiqueta de estado: el color es fijo (no sigue el acento), igual que los badges de licencias.
export function Badge({ tone = 'muted', children }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border shrink-0 ${BADGE_TONES[tone]}`}>{children}</span>;
}

// Título de una sección con su botón de actualizar (y lo que se quiera a su lado).
export function PanelBar({ title, hint, onRefresh, loading, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="theme-label text-xs uppercase tracking-widest font-semibold">{title}</h2>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5 max-w-xl">{hint}</p>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {children}
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={loading} className="theme-link theme-link-info disabled:opacity-40">
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        )}
      </div>
    </div>
  );
}

// Lista vacía con buenas noticias.
export function EmptyNote({ children }) {
  return <p className="theme-surface p-5 text-sm text-gray-400 text-center">{children}</p>;
}
