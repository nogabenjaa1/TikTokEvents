// Reglas de seguridad del Downloader, aparte de downloader.js para poder
// probarlas sin arrancar yt-dlp ni tocar el disco.
//
// La URL la escribe una persona y se la pasamos a yt-dlp, que la abre desde el
// SERVIDOR. Sin validar, sirve para (1) colar opciones de yt-dlp (una "URL" que
// empiece por "-"), y (2) hacer que el servidor consulte cualquier dirección,
// incluidas las de su red interna (SSRF). Por eso solo se aceptan los sitios
// que el Downloader ofrece: YouTube y TikTok.

const DEFAULT_HOSTS = ['youtube.com', 'youtu.be', 'tiktok.com'];
const TIKTOK_HOSTS = ['tiktok.com'];
const MAX_URL_LENGTH = 2048;

// Error de "esta URL no sirve": el mensaje ya es apto para mostrarse al usuario.
class DownloadUrlError extends Error {}

// Error de "ahora no": demasiadas descargas a la vez. Se responde con 429.
class DownloadLimitError extends Error {
    constructor(message) {
        super(message);
        this.status = 429;
    }
}

function hostMatches(host, suffixes) {
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// El dueño puede sumar sitios sin tocar el código: DOWNLOADER_EXTRA_HOSTS=
// "instagram.com,x.com" (dominios, separados por coma).
function extraHostsFromEnv(raw = process.env.DOWNLOADER_EXTRA_HOSTS) {
    return String(raw || '')
        .split(',')
        .map((host) => host.trim().toLowerCase().replace(/^\.+/, ''))
        .filter((host) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host));
}

// Devuelve { url, tiktok } con la URL YA NORMALIZADA (es la que se le pasa a
// yt-dlp, nunca el texto crudo) o lanza DownloadUrlError.
function parseDownloadUrl(raw, extraHosts = extraHostsFromEnv()) {
    if (typeof raw !== 'string' || !raw.trim()) throw new DownloadUrlError('URL requerida');
    const text = raw.trim();
    if (text.length > MAX_URL_LENGTH) throw new DownloadUrlError('La URL es demasiado larga');
    // Un espacio o un carácter de control dentro de la URL no es de un enlace real.
    // eslint-disable-next-line no-control-regex
    if (/[\s\u0000-\u001f\u007f]/.test(text)) throw new DownloadUrlError('La URL no es válida');

    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        throw new DownloadUrlError('La URL no es válida');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new DownloadUrlError('La URL debe empezar por https://');
    }
    if (parsed.username || parsed.password) throw new DownloadUrlError('La URL no es válida');
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') throw new DownloadUrlError('La URL no es válida');

    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostMatches(host, [...DEFAULT_HOSTS, ...extraHosts])) {
        throw new DownloadUrlError('Solo se pueden descargar enlaces de YouTube o TikTok');
    }

    const tiktok = hostMatches(host, TIKTOK_HOSTS);
    // Los parámetros de rastreo de TikTok provocan errores 403.
    if (tiktok) parsed.search = '';
    parsed.hash = '';
    return { url: parsed.href, tiktok };
}

// Lo que falla al ejecutar yt-dlp trae la línea de comandos completa (con el
// proxy, usuario y contraseña incluidos) y rutas del servidor. Para el registro
// del servidor se tapan los secretos; al usuario solo le llega la línea
// "ERROR:" que escribe yt-dlp, sin rutas.
const ANSI_RE = /\u001b\[[0-9;]*m/g; // eslint-disable-line no-control-regex
const SERVER_PATH_RE = /(?:[A-Za-z]:\\[^\s'",;)]+|(?<![\w:/.])\/(?:opt|home|usr|app|var|tmp|etc|srv|workspace|render|root)\/[^\s'",;)]*)/g;
const URL_CREDENTIALS_RE = /\/\/[^\s/@]+:[^\s/@]*@/g;

function redactSecrets(raw, secrets = []) {
    let text = String(raw ?? '').replace(ANSI_RE, '');
    for (const secret of secrets) {
        if (secret && String(secret).length >= 4) text = text.split(String(secret)).join('[oculto]');
    }
    return text.replace(URL_CREDENTIALS_RE, '//[oculto]@');
}

function friendlyDownloaderError(raw, secrets = [], fallback = 'No se pudo procesar el enlace.') {
    const errorLines = redactSecrets(raw, secrets).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^ERROR:/i.test(line));
    if (!errorLines.length) return fallback;
    let text = errorLines.slice(0, 2).map((line) => line.replace(/^ERROR:\s*/i, '')).join(' ');
    text = text.replace(SERVER_PATH_RE, '[ruta]').replace(/\s+/g, ' ').trim();
    if (text.length > 220) text = `${text.slice(0, 217)}...`;
    return text || fallback;
}

// Cuántas descargas puede haber en marcha, por licencia y en todo el servidor.
function checkDownloadCapacity(activeForLicense, activeTotal, { perLicense, total }) {
    if (activeForLicense >= perLicense) {
        const plural = activeForLicense === 1 ? '' : 's';
        throw new DownloadLimitError(`Ya tienes ${activeForLicense} descarga${plural} en curso. Espera a que termine${plural === '' ? '' : 'n'} para iniciar otra.`);
    }
    if (activeTotal >= total) {
        throw new DownloadLimitError('El Downloader está muy ocupado en este momento. Intenta de nuevo en unos minutos.');
    }
}

module.exports = {
    parseDownloadUrl, extraHostsFromEnv, friendlyDownloaderError, redactSecrets, checkDownloadCapacity,
    DownloadUrlError, DownloadLimitError,
};
