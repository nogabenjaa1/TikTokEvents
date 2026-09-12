// ==========================================
// DOWNLOADER — herramienta de streamers para bajar un video/audio (TikTok,
// YouTube y +1000 sitios más vía yt-dlp) y quedarse con un link temporal.
//
// Basado en el proyecto de referencia YTDownloader (Flask + yt_dlp en
// Python) que ya tenía resuelto lo difícil: selección de formato sin marca
// de agua para TikTok, proxy + impersonate para esquivar el bloqueo 403 de
// TikTok, y reintentos automáticos. Acá se replica esa MISMA lógica pero
// shelleando al binario real de yt-dlp (ver yt-dlp-exec) en vez de
// depender de un proceso Python aparte -- así el backend sigue siendo un
// único servicio Node, deployable en Render sin nada adicional.
//
// Por qué no tocar disco de forma permanente: igual que storage.js
// (Alertas), el filesystem de Render no sobrevive a un redeploy/reinicio.
// Cada descarga se escribe en un directorio temporal (os.tmpdir()), se sube
// al bucket 'downloader-files' de Supabase Storage, y el temporal se borra
// enseguida -- el archivo real vive en Supabase, con TTL propio (ver
// DOWNLOADER_TTL_MS y cleanupExpiredFiles, llamado desde server.js tanto
// perezosamente como por un setInterval periódico).
// ==========================================
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const ytDlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');

const db = require('./db');
const storage = require('./storage');

const DOWNLOADER_BUCKET = 'downloader-files';

// Pedido explícito: cada archivo del Downloader se borra solo a las 2 horas
// de generado, se haya vuelto a mirar o no (ver cleanupExpiredFiles).
const DOWNLOADER_TTL_MS = 2 * 60 * 60 * 1000;

// Proxy dedicado para TikTok (mismo criterio que el proyecto de referencia:
// TikTok bloquea la IP del datacenter de Render con 403 sin un proxy
// residencial de por medio). A propósito NO hay un valor por defecto
// hardcodeado acá -- a diferencia del script de referencia (uso personal,
// de un solo dueño), este backend es multi-tenant y las credenciales de un
// proxy pago no van en el código fuente. Sin configurar, TikTok puede
// funcionar igual para algunos videos, pero es más propenso a 403.
const TIKTOK_PROXY = process.env.YTDL_TIKTOK_PROXY || '';

// NOTA de despliegue sobre `impersonate` (arriba/abajo): el binario de
// yt-dlp que yt-dlp-exec baja en Linux por default (asset "yt-dlp" a
// secas) necesita Python 3 en el host -- Render lo trae de fábrica en su
// runtime nativo de Node (Debian 12, python3 incluido en build Y en
// runtime), así que la descarga en sí debería andar sin nada extra. Lo que
// Python NO trae solo instalado es `curl_cffi`, la lib que yt-dlp usa para
// impersonate -- sin ella, específicamente TikTok puede fallar con un
// error de "impersonate target no disponible" aunque YouTube/el resto de
// los sitios (que no usan impersonate) sigan funcionando bien. Si pasa eso
// en producción, la solución es un build command extra en Render
// (`pip3 install curl_cffi`) o apuntar YOUTUBE_DL_FILENAME a un binario
// standalone (yt-dlp_linux) que ya la trae empaquetada.

const BROWSER_TARGETS = [
    'chrome-110', 'chrome-116', 'chrome-120',
    'chrome-131', 'edge-101', 'safari-15.5', 'safari-17.0',
];

const TIKTOK_RE = /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i;
const isTikTok = (url) => TIKTOK_RE.test(url);

// TikTok castiga los parámetros de rastreo (?_r=..., ?u_code=...) con 403 --
// el link "Compartir" de la app siempre trae varios.
function cleanUrl(url) {
    if (isTikTok(url) && url.includes('?')) return url.split('?')[0];
    return url;
}

function randomTarget() {
    return BROWSER_TARGETS[Math.floor(Math.random() * BROWSER_TARGETS.length)];
}

// Jobs en memoria (progreso de una descarga en curso) -- se pierden si el
// backend reinicia, igual que en el script de referencia; no hace falta
// persistirlos porque ya son de por sí efímeros (un streamer no necesita
// ver el progreso de una descarga de una sesión de servidor anterior). Lo
// que SÍ se persiste es el archivo terminado (ver db.insertDownloaderFile).
const jobs = new Map();

function setJob(jobId, data) {
    jobs.set(jobId, { ...jobs.get(jobId), ...data });
}

function getJob(jobId) {
    return jobs.get(jobId) || null;
}

// Los jobs ya resueltos (done/error) no hace falta guardarlos en memoria
// para siempre -- se limpian solos a los 10 minutos de terminar (tiempo de
// sobra para que el frontend haga el último poll y muestre el resultado).
const JOB_MEMORY_TTL_MS = 10 * 60 * 1000;
function scheduleJobForgetting(jobId) {
    setTimeout(() => jobs.delete(jobId), JOB_MEMORY_TTL_MS).unref();
}

function baseArgs({ useProxy }) {
    const args = {
        noWarnings: true,
        noCheckCertificate: true,
        retries: 5,
        fragmentRetries: 5,
        noPlaylist: true,
        restrictFilenames: true,
        ffmpegLocation: ffmpegPath,
    };
    if (useProxy && TIKTOK_PROXY) args.proxy = TIKTOK_PROXY;
    return args;
}

function formatArgsFor(url, format, quality, target) {
    const tiktok = isTikTok(url);
    const args = baseArgs({ useProxy: tiktok });
    if (tiktok) args.impersonate = target;

    if (format === 'mp3') {
        Object.assign(args, {
            format: tiktok
                ? 'bestaudio[format_note!*=watermark][format_id!*=download]/bestaudio/best'
                : 'bestaudio/best',
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: quality || '0',
        });
    } else if (tiktok) {
        Object.assign(args, {
            format: (
                'bestvideo[format_id!*=download][format_note!*=watermark]' +
                '+bestaudio[format_note!*=watermark]/' +
                'best[format_id=play_addr_h264]/best[format_id=play_addr]/best'
            ),
            mergeOutputFormat: 'mp4',
            formatSort: 'res,vcodec:h264,acodec:aac',
        });
    } else {
        const heightFilter = quality && quality !== 'best' ? `[height<=${quality}]` : '';
        Object.assign(args, {
            format: `bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]/best${heightFilter}[ext=mp4]/best`,
            mergeOutputFormat: 'mp4',
        });
    }
    return args;
}

// Extrae metadata sin descargar (preview antes de elegir formato/calidad) --
// mismo endpoint que /api/info en el script de referencia.
async function fetchInfo(rawUrl) {
    const url = cleanUrl(String(rawUrl || '').trim());
    if (!url) throw new Error('URL requerida');
    const tiktok = isTikTok(url);
    const target = randomTarget();
    const args = { ...baseArgs({ useProxy: tiktok }), dumpSingleJson: true, skipDownload: true };
    if (tiktok) args.impersonate = target;

    const info = await ytDlp(url, args);

    const formats = Array.isArray(info.formats) ? info.formats : [];
    let heights;
    if (tiktok) {
        const clean = formats.filter((f) =>
            !/watermark/i.test(f.format_note || '') && !/download/i.test(f.format_id || ''));
        heights = [...new Set(clean.map((f) => f.height).filter((h) => h && h >= 240))].sort((a, b) => b - a);
    } else {
        heights = [...new Set(formats.map((f) => f.height).filter((h) => h && h >= 360))].sort((a, b) => b - a);
    }

    const thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails.length
        ? info.thumbnails[info.thumbnails.length - 1].url
        : '');

    return {
        title: info.title || 'Sin título',
        thumbnail: thumbnail || '',
        duration: info.duration_string || String(info.duration || '?'),
        channel: info.uploader || info.channel || '—',
        heights: heights.slice(0, 6),
        isTikTok: tiktok,
    };
}

// Descarga real: corre en un directorio temporal propio del job, sube el
// resultado a Supabase Storage y registra la fila en la DB. Todo async /
// fire-and-forget desde el caller (server.js) -- el progreso se consulta
// por polling via getJob(jobId).
async function startDownload({ licenseId, url: rawUrl, format, quality }) {
    const url = cleanUrl(String(rawUrl || '').trim());
    if (!url) throw new Error('URL requerida');
    const finalFormat = format === 'mp3' ? 'mp3' : 'mp4';

    const jobId = crypto.randomUUID();
    setJob(jobId, {
        licenseId, status: 'queued', percent: 0, speed: '—', eta: '—',
        error: null, fileId: null, title: null,
    });

    runDownload(jobId, licenseId, url, finalFormat, quality).catch((err) => {
        console.error(`[Downloader] Job ${jobId} falló de forma inesperada:`, err.message);
        setJob(jobId, { status: 'error', error: err.message });
        scheduleJobForgetting(jobId);
    });

    return jobId;
}

// Sube uno de los archivos que yt-dlp dejó en `dir` (el más nuevo -- yt-dlp
// puede dejar restos de un merge intermedio) y devuelve su path/URL/tamaño.
async function uploadResult(dir, licenseId, jobId, ext) {
    const entries = fs.readdirSync(dir)
        .map((name) => ({ name, full: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
        .filter((entry) => entry.stat.isFile())
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (entries.length === 0) throw new Error('yt-dlp no generó ningún archivo de salida');

    const picked = entries.find((entry) => entry.name.endsWith(`.${ext}`)) || entries[0];
    const buffer = fs.readFileSync(picked.full);
    const storagePath = `${licenseId}/${jobId}.${ext}`;
    const contentType = ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    const fileUrl = await storage.uploadFile(storagePath, buffer, contentType, DOWNLOADER_BUCKET);
    return { storagePath, fileUrl, size: buffer.length };
}

async function runDownload(jobId, licenseId, url, format, quality) {
    const ext = format === 'mp3' ? 'mp3' : 'mp4';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloader-'));
    const outputTemplate = path.join(tmpDir, '%(title).100s.%(ext)s');

    const maxRetries = 4;
    let lastError = null;
    let title = null;

    try {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const target = randomTarget();
            const args = { ...formatArgsFor(url, format, quality, target), output: outputTemplate, newline: true };

            setJob(jobId, { status: 'downloading', percent: 0, speed: '—', eta: '—' });

            try {
                // .exec() (no el wrapper por default) para poder leer el
                // stdout EN VIVO y actualizar el progreso -- el wrapper
                // normal solo devuelve todo junto cuando el proceso termina.
                const subprocess = ytDlp.exec(url, args);
                attachProgressParser(subprocess, jobId);
                const { stdout } = await subprocess;

                const titleMatch = stdout.match(/\[download\] Destination: (.+)/) || stdout.match(/^(.+) has already been downloaded/m);
                title = titleMatch ? path.basename(titleMatch[1], path.extname(titleMatch[1])) : null;

                const { storagePath, fileUrl, size } = await uploadResult(tmpDir, licenseId, jobId, ext);

                const fileId = crypto.randomUUID();
                const now = Date.now();
                await db.insertDownloaderFile({
                    id: fileId, licenseId, sourceUrl: url, title, format,
                    filePath: storagePath, fileUrl, fileSizeBytes: size,
                    createdAt: now, expiresAt: now + DOWNLOADER_TTL_MS,
                });

                setJob(jobId, { status: 'done', percent: 100, speed: '—', eta: '—', fileId, title, fileUrl });
                scheduleJobForgetting(jobId);
                return;
            } catch (err) {
                lastError = (err.shortMessage || err.message || String(err)).trim();
                const retriable = /403|404|forbidden/i.test(lastError);
                if (retriable && attempt < maxRetries - 1) {
                    setJob(jobId, { status: 'downloading', speed: `Reintentando... (${attempt + 1}/${maxRetries})` });
                    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 2000));
                    continue;
                }
                throw err;
            }
        }
    } catch (err) {
        console.error(`[Downloader] Job ${jobId} error:`, lastError || err.message);
        setJob(jobId, { status: 'error', error: `No se pudo descargar tras varios intentos. Detalle: ${lastError || err.message}` });
        scheduleJobForgetting(jobId);
    } finally {
        fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    }
}

// yt-dlp con --newline imprime una línea de progreso por chunk, del estilo:
// "[download]  42.3% of   10.00MiB at  1.20MiB/s ETA 00:07". Se parsea a
// mano en vez de sumar una dependencia -- es una sola regex.
const PROGRESS_RE = /\[download\]\s+([\d.]+)% of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/;
function attachProgressParser(subprocess, jobId) {
    let buffer = '';
    subprocess.stdout?.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r|\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            const match = line.match(PROGRESS_RE);
            if (match) {
                setJob(jobId, { status: 'downloading', percent: Math.round(parseFloat(match[1])), speed: match[2], eta: match[3] });
            } else if (/\[(Merger|ExtractAudio|FixupM3u8|VideoConvertor)\]/.test(line)) {
                setJob(jobId, { status: 'processing', percent: 99, speed: '—', eta: '—' });
            }
        }
    });
}

// Borra (bucket + fila) todos los archivos ya vencidos de CUALQUIER
// licencia -- pensado para el setInterval periódico de server.js. También
// se puede llamar acotado a una sola licencia (ver listDownloaderFiles +
// filter) para la limpieza perezosa al refrescar el panel.
async function cleanupExpiredFiles(rows = null) {
    const expired = rows || await db.listExpiredDownloaderFiles();
    for (const row of expired) {
        await storage.deleteFile(row.file_path, DOWNLOADER_BUCKET);
        await db.deleteDownloaderFile(row.id);
    }
    return expired.length;
}

module.exports = {
    DOWNLOADER_BUCKET,
    DOWNLOADER_TTL_MS,
    isTikTok,
    fetchInfo,
    startDownload,
    getJob,
    cleanupExpiredFiles,
};
