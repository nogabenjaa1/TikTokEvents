// Íconos de línea de la navegación principal (ver DESIGN.md › Iconografía).
// Un solo trazo, del color del texto (currentColor): no traen color propio,
// así que siguen al acento, al modo oscuro y al estado activo como cualquier
// texto. Solo la navegación lleva ícono; el resto de la interfaz es texto.
const PATHS = {
  dashboard: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  overlay: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  events: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4" />
      <path d="M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
    </>
  ),
  color: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" />
    </>
  ),
  downloader: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20.5h14" />
    </>
  ),
  theme: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6Z" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="10" cy="7.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
    </>
  ),
  membership: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  licenses: (
    <>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="m10.4 12.6 9.1-9.1M15.5 7.5l3 3M18 5l2 2" />
    </>
  ),
  system: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  enter: (
    <>
      <path d="M14 3.5h4a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-4" />
      <path d="m9.5 16.5 4.5-4.5-4.5-4.5M14 12H3.5" />
    </>
  ),
  exit: (
    <>
      <path d="M10 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9" />
    </>
  ),
};

export default function NavIcon({ name, size = 20, className = '' }) {
  const shape = PATHS[name];
  if (!shape) return null;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={`flex-shrink-0 ${className}`}
    >
      {shape}
    </svg>
  );
}
