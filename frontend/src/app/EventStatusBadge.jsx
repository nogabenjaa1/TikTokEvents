// Cómo se ve el estado de un evento (ver eventStatus.js), igual en el
// Dashboard y en la barra de Eventos. El color nunca va solo: siempre lo
// acompaña el texto (visible o, en el punto de la barra, para lectores de
// pantalla).
const TONE_CLASSES = {
  live: 'text-green-300 border-green-500/40 bg-green-500/10',
  paused: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  finished: 'text-gray-400 border-gray-500/40 bg-gray-500/10',
  setup: 'text-amber-500 border-amber-500/40 bg-transparent',
  ready: 'text-gray-500 border-gray-600/50 bg-transparent',
};
const DOT_CLASSES = {
  live: 'bg-green-400 animate-pulse',
  paused: 'bg-amber-400',
  finished: 'bg-gray-400',
  setup: 'bg-amber-400',
  ready: 'bg-gray-500',
};

export function EventStatusBadge({ status, className = '' }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${TONE_CLASSES[status.tone]} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASSES[status.tone]}`} aria-hidden="true" />
      {status.label}
    </span>
  );
}

// Solo el punto (barra de Eventos): para lo que pide atención, no para "listo".
export function EventStatusDot({ status }) {
  if (!status || status.tone === 'ready') return null;
  return (
    <>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASSES[status.tone]}`} aria-hidden="true" />
      <span className="sr-only">({status.label})</span>
    </>
  );
}
