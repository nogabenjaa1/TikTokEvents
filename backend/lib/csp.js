// Política de seguridad de contenido (CSP), en modo SOLO REPORTE: el navegador
// no bloquea nada, solo avisa de lo que una política estricta habría bloqueado.
// Se activó así a propósito: el sitio carga anuncios (AdSense y Adsterra), el
// SDK de MercadoPago (que a su vez carga reCAPTCHA) y Stripe desde muchísimos
// dominios, y una política mal armada rompería en silencio los anuncios o el
// cobro con tarjeta. Con los reportes a la vista (panel de Sistema > Errores)
// se ve qué falta permitir y, cuando ya no salgan avisos, se pasa a bloquear.
//
// Lo estricto es lo que más importa contra un script inyectado: script-src solo
// admite los dominios de abajo (sin 'unsafe-inline' ni 'unsafe-eval'), y
// object-src y base-uri quedan cerrados. Imágenes, medios, conexiones y marcos
// se dejan abiertos a https: porque vienen de las CDN de TikTok, Spotify, Supabase
// y de los bancos (desafío 3DS), que cambian.
//
// La misma política se sirve desde Express (backend) y desde vercel.json
// (frontend en Vercel): una prueba comprueba que no se desincronicen.

const SCRIPT_HOSTS = [
    'https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.doubleclick.net',
    'https://www.googletagservices.com', 'https://adservice.google.com', 'https://*.adtrafficquality.google',
    'https://fundingchoicesmessages.google.com', 'https://www.google.com', 'https://www.gstatic.com',
    'https://beastscarnival.com',
    'https://sdk.mercadopago.com', 'https://*.mercadopago.com', 'https://*.mercadolibre.com', 'https://*.mlstatic.com',
    'https://js.stripe.com',
];

const DIRECTIVES = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...SCRIPT_HOSTS],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'https:'],
    'connect-src': ["'self'", 'https:', 'wss:'],
    'frame-src': ["'self'", 'https:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https:'],
};

// Cabecera Content-Security-Policy-Report-Only. `reportUri` solo cuando la página
// la sirve este backend (una ruta relativa): con el frontend en Vercel no se
// conoce la dirección del backend, y esas violaciones las recoge el propio
// navegador de la página (evento securitypolicyviolation, ver errorReporter.js).
function cspHeaderValue({ reportUri = null } = {}) {
    const parts = Object.entries(DIRECTIVES).map(([name, sources]) => `${name} ${sources.join(' ')}`);
    if (reportUri) parts.push(`report-uri ${reportUri}`);
    return parts.join('; ');
}

// La forma que espera helmet (camelCase).
function helmetDirectives({ reportUri = null } = {}) {
    const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const out = {};
    for (const [name, sources] of Object.entries(DIRECTIVES)) out[camel(name)] = [...sources];
    if (reportUri) out.reportUri = [reportUri];
    return out;
}

module.exports = { cspHeaderValue, helmetDirectives, DIRECTIVES, SCRIPT_HOSTS };
