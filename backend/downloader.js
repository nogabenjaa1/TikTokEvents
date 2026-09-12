// ==========================================
// DOWNLOADER: descarga videos de YouTube/TikTok (sin marca de agua) vía
// yt-dlp -- herramienta exclusiva de planes pagos (ver auth.requirePaidPlan
// en server.js). Puerto Node de la lógica ya probada en el proyecto
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

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const YTDLP_BIN_PATH = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpWrap = new YTDlpWrap(YTDLP_BIN_PATH);

// Igual que TIKTOK_PROXY en el proyecto standalone, pero SIN fallback
// hardcodeado -- ese default ya había quedado expuesto en el historial de
// ese OTRO repo antes de que lo tocáramos; acá, en un archivo nuevo, no hay
// ninguna razón para repetir el mismo error. Falla claro si falta, mismo
// criterio que getMpAccessToken() en server.js.
function getTikTokProxy() {
    const proxy = process.env.YTDL_PROXY;
    if (!proxy) throw new Error('Falta YTDL_PROXY en las variables de entorno (mismo proxy que usa YTDownloader)');
    return proxy;
}

const _BROWSER_TARGETS = [
    'chrome-110', 'chrome-116', 'chrome-120',
    'chrome-131', 'edge-101', 'safari-15.5', 'safari-17.0',
];
function randomBrowserTarget() {
    return _BROWSER_TARGETS[Math.floor(Math.random() * _BROWSER_TARGETS.length)];
}

const TIKTOK_RE = /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i;
function isTikTok(url) {
    return TIKTOK_RE.test(url);
}

// Elimina parámetros de rastreo que causan Error 403 en TikTok (mismo
// criterio que clean_url en el proyecto standalone).
function cleanUrl(url) {
    if (isTikTok(url) && url.includes('?')) return url.split('?')[0];
    return url;
}

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
// Info (sin descargar)
// ─────────────────────────────────────────────
async function getVideoInfo(rawUrl) {
    const url = cleanUrl(rawUrl);
    if (!url) throw new Error('URL requerida');

    const tiktok = isTikTok(url);
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const args = [url, '--dump-json', '--no-warnings', '--skip-download', '--no-check-certificates'];
            if (tiktok) {
                args.push('--proxy', getTikTokProxy(), '--impersonate', randomBrowserTarget());
            }
            const raw = await ytDlpWrap.execPromise(args);
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
            if (/403|404|Forbidden/.test(lastError)) {
                await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
                continue;
            }
            break;
        }
    }
    throw new Error(`No se pudo extraer información tras ${maxRetries} intentos. Detalle: ${lastError}`);
}

// ─────────────────────────────────────────────
// yt-dlp args builders -- mismos formatos que el proyecto standalone.
// ─────────────────────────────────────────────
function buildArgs({ url, fmt, quality, outTmpl, tiktok }) {
    const args = [
        url,
        '-o', outTmpl,
        '--ffmpeg-location', ffmpegPath,
        '--no-warnings',
        '--no-check-certificates',
        '--retries', '5',
        '--fragment-retries', '5',
    ];

    if (tiktok) {
        args.push('--proxy', getTikTokProxy(), '--impersonate', randomBrowserTarget());
    } else {
        args.push('--concurrent-fragments', '5');
    }

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

    return args;
}

// ─────────────────────────────────────────────
// Descarga con auto-retry -- mismo criterio que download_worker en el
// standalone: reintenta en 403/404/Forbidden, se rinde con cualquier otro
// error.
// ─────────────────────────────────────────────
function startDownload({ licenseId, url: rawUrl, fmt, quality }) {
    const url = cleanUrl(rawUrl);
    const jobId = crypto.randomUUID();
    const tiktok = isTikTok(url);
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
    });

    runDownloadWithRetry(jobId, licenseDir, url, fmt, quality, tiktok, 0);
    return jobId;
}

const MAX_RETRIES = 4;

function runDownloadWithRetry(jobId, licenseDir, url, fmt, quality, tiktok, attempt) {
    const outTmpl = path.join(licenseDir, `${jobId}.%(ext)s`);
    const args = buildArgs({ url, fmt, quality, outTmpl, tiktok });
    const attemptStart = Date.now();

    ytDlpWrap.exec(args)
        .on('progress', (p) => {
            const job = jobs.get(jobId);
            if (!job) return;
            job.status = 'downloading';
            job.percent = Math.round(p.percent || 0);
            job.speed = p.currentSpeed || '—';
            job.eta = p.eta || '—';
        })
        .on('error', (err) => handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, err))
        .on('close', () => {
            const job = jobs.get(jobId);
            if (!job) return;
            // yt-dlp ya terminó (incluyendo el merge/extracción de audio de
            // ffmpeg, que corre DENTRO del mismo proceso) -- buscamos el
            // archivo que acaba de generar por su prefijo (el jobId es
            // único, así que no hay ambigüedad posible con otros jobs).
            const ext = fmt === 'mp3' ? 'mp3' : 'mp4';
            const expected = path.join(licenseDir, `${jobId}.${ext}`);
            let finalPath = fs.existsSync(expected) ? expected : null;
            if (!finalPath) {
                const candidates = fs.readdirSync(licenseDir)
                    .filter((f) => f.startsWith(`${jobId}.`))
                    .map((f) => path.join(licenseDir, f));
                finalPath = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
            }
            if (!finalPath) {
                job.status = 'error';
                job.error = 'La descarga terminó pero no se encontró el archivo generado.';
                job.finishedAt = Date.now();
                return;
            }
            job.status = 'done';
            job.percent = 100;
            job.filename = path.basename(finalPath);
            job.filePath = finalPath;
            job.finishedAt = Date.now();
        });

    void attemptStart; // reservado por si se necesita en el futuro para desambiguar candidatos
}

function handleAttemptError(jobId, licenseDir, url, fmt, quality, tiktok, attempt, err) {
    const job = jobs.get(jobId);
    if (!job) return;
    const message = (err?.message || String(err) || '').trim();

    if (attempt + 1 < MAX_RETRIES && /403|404|Forbidden/.test(message)) {
        job.status = 'downloading';
        job.speed = `Reintentando... (${attempt + 2}/${MAX_RETRIES})`;
        setTimeout(() => runDownloadWithRetry(jobId, licenseDir, url, fmt, quality, tiktok, attempt + 1), 1500 + Math.random() * 2000);
        return;
    }

    console.error(`[Downloader] Job ${jobId} falló:`, message);
    job.status = 'error';
    job.error = `Bloqueado tras ${attempt + 1} intento(s). Detalle: ${message}`;
    job.finishedAt = Date.now();
}

function getJob(jobId) {
    return jobs.get(jobId) || null;
}

module.exports = { getVideoInfo, startDownload, getJob, isTikTok, cleanUrl, YTDLP_BIN_PATH };
