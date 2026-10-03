// Las páginas que existen en el sitio (las rutas del panel, ver
// frontend/src/app/navigation.js: SECTION_PATHS y EVENT_TAB_PATHS). Sirve
// para tres cosas: devolver un 404 de verdad (con la página personalizada)
// cuando la ruta no existe, armar el sitemap y aceptar solo estas rutas en la
// analítica. site-pages.test.js comprueba que coincidan con navigation.js.
const SECTION_PATHS = ['dashboard', 'overlays', 'tiktokevents', 'colordice', 'downloader', 'theme', 'membership', 'membership/mercadopago', 'licenses', 'system', 'aviso-legal', 'privacidad', 'cookies'];
const EVENT_TAB_PATHS = ['kingthrone', 'zubastinis', 'elimination', 'roulette', 'versus', 'extensible', 'objetivo', 'spotify', 'alerts', 'tts'];

// Lo que se ofrece a los buscadores (lo público; el resto pide sesión o es
// del admin) con su prioridad en el sitemap.
const SITEMAP_PAGES = [
    { path: '/', priority: '1.0' },
    { path: '/membership', priority: '0.9' },
    { path: '/colordice', priority: '0.8' },
    { path: '/tiktokevents', priority: '0.8' },
    { path: '/overlays', priority: '0.6' },
    { path: '/downloader', priority: '0.5' },
    { path: '/aviso-legal', priority: '0.2' },
    { path: '/privacidad', priority: '0.2' },
    { path: '/cookies', priority: '0.2' },
];

function isKnownPage(rawPath) {
    const path = String(rawPath || '').toLowerCase().replace(/\/+$/, '') || '/';
    if (path === '/') return true;
    // Secciones con dirección de dos tramos (membership/mercadopago).
    if (SECTION_PATHS.includes(path.slice(1))) return true;
    const [first, second, ...rest] = path.split('/').filter(Boolean);
    if (rest.length > 0 || !SECTION_PATHS.includes(first)) return false;
    if (second === undefined) return true;
    return first === 'tiktokevents' && EVENT_TAB_PATHS.includes(second);
}

module.exports = { SECTION_PATHS, EVENT_TAB_PATHS, SITEMAP_PAGES, isKnownPage };
