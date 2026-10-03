// ==========================================
// DOWNLOADER: descarga videos de YouTube/TikTok (sin marca de agua) vía
// yt-dlp -- disponible para cualquier sesión válida, incluida la prueba
// gratis (pedido explícito). Puerto Node de la lógica ya probada en el proyecto
// standalone YTDownloader (mismos formatos/calidad/proxy anti-ban para
// TikTok), adaptada acá para ser multi-tenant: cada licencia solo puede
// ver/descargar sus propios jobs (ver ownership checks en server.js).
//
// A diferencia del proyecto standalone (una sola persona usándolo en su
// propia PC, donde "Guardar" copia el archivo a su carpeta de Descargas
// real y listo), acá DOWNLOAD_DIR vive en el disco EFÍMERO de Render — se
// borra solo con cada redeploy, y de todos modos es nada más el caché de
// yt-dlp para servir el click de descarga del navegador. Mismo criterio ya
// confirmado ahí: se limpia solo, por antigüedad, sin excepciones.
// ==========================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const YTDlpWrap = require('yt-dlp-wrap-plus').default;
const ffmpegPath = require('ffmpeg-static');
const { parseDownloadUrl, friendlyDownloaderError, redactSecrets, checkDownloadCapacity, isYouTubeBotCheck, YOUTUBE_BOT_CHECK_MESSAGE } = require('./lib/downloaderSafety');

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const YTDLP_BIN_PATH = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpWrap = new YTDlpWrap(YTDLP_BIN_PATH);

// Igual que TIKTOK_PROXY en el proyecto standalone, pero SIN fallback
// hardcodeado -- ese default ya había quedado expuesto en el historial de
// ese OTRO repo antes de que lo tocáramos; acá, en un archivo nuevo, no hay
// ninguna razón para repetir el mismo error. Falla claro si falta, mismo
// criterio que getMpAccessToken() en server.js.
//
// Varias proxies (pedido del dueño): YTDL_PROXY acepta una lista separada por
// comas y cada intento usa una al azar, así la carga se reparte y un reintento
// tras un 403 suele salir por otra. Cada elemento se pasa tal cual a yt-dlp
// (como siempre): no se le exige un formato nuevo a la que ya funcionaba.
function proxyList(raw) {
    return String(raw || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

function getTikTokProxy() {
    const proxies = proxyList(process.env.YTDL_PROXY);
    if (proxies.length === 0) throw new Error('Falta YTDL_PROXY en las variables de entorno (mismo proxy que usa YTDownloader)');
    return pickRandom(proxies);
}

// YouTube les pide "confirmar que no eres un bot" a las IP de centros de datos
// como la de Render, así que desde ahí casi ningún video se puede leer tal
// cual. Hay dos salidas, y las dos se configuran solo con variables de entorno:
//   YTDL_YOUTUBE_PROXY   'on' = usar también para YouTube el proxy de TikTok
//                        (YTDL_PROXY); o la URL de otro proxy. Un proxy
//                        residencial suele bastar.
//   YTDL_YOUTUBE_COOKIES_FILE  ruta a un cookies.txt (formato Netscape) de una
//                        cuenta de Google, p. ej. un Secret File de Render en
//                        /etc/secrets/. O YTDL_YOUTUBE_COOKIES con el contenido.
//                        Mejor una cuenta secundaria: YouTube puede bloquearla.
// yt-dlp reescribe el archivo de cookies al terminar, y un Secret File es de
// solo lectura: por eso se copia a un archivo temporal propio.
function prepareYouTubeCookies() {
    try {
        let content = process.env.YTDL_YOUTUBE_COOKIES || '';
        if (!content && process.env.YTDL_YOUTUBE_COOKIES_FILE) content = fs.readFileSync(process.env.YTDL_YOUTUBE_COOKIES_FILE, 'utf8');
        if (!content.trim()) return null;
        const file = path.join(require('os').tmpdir(), `tkc-yt-cookies-${process.pid}.txt`);
        fs.writeFileSync(file, content, { mode: 0o600 });
        console.log('[Downloader] YouTube usará las cookies configuradas.');
        return file;
    } catch (err) {
        console.error('[Downloader] No se pudieron leer las cookies de YouTube:', err.message);
        return null;
    }
}
const YOUTUBE_COOKIES_PATH = prepareYouTubeCookies();

// Cómo se interpreta YTDL_YOUTUBE_PROXY (YouTube bloquea las IP de centros
// de datos y también algunas proxies; por eso tiene su propia variable):
//  - una o varias proxies propias separadas por comas (se usa una al azar en
//    cada intento), con el mismo formato que YTDL_PROXY;
//  - on / true / 1 / sí / yes (sin importar mayúsculas) = las de TikTok;
//  - vacía = sin proxy. Un elemento que no parece una proxy (sin ':', p. ej.
//    "banana") se ignora con un aviso en el registro.
// Bug real anterior: solo valía 'on' exacto y cualquier otro texto se le
// pasaba a yt-dlp como dirección de proxy.
const TRUTHY = new Set(['on', 'true', '1', 'si', 'sí', 'yes']);
const looksLikeProxy = (entry) => entry.includes(':') && !/\s/.test(entry);
function youtubeProxyMode() {
    const raw = String(process.env.YTDL_YOUTUBE_PROXY || '').trim();
    if (!raw) return { mode: 'none', urls: [] };
    if (TRUTHY.has(raw.toLowerCase())) {
        const urls = proxyList(process.env.YTDL_PROXY);
        return urls.length ? { mode: 'tiktok', urls } : { mode: 'invalid', urls: [], reason: 'YTDL_YOUTUBE_PROXY pide las proxies de TikTok, pero YTDL_PROXY está vacío' };
    }
    const entries = proxyList(raw);
    const urls = entries.filter(looksLikeProxy);
    const ignored = entries.length - urls.length;
    if (urls.length === 0) return { mode: 'invalid', urls: [], reason: 'YTDL_YOUTUBE_PROXY no es "on" ni una lista de proxies (host:puerto o http://usuario:contraseña@host:puerto)' };
    return { mode: 'custom', urls, ignored };
}
{
    const proxy = youtubeProxyMode();
    if (proxy.mode === 'invalid') console.warn(`[Downloader] ${proxy.reason}: se ignora.`);
    if (proxy.ignored) console.warn(`[Downloader] YTDL_YOUTUBE_PROXY: se ignoran ${proxy.ignored} elemento(s) que no parecen una proxy.`);
    console.log(`[Downloader] TikTok: ${proxyList(process.env.YTDL_PROXY).length} proxy(s). YouTube: ${proxy.mode === 'tiktok' ? 'las de TikTok' : proxy.mode === 'custom' ? `${proxy.urls.length} propia(s)` : 'sin proxy'}, cookies ${YOUTUBE_COOKIES_PATH ? 'sí' : 'no'}.`);
}

// Lo que ve el servidor (para Sistema): sin secretos, solo si cada cosa está.
function youtubeConfigSummary() {
    const proxy = youtubeProxyMode();
    return {
        proxy: proxy.mode, proxyCount: proxy.urls.length, tiktokProxyCount: proxyList(process.env.YTDL_PROXY).length,
        proxyProblem: proxy.mode === 'invalid' ? proxy.reason : proxy.ignored ? `Se ignoran ${proxy.ignored} elemento(s) de YTDL_YOUTUBE_PROXY que no parecen una proxy` : null,
        cookies: !!YOUTUBE_COOKIES_PATH,
    };
}

let ytDlpVersion = null;
async function getYtDlpVersion() {
    if (ytDlpVersion) return ytDlpVersion;
    try { ytDlpVersion = String(await ytDlpWrap.getVersion()).trim(); } catch { ytDlpVersion = null; }
    return ytDlpVersion;
}

const _BROWSER_TARGETS = [
    'chrome-110', 'chrome-116', 'chrome-120',
    'chrome-131', 'edge-101', 'safari-15.5', 'safari-17.0',
];
function randomBrowserTarget() {
    return _BROWSER_TARGETS[Math.floor(Math.random() * _BROWSER_TARGETS.length)];
}

// Límites para que un uso abusivo (o un error) no llene el disco ni la CPU del
// servidor, que es compartido por todas las licencias. Se pueden ajustar con
// variables de entorno sin tocar el código.
const MAX_ACTIVE_JOBS_PER_LICENSE = 2;
const MAX_ACTIVE_JOBS_TOTAL = 6;
const MAX_FILESIZE = /^\d+[KMG]$/i.test(process.env.DOWNLOADER_MAX_FILESIZE || '') ? process.env.DOWNLOADER_MAX_FILESIZE : '1G';
const INFO_TIMEOUT_MS = 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const INFO_MAX_BUFFER = 8 * 1024 * 1024; // el JSON de un solo video pesa unos cientos de kB

// Lo que jamás debe llegar al navegador (el proxy lleva usuario y contraseña).
// Cada proxy de cada lista por separado: el error de yt-dlp trae solo la que usó.
const hiddenSecrets = () => [...proxyList(process.env.YTDL_PROXY), ...proxyList(process.env.YTDL_YOUTUBE_PROXY), process.env.YTDL_PROXY, process.env.YTDL_YOUTUBE_PROXY].filter(Boolean);

// ─────────────────────────────────────────────
// Jobs en memoria -- Node es de un solo hilo, así que a diferencia del
// threading.Lock() del lado Python no hace falta ningún lock acá: nunca hay
// dos callbacks tocando el Map al mismo tiempo de verdad.
// ─────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hora -- igual que JOB_TTL_SECONDS en el standalone
const DOWNLOAD_FILE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas -- igual que DOWNLOAD_FILE_TTL_SECONDS

function cleanupLoop() {
    const now = Date.now();

    for (const [jobId, job] of jobs) {
        if ((job.status === 'done' || job.status === 'error') && job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
            jobs.delete(jobId);
        }
    }

    // Barrido de DOWNLOAD_DIR por fecha de modificación directa (no por
    // job vivo) -- funciona igual si el proceso se reinició y perdió todo
    // lo que tenía en memoria. Estructura: DOWNLOAD_DIR/<licenseId>/<archivo>.
    try {
        for (const licenseDir of fs.readdirSync(DOWNLOAD_DIR, { withFileTypes: true })) {
            if (!licenseDir.isDirectory()) continue;
            const fullLicenseDir = path.join(DOWNLOAD_DIR, licenseDir.name);
            let remaining = 0;
            for (const entry of fs.readdirSync(fullLicenseDir, { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                const filePath = path.join(fullLicenseDir, entry.name);
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > DOWNLOAD_FILE_TTL_MS) {
                    fs.unlinkSync(filePath);
                } else {
                    remaining++;
                }
            }
            if (remaining === 0) fs.rmdirSync(fullLicenseDir);
        }
    } catch (e) {
        console.error('[Downloader] Error barriendo', DOWNLOAD_DIR, ':', e.message);
    }
}
setInterval(cleanupLoop, 5 * 60 * 1000); // cada 5 minutos, igual que el standalone

// ─────────────────────────────────────────────
// Intentos, proxies y reportes (pedido del dueño: "a veces funciona y a veces
// no; reintenta hasta 5 veces y que llegue el error real de yt-dlp")
// ─────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const STALL_MS = Number(process.env.DOWNLOADER_STALL_MS) || 75 * 1000; // sin avance en la descarga = se reintenta por otra IP

// Errores que no se arreglan reintentando (el video no existe para nadie, es
// privado, pesa demasiado...). Todo lo demás —bloqueos de YouTube, 403,
// cortes de red, una proxy caída— se reintenta, cada vez por otra proxy.
const PERMANENT_ERROR_RE = /Unsupported URL|Private video|has been removed|account (?:has been|was) terminated|members-only|Join this channel|File is larger than max-filesize|Requested format is not available|ffprobe and ffmpeg not found|Falta YTDL_PROXY/i;
const isPermanentError = (message) => PERMANENT_ERROR_RE.test(String(message || ''));

// ── Sesiones de una proxy rotativa (pedido del dueño) ──
// Una proxy rotativa da otra IP en cada petición. Para fijar una IP, los
// proveedores aceptan un identificador de sesión dentro del usuario o la
// contraseña (el formato cambia según el proveedor), así que la proxy se
// configura con {session} donde va ese identificador, p. ej.
//   http://usuario-session-{session}:clave@host:puerto
// Cada intento nuevo genera una sesión nueva = otra IP. Sin {session}, la
// proxy se usa tal cual (rota sola en cada petición, como siempre).
const SESSION_PLACEHOLDER_RE = /\{(session|sesion|sesión)\}/gi;
const newSessionId = () => crypto.randomBytes(6).toString('hex');
const withSession = (template, session) => template.replace(SESSION_PLACEHOLDER_RE, session);
const usesSessions = (template) => /\{(session|sesion|sesión)\}/i.test(template);

// Elige la proxy de un intento. `reuse` (la sesión con la que ya funcionó el
// análisis de este enlace) manda en el primer intento de la descarga; si no,
// una proxy al azar de la lista con una sesión nueva. Con varias proxies,
// nunca la misma que acaba de fallar.
function chooseProxy(list, { avoidIndex, reuse } = {}) {
    if (!list.length) return null;
    if (reuse && reuse.index < list.length && list[reuse.index] === reuse.template) {
        return { url: withSession(reuse.template, reuse.session), template: reuse.template, index: reuse.index, total: list.length, session: reuse.session, reused: true };
    }
    let index = Math.floor(Math.random() * list.length);
    if (list.length > 1 && index === avoidIndex) index = (index + 1) % list.length;
    const template = list[index];
    const session = usesSessions(template) ? newSessionId() : null;
    return { url: session ? withSession(template, session) : template, template, index, total: list.length, session, reused: false };
}
function proxyForAttempt(tiktok, { avoidIndex, reuse } = {}) {
    const list = tiktok ? proxyList(process.env.YTDL_PROXY) : youtubeProxyMode().urls;
    if (tiktok && list.length === 0) throw new Error('Falta YTDL_PROXY en las variables de entorno (mismo proxy que usa YTDownloader)');
    return chooseProxy(list, { avoidIndex, reuse });
}
// Para los reportes: qué proxy y qué sesión se usaron (nunca la dirección).
function proxyLabel(proxy) {
    if (!proxy) return 'sin proxy';
    const which = proxy.total > 1 ? `proxy ${proxy.index + 1} de ${proxy.total}` : 'proxy';
    if (!proxy.session) return `${which}, IP rotada`;
    return `${which}, sesión ${proxy.session}${proxy.reused ? ' (la misma IP del análisis)' : ''}`;
}

// La sesión con la que funcionó el análisis de un enlace, para que la
// descarga de ese mismo enlace salga por la misma IP. Por licencia y enlace,
// 15 minutos, y solo si la proxy usa {session} (si no, no hay IP que fijar).
const WORKING_SESSION_TTL_MS = 15 * 60 * 1000;
const workingSessions = new Map(); // `${licenseId}|${url}` -> { template, index, session, at }
function rememberWorkingSession(licenseId, url, proxy) {
    if (!licenseId || !proxy?.session) return;
    if (workingSessions.size > 1000) workingSessions.delete(workingSessions.keys().next().value);
    workingSessions.set(`${licenseId}|${url}`, { template: proxy.template, index: proxy.index, session: proxy.session, at: Date.now() });
}
function takeWorkingSession(licenseId, url) {
    const key = `${licenseId}|${url}`;
    const found = workingSessions.get(key);
    if (!found) return null;
    if (Date.now() - found.at > WORKING_SESSION_TTL_MS) { workingSessions.delete(key); return null; }
    return found;
}

// Proxy, huella de navegador (TikTok) y cookies (YouTube) de un intento.
function networkArgs(tiktok, proxy) {
    const args = [];
    if (proxy) args.push('--proxy', proxy.url);
    if (tiktok) args.push('--impersonate', randomBrowserTarget());
    else if (YOUTUBE_COOKIES_PATH) args.push('--cookies', YOUTUBE_COOKIES_PATH);
    return args;
}

// El texto real de yt-dlp, sin secretos: sus líneas ERROR (o, si no hay, el
// final de la salida), sin colores de terminal y sin las proxies.
function ytDlpErrorText(raw) {
    const text = redactSecrets(String(raw || ''), hiddenSecrets());
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const errors = lines.filter((line) => /^ERROR:/i.test(line));
    return (errors.length ? errors : lines.slice(-3)).join(' ').slice(0, 600) || 'yt-dlp terminó sin decir por qué';
}

// Sistema > Errores: el error real de yt-dlp con el detalle de cada intento.
// También se anota cuando algo funcionó tras fallar (así se ve qué proxy
// falla aunque al final el streamer haya podido descargar).
let reportIssue = () => {};
function setIssueReporter(fn) { reportIssue = typeof fn === 'function' ? fn : () => {}; }

function reportAttempts({ stage, tiktok, attempts, recoveredAt, licenseId }) {
    if (attempts.length === 0) return;
    const site = tiktok ? 'TikTok' : 'YouTube';
    const stageLabel = stage === 'info' ? 'Analizar enlace' : 'Descargar';
    const first = attempts[0].error;
    const message = recoveredAt
        ? `Downloader (${site}): funcionó al intento ${recoveredAt} de ${MAX_ATTEMPTS} — antes: ${first}`
        : `Downloader (${site}): falló tras ${attempts.length} intento(s) — ${attempts[attempts.length - 1].error}`;
    const detail = attempts.map((a) => `Intento ${a.n} (${a.proxy}): ${a.error}`).join('\n');
    try {
        reportIssue({ kind: 'downloader', message, stack: detail, context: `${stageLabel} · ${site}${recoveredAt ? ' · recuperado' : ''}` }, { licenseId });
    } catch { /* un reporte jamás debe afectar la descarga */ }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────
// Info (sin descargar)
// ─────────────────────────────────────────────
async function getVideoInfo(rawUrl, { licenseId = null } = {}) {
    const { url, tiktok } = parseDownloadUrl(rawUrl);
    const attempts = [];
    let lastError = null;
    let proxy = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            proxy = proxyForAttempt(tiktok, { avoidIndex: proxy?.index });
            const args = ['--dump-json', '--no-warnings', '--skip-download', '--no-check-certificates', '--no-playlist', '--playlist-items', '1', ...networkArgs(tiktok, proxy)];
            // Todo lo que va después de "--" es la URL, nunca una opción de yt-dlp.
            args.push('--', url);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS);
            let raw;
            try {
                raw = await ytDlpWrap.execPromise(args, { maxBuffer: INFO_MAX_BUFFER }, controller.signal);
            } finally {
                clearTimeout(timer);
            }
            const info = JSON.parse(raw);
            const formats = info.formats || [];

            let heights;
            if (tiktok) {
                const clean = formats.filter((f) => (
                    !(f.format_note || '').toLowerCase().includes('watermark')
                    && !(f.format_id || '').toLowerCase().includes('download')
                ));
                heights = [...new Set(clean.map((f) => f.height).filter((h) => h && h >= 240))].sort((a, b) => b - a);
            } else {
                heights = [...new Set(formats.map((f) => f.height).filter((h) => h && h >= 360))].sort((a, b) => b - a);
            }

            let thumb = info.thumbnail;
            if (!thumb && info.thumbnails?.length) thumb = info.thumbnails[info.thumbnails.length - 1]?.url;

            reportAttempts({ stage: 'info', tiktok, attempts, recoveredAt: attempt, licenseId });
            rememberWorkingSession(licenseId, url, proxy);
            return {
                title: info.title || 'Sin título',
                thumbnail: thumb || '',
                duration: info.duration_string || String(info.duration || '?'),
                channel: info.uploader || info.channel || '—',
                heights: heights.slice(0, 6),
                isTikTok: tiktok,
            };
        } catch (e) {
            lastError = e.message || String(e);
            attempts.push({ n: attempt, proxy: proxyLabel(proxy), error: ytDlpErrorText(lastError) });
            console.warn(`[Downloader] Analizar (${tiktok ? 'TikTok' : 'YouTube'}) intento ${attempt}/${MAX_ATTEMPTS} con ${proxyLabel(proxy)} falló: ${attempts[attempts.length - 1].error}`);
            if (isPermanentError(lastError) || attempt === MAX_ATTEMPTS) break;
            await pause(800 + Math.random() * 1200);
        }
    }
    reportAttempts({ stage: 'info', tiktok, attempts, recoveredAt: null, licenseId });
    if (isYouTubeBotCheck(lastError)) throw new Error(YOUTUBE_BOT_CHECK_MESSAGE);
    throw new Error(`No se pudo obtener la información del video tras ${attempts.length} intento(s). Detalle: ${friendlyDownloaderError(lastError, hiddenSecrets())}`);
}

// ─────────────────────────────────────────────
// yt-dlp args builders -- mismos formatos que el proyecto standalone.
// ─────────────────────────────────────────────
function buildArgs({ url, fmt, quality, outTmpl, tiktok, proxy }) {
    const args = [
        '-o', outTmpl,
        '--ffmpeg-location', ffmpegPath,
        '--no-warnings',
        '--no-check-certificates',
        '--retries', '5',
        '--fragment-retries', '5',
        '--no-playlist', '--playlist-items', '1',
        '--max-filesize', MAX_FILESIZE,
        ...networkArgs(tiktok, proxy),
    ];
    if (!tiktok) args.push('--concurrent-fragments', '5');

    if (fmt === 'mp3') {
        args.push(
            '-f', tiktok
                ? "bestaudio[format_note!*=watermark][format_id!*=download]/bestaudio/best"
                : 'bestaudio/best',
            '-x', '--audio-format', 'mp3', '--audio-quality', quality,
        );
    } else if (tiktok) {
        args.push(
            '-f',
            "bestvideo[format_id!*=download][format_note!*=watermark]+bestaudio[format_note!*=watermark]/"
            + "best[format_id=play_addr_h264]/best[format_id=play_addr]/best",
            '--merge-output-format', 'mp4',
            '-S', 'res,vcodec:h264,acodec:aac',
        );
    } else {
        const heightFilter = quality === 'best' ? '' : `[height<=${quality}]`;
        args.push(
            '-f',
            `bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]/best${heightFilter}[ext=mp4]/best`,
            '--merge-output-format', 'mp4',
        );
    }

    // Todo lo que va después de "--" es la URL, nunca una opción de yt-dlp.
    args.push('--', url);
    return args;
}

// ─────────────────────────────────────────────
// Descarga con reintentos: hasta MAX_ATTEMPTS, cada intento por otra proxy,
// salvo los errores que no se arreglan reintentando (ver isPermanentError).
// ─────────────────────────────────────────────
function activeJobCounts(licenseId) {
    let forLicense = 0;
    let total = 0;
    for (const job of jobs.values()) {
        if (job.status !== 'queued' && job.status !== 'downloading') continue;
        total++;
        if (job.licenseId === licenseId) forLicense++;
    }
    return { forLicense, total };
}

function startDownload({ licenseId, url: rawUrl, fmt, quality }) {
    const { url, tiktok } = parseDownloadUrl(rawUrl);
    const active = activeJobCounts(licenseId);
    checkDownloadCapacity(active.forLicense, active.total, { perLicense: MAX_ACTIVE_JOBS_PER_LICENSE, total: MAX_ACTIVE_JOBS_TOTAL });
    const jobId = crypto.randomUUID();
    const licenseDir = path.join(DOWNLOAD_DIR, licenseId);
    fs.mkdirSync(licenseDir, { recursive: true });

    jobs.set(jobId, {
        licenseId,
        status: 'queued',
        percent: 0,
        speed: '—',
        eta: '—',
        filename: null,
        title: null,
        error: null,
        finishedAt: null,
        attempts: [], // { n, proxy, error } de cada intento fallido (ver reportAttempts)
        proxy: null,
        // La IP con la que funcionó el análisis de este enlace: el primer
        // intento de la descarga sale por ella; los reintentos, por otra.
        reuse: takeWorkingSession(licenseId, url),
    });

    runDownloadAttempt(jobId, licenseDir, url, fmt, quality, tiktok, 1);
    return jobId;
}

function runDownloadAttempt(jobId, licenseDir, url, fmt, quality, tiktok, attempt) {
    const job = jobs.get(jobId);
    if (!job) return;
    let args;
    try {
        job.proxy = proxyForAttempt(tiktok, { avoidIndex: job.proxy?.index, reuse: attempt === 1 ? job.reuse : null });
        const outTmpl = path.join(licenseDir, `${jobId}.%(ext)s`);
        args = buildArgs({ url, fmt, quality, outTmpl, tiktok, proxy: job.proxy });
    } catch (err) {
        handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, err);
        return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        const current = jobs.get(jobId);
        if (current) current.timedOut = true;
        controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);
    // Una IP residencial a veces se queda colgada a mitad de la descarga: si
    // pasa STALL_MS sin ningún avance, se corta este intento y se reintenta
    // con otra sesión (otra IP), en vez de esperar al límite de 30 minutos.
    job.stalled = false;
    let lastProgressAt = Date.now();
    const stallWatch = setInterval(() => {
        if (Date.now() - lastProgressAt < STALL_MS) return;
        clearInterval(stallWatch);
        const current = jobs.get(jobId);
        if (current) current.stalled = true;
        controller.abort();
    }, 5000);
    const stopWatches = () => { clearTimeout(timeout); clearInterval(stallWatch); };

    ytDlpWrap.exec(args, {}, controller.signal)
        .on('progress', (p) => {
            lastProgressAt = Date.now();
            const current = jobs.get(jobId);
            if (!current) return;
            current.status = 'downloading';
            current.percent = Math.round(p.percent || 0);
            current.speed = p.currentSpeed || '—';
            current.eta = p.eta || '—';
        })
        .on('error', (err) => {
            stopWatches();
            // Cortado por nosotros (sin avance o límite de tiempo): según el
            // sistema llega como error del proceso ("Error code: 1") en vez de
            // un cierre; se reporta el motivo real.
            const current = jobs.get(jobId);
            let reason = err;
            if (current?.timedOut) reason = new Error(`Se canceló tras ${Math.round(DOWNLOAD_TIMEOUT_MS / 60000)} min sin terminar`);
            else if (current?.stalled) reason = new Error(`La descarga se quedó ${Math.round(STALL_MS / 1000)} s sin avanzar (IP lenta o caída)`);
            handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, reason);
        })
        .on('close', () => {
            stopWatches();
            const current = jobs.get(jobId);
            if (!current || current.status === 'error' || current.retrying) return;
            if (current.stalled && !current.timedOut) {
                handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, new Error(`La descarga se quedó ${Math.round(STALL_MS / 1000)} s sin avanzar (IP lenta o caída)`));
                return;
            }
            if (current.timedOut) {
                current.status = 'error';
                current.error = 'La descarga tardó demasiado y se canceló. Prueba con un video más corto o con menor calidad.';
                current.finishedAt = Date.now();
                current.attempts.push({ n: attempt, proxy: proxyLabel(current.proxy), error: `Se canceló tras ${Math.round(DOWNLOAD_TIMEOUT_MS / 60000)} min sin terminar` });
                reportAttempts({ stage: 'download', tiktok, attempts: current.attempts, recoveredAt: null, licenseId: current.licenseId });
                return;
            }
            // yt-dlp ya terminó (incluyendo el merge/extracción de audio de
            // ffmpeg, que corre DENTRO del mismo proceso) -- buscamos el
            // archivo que acaba de generar por su prefijo (el jobId es
            // único, así que no hay ambigüedad posible con otros jobs).
            const ext = fmt === 'mp3' ? 'mp3' : 'mp4';
            const expected = path.join(licenseDir, `${jobId}.${ext}`);
            let finalPath = fs.existsSync(expected) ? expected : null;
            if (!finalPath) {
                const candidates = fs.readdirSync(licenseDir)
                    .filter((f) => f.startsWith(`${jobId}.`) && !f.endsWith('.part'))
                    .map((f) => path.join(licenseDir, f));
                finalPath = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
            }
            if (!finalPath) {
                current.status = 'error';
                current.error = 'La descarga terminó sin generar el archivo: el video puede ser demasiado grande o no estar disponible.';
                current.finishedAt = Date.now();
                current.attempts.push({ n: attempt, proxy: proxyLabel(current.proxy), error: 'yt-dlp terminó sin error pero no dejó archivo' });
                reportAttempts({ stage: 'download', tiktok, attempts: current.attempts, recoveredAt: null, licenseId: current.licenseId });
                return;
            }
            current.status = 'done';
            current.percent = 100;
            current.filename = path.basename(finalPath);
            current.filePath = finalPath;
            current.finishedAt = Date.now();
            reportAttempts({ stage: 'download', tiktok, attempts: current.attempts, recoveredAt: attempt, licenseId: current.licenseId });
        });
}

function handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, err) {
    const job = jobs.get(jobId);
    if (!job) return;
    const message = (err?.message || String(err) || '').trim();
    job.attempts.push({ n: attempt, proxy: proxyLabel(job.proxy), error: ytDlpErrorText(message) });
    console.warn(`[Downloader] Descargar (${tiktok ? 'TikTok' : 'YouTube'}) intento ${attempt}/${MAX_ATTEMPTS} con ${proxyLabel(job.proxy)} falló: ${job.attempts[job.attempts.length - 1].error}`);

    if (attempt < MAX_ATTEMPTS && !isPermanentError(message) && !job.timedOut) {
        job.status = 'downloading';
        job.retrying = true;
        job.percent = 0;
        job.speed = `Reintentando... (${attempt + 1}/${MAX_ATTEMPTS})`;
        setTimeout(() => {
            const current = jobs.get(jobId);
            if (!current) return;
            current.retrying = false;
            runDownloadAttempt(jobId, licenseDir, url, fmt, quality, tiktok, attempt + 1);
        }, 1200 + Math.random() * 1800);
        return;
    }

    job.status = 'error';
    job.speed = '—';
    job.eta = '—';
    job.finishedAt = Date.now();
    reportAttempts({ stage: 'download', tiktok, attempts: job.attempts, recoveredAt: null, licenseId: job.licenseId });
    if (isYouTubeBotCheck(message)) { job.error = YOUTUBE_BOT_CHECK_MESSAGE; return; }
    job.error = `No se pudo descargar tras ${attempt} intento(s). Detalle: ${friendlyDownloaderError(message, hiddenSecrets())}`;
}

function getJob(jobId) {
    return jobs.get(jobId) || null;
}

module.exports = { getVideoInfo, startDownload, getJob, youtubeConfigSummary, getYtDlpVersion, setIssueReporter };
