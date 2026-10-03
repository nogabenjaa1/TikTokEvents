// Secciones de la barra lateral, pestañas de TikTokEvents y sus URLs. Sin JSX ni estado: solo datos y
// dos funciones puras, para que App.jsx, la barra lateral y la sección de eventos lean lo mismo.

// Secciones de primer nivel de la sidebar. "events" agrupa los juegos de
// TikTok (antes eran botones sueltos de primer nivel) detrás de una
// subsidebar propia — ver EVENT_TABS. "dashboard" (pedido explícito: página
// principal con accesos directos, ver Dashboard.jsx) va primero porque es
// el nuevo destino por default al entrar con sesión.
export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'overlay', label: 'Overlays' },
  { id: 'events',  label: 'Eventos' },
  { id: 'color',   label: 'ColorDice' },
  { id: 'downloader', label: 'Downloader' },
  { id: 'theme',   label: 'Tema' },
  { id: 'membership', label: 'Membresía' },
];

// Primer id de cada grupo de EVENT_TABS (juegos | contadores y metas |
// interacción con el chat, mismo orden que el Dashboard) -- delante de cada
// uno va un separador fino en la subnavegación.
export const EVENT_TAB_GROUP_STARTS = ['extensible', 'spotify'];

// Pestañas dentro de la sección "TikTokEvents" — cada una es uno de los
// módulos que ya existían como botón de primer nivel.
export const EVENT_TABS = [
  { id: 'king',     label: 'Rey del Trono' },
  { id: 'zub',      label: 'Zubastinis' },
  { id: 'elim',     label: 'Eliminación' },
  { id: 'roulette', label: 'Ruleta' },
  { id: 'versus',   label: 'Versus' },
  { id: 'extensible', label: 'Extensible' },
  { id: 'goal',     label: 'Objetivo' },
  { id: 'spotify',  label: 'Spotify' },
  { id: 'alerts',   label: 'Alertas' },
  { id: 'tts',      label: 'TTS' },
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
  // Pantalla de pago con tarjeta de MercadoPago (CardForm de MercadoPago.js):
  // va aparte de Membresía, con su propia dirección. Se entra desde el botón
  // "Pagar con Mercado Pago" de Membership.jsx, nunca desde la barra lateral.
  mpcheckout: 'membership/mercadopago',
  licenses: 'licenses',
  system: 'system',
  // Páginas legales (enlazadas desde el pie del Dashboard, Membresía y el
  // aviso de cookies; no van en la barra lateral). Ver LegalPages.jsx.
  legal: 'aviso-legal',
  privacy: 'privacidad',
  cookies: 'cookies',
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
  // Secciones cuya dirección tiene dos tramos (membership/mercadopago).
  const nested = PATH_TO_SECTION[segments.join('/')];
  if (nested && segments.length === 2) return { section: nested, tab: null };
  const section = PATH_TO_SECTION[segments[0]];
  // Una ruta que no existe muestra la página 404 (antes caía en el Dashboard
  // sin avisar). Mismo criterio que lib/sitePages.js del backend, que además
  // responde con el código 404.
  if (!section || segments.length > 2 || (segments.length === 2 && section !== 'events')) return { section: 'notfound', tab: null };
  if (section !== 'events') return { section, tab: null };
  if (segments[1] === undefined) return { section, tab: 'king' };
  const tab = PATH_TO_EVENT_TAB[segments[1]];
  return tab ? { section, tab } : { section: 'notfound', tab: null };
}

// Título de pestaña dinámico (pedido explícito: "que sea visible siempre"
// en qué sección está) -- ver el useEffect que lo aplica más abajo. La
// marca del sitio es BenjaApis; "TikTokEvents" se conserva solo como
// prefijo dentro de esa sección puntual (el nombre de la funcionalidad en
// sí, no el nombre del producto -- pedido explícito de mantenerlo así).
const ADMIN_SECTION_LABELS = { mpcheckout: 'Pago con Mercado Pago', licenses: 'Licencias', system: 'Sistema', legal: 'Aviso legal', privacy: 'Aviso de privacidad', cookies: 'Cookies', notfound: 'Página no encontrada' };

// Descripción de cada página para buscadores y para cuando se comparte un
// enlace (ver useSectionRouting, que la aplica a <meta name="description">).
const SECTION_DESCRIPTIONS = {
  dashboard: 'Panel para streamers de TikTok LIVE: juegos con regalos, alertas, TTS del chat, Spotify y overlays para OBS en un solo lugar.',
  overlay: 'Overlays para OBS y TikTok LIVE Studio: juegos, alertas, rankings, chat, metas y más, personalizables y en tiempo real.',
  events: 'Juegos y eventos para tu TikTok LIVE: Rey del Trono, Zubastinis, Eliminación, Ruleta, Versus, Extensible, Objetivo, alertas y TTS.',
  color: 'ColorDice: dados de colores para dinámicas en vivo, gratis y con overlay para OBS.',
  downloader: 'Descarga videos de TikTok sin marca de agua y de otros sitios, desde tu panel de BenjaApis.',
  theme: 'Elige el estilo y los colores de tu panel de BenjaApis.',
  membership: 'Planes de BenjaApis para streamers de TikTok LIVE: prueba gratis, mensual, anual y de por vida.',
  legal: 'Aviso legal de BenjaApis: quién ofrece el servicio y en qué condiciones.',
  privacy: 'Aviso de privacidad de BenjaApis: qué datos tratamos, para qué y cómo ejercer tus derechos ARCO.',
  cookies: 'Cómo usa BenjaApis el almacenamiento del navegador y las cookies de anuncios, y cómo elegir.',
};
export function sectionDescription(sidebarMode) {
  return SECTION_DESCRIPTIONS[sidebarMode] || SECTION_DESCRIPTIONS.dashboard;
}

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
export const FREE_MODES = ['overlay', 'color', 'theme', 'legal', 'privacy', 'cookies', 'notfound'];

// Pestañas de TikTokEvents que tienen representación en el overlay de OBS
// (TTS no la tiene: lee el chat en el navegador del streamer, sin overlay).
export const OVERLAY_APPS = ['king', 'zub', 'elim', 'roulette'];
