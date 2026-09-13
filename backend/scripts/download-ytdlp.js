// Descarga el binario standalone de yt-dlp (necesario para el Downloader,
// ver downloader.js) a backend/bin/ -- yt-dlp-wrap-plus NO lo trae
// incluido, hay que bajarlo aparte. Se corre en cada `npm install` (ver
// postinstall en package.json) para que el build de Render también lo
// tenga: `downloadFromGithub` detecta la plataforma actual sola (Linux en
// Render, Windows en desarrollo local) y baja el binario correcto para
// cada una, sin que haga falta lógica propia acá.
//
// Nunca debe romper un `npm install` (mismo criterio que
// patch-tiktok-live-connector.js): si la descarga falla (sin red, GitHub
// caído, etc.), solo avisa por consola -- el Downloader va a fallar recién
// cuando alguien lo use, con un error claro, en vez de tirar abajo todo el
// deploy por una herramienta que es opcional para el resto del sitio.
const fs = require('fs');
const path = require('path');
const YTDlpWrap = require('yt-dlp-wrap-plus').default;

const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function main() {
    if (fs.existsSync(BIN_PATH)) {
        console.log('[download-ytdlp] Ya existe', BIN_PATH, '— nada que descargar.');
        return;
    }
    fs.mkdirSync(BIN_DIR, { recursive: true });
    try {
        console.log('[download-ytdlp] Descargando binario de yt-dlp...');
        await YTDlpWrap.downloadFromGithub(BIN_PATH);
        if (process.platform !== 'win32') fs.chmodSync(BIN_PATH, 0o755);
        console.log('[download-ytdlp] Listo:', BIN_PATH);
    } catch (e) {
        console.warn('[download-ytdlp] No se pudo descargar yt-dlp -- el Downloader no va a funcionar hasta que se resuelva. Detalle:', e.message);
    }
}

main();
