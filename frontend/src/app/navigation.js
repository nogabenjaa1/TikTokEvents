// Secciones de la barra lateral, pestañas de TikTokEvents y sus URLs. Sin JSX ni estado: solo datos y
// dos funciones puras, para que App.jsx, la barra lateral y la sección de eventos lean lo mismo.

// Secciones de primer nivel de la sidebar. "events" agrupa los juegos de
// TikTok (antes eran botones sueltos de primer nivel) detrás de una
// subsidebar propia — ver EVENT_TABS. "dashboard" (pedido explícito: página
// principal con accesos directos, ver Dashboard.jsx) va primero porque es
// el nuevo destino por default al entrar con sesión.
export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard',   icon: '🏠' },
  { id: 'overlay', label: 'Overlays',     icon: '🖥️' },
  { id: 'events',  label: 'Eventos',      icon: '🎉' },
  { id: 'color',   label: 'ColorDice',    icon: '🎲' },
  { id: 'downloader', label: 'Downloader', icon: '⬇️' },
  { id: 'theme',   label: 'Tema',         icon: '🎨' },
  { id: 'membership', label: 'Membresía', icon: '💳' },
];

// Primer id de cada grupo de EVENT_TABS (juegos | contadores y metas |
// interacción con el chat, mismo orden que el Dashboard) -- delante de cada
// uno va un separador fino en la subnavegación.
export const EVENT_TAB_GROUP_STARTS = ['extensible', 'spotify'];

// Pestañas dentro de la sección "TikTokEvents" — cada una es uno de los
// módulos que ya existían como botón de primer nivel.
export const EVENT_TABS = [
  { id: 'king',     label: 'Rey del Trono', icon: '👑' },
  { id: 'zub',      label: 'Zubastinis',    icon: '🏆' },
  { id: 'elim',     label: 'Eliminación',   icon: '💀' },
  { id: 'roulette', label: 'Ruleta',        icon: '🎡' },
  { id: 'versus',   label: 'Versus',        icon: '⚔️' },
  { id: 'extensible', label: 'Extensible',  icon: '⏱️' },
  { id: 'goal',     label: 'Objetivo',      icon: '🎯' },
  { id: 'spotify',  label: 'Spotify',       icon: '🎵' },
  { id: 'alerts',   label: 'Alertas',       icon: '🔔' },
  { id: 'tts',      label: 'TTS',           icon: '🔊' },
];

// Pedido explicito: URLs reales para cada sección (benjaapis.dev/overlays,
// /membership, /tiktokevents/kingthrone, etc.) en vez de todo colgado del
// estado de React sin reflejo en la barra de direcciones -- así se puede
// compartir/guardar un enlace directo a una sección y el botón
// atrás/adelante del navegador funciona. A propósito NO usa <Routes>/<Route>
// de react-router (el render de acá abajo sigue siendo 100% condicional,
// como siempre) -- solo se usa el router para LEER/ESCRIBIR el pathname y
// mantenerlo sincronizado con `sidebarMode`/`eventsTab`, sin tocar cómo se
// decide qué mostrar. OJO: esto NUNCA debe tocar el modo overlay (la URL
// que ya está pegada en OBS de streamers reales, ?overlay=true&screen=...)
// -- por eso el efecto de sincronización de más abajo corta temprano si
// `overlayMode` es true, y esta sección de rutas ni se evalúa en ese caso
// (ver el `if (overlayMode) return ...` bien arriba en el componente).
export const SECTION_PATHS = {
  dashboard: 'dashboard',
  overlay: 'overlays',
  events: 'tiktokevents',
  color: 'colordice',
  downloader: 'downloader',
  theme: 'theme',
  membership: 'membership',
  licenses: 'licenses',
  system: 'system',
};
export const PATH_TO_SECTION = Object.fromEntries(Object.entries(SECTION_PATHS).map(([id, path]) => [path, id]));

export const EVENT_TAB_PATHS = {
  king: 'kingthrone',
  zub: 'zubastinis',
  elim: 'elimination',
  roulette: 'roulette',
  versus: 'versus',
  extensible: 'extensible',
  goal: 'objetivo',
  spotify: 'spotify',
  alerts: 'alerts',
  tts: 'tts',
};
export const PATH_TO_EVENT_TAB = Object.fromEntries(Object.entries(EVENT_TAB_PATHS).map(([id, path]) => [path, id]));

// Deduce sección + pestaña de TikTokEvents (si aplica) a partir del
// pathname actual -- se usa tanto para el estado INICIAL (sin flash del
// contenido por defecto antes de corregirse, ver el useState de más abajo)
// como para reaccionar a atrás/adelante del navegador. Cualquier ruta
// desconocida (o la raíz "/") cae siempre en 'dashboard' -- es la página
// principal del sitio, con o sin sesión (Dashboard.jsx ya sabe mostrar una
// versión reducida para visitantes sin cuenta).
export function sectionFromPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return { section: 'dashboard', tab: null };
  const section = PATH_TO_SECTION[segments[0]];
  if (!section) return { section: 'dashboard', tab: null };
  const tab = section === 'events' ? (PATH_TO_EVENT_TAB[segments[1]] || 'king') : null;
  return { section, tab };
}

// Título de pestaña dinámico (pedido explícito: "que sea visible siempre"
// en qué sección está) -- ver el useEffect que lo aplica más abajo. La
// marca del sitio es BenjaApis; "TikTokEvents" se conserva solo como
// prefijo dentro de esa sección puntual (el nombre de la funcionalidad en
// sí, no el nombre del producto -- pedido explícito de mantenerlo así).
const ADMIN_SECTION_LABELS = { licenses: 'Licencias', system: 'Sistema' };

export function sectionTitle(sidebarMode, eventsTab) {
  if (sidebarMode === 'events') {
    const tab = EVENT_TABS.find((t) => t.id === eventsTab);
    return tab ? `TikTokEvents · ${tab.label}` : 'TikTokEvents';
  }
  const section = SECTIONS.find((s) => s.id === sidebarMode);
  if (section) return `BenjaApis · ${section.label}`;
  return ADMIN_SECTION_LABELS[sidebarMode] ? `BenjaApis · ${ADMIN_SECTION_LABELS[sidebarMode]}` : 'BenjaApis';
}

// Únicas secciones de acceso libre, sin licencia (Color Says, y "Tema" que es

// Únicas secciones de acceso libre, sin licencia (Color Says, y "Tema" que es
// puramente cosmético/local). Todo lo demás requiere sesión — sin ella se
// muestra el login embebido con la opción de prueba gratis en su lugar.
export const FREE_MODES = ['overlay', 'color', 'theme'];

// Pestañas de TikTokEvents que tienen representación en el overlay de OBS
// (TTS no la tiene: lee el chat en el navegador del streamer, sin overlay).
export const OVERLAY_APPS = ['king', 'zub', 'elim', 'roulette'];
