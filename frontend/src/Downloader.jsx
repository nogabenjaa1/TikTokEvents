import { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';

// ─────────────────────────────────────────────
// DOWNLOADER — herramienta más para streamers: bajar un video/audio de
// TikTok, YouTube y +1000 sitios más (vía yt-dlp del lado del backend, ver
// downloader.js) y quedarse con un link temporal. Cada archivo generado
// vive 2 horas y después se borra solo (ver expiresAt) — el countdown de
// abajo es puramente informativo, la limpieza real la hace el backend
// (perezosa al refrescar + una barrida periódica propia), así que un
// archivo puede desaparecer de esta lista sola sin que nadie haga nada.
// Mismo patrón que Spotify.jsx: sin socket, todo por REST + polling.
// ─────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatRemaining(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Vencido';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Downloader() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [infoError, setInfoError] = useState(null);
  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('best');

  const [, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [, forceTick] = useState(0);

  // Separado de refreshFiles (el que usa el botón "Actualizar"): éste no
  // marca `loadingFiles` de forma síncrona, para poder llamarlo directo
  // desde el useEffect de montaje sin el típico problema de "setState
  // síncrono dentro de un efecto" (loadingFiles ya arranca en `true`).
  const fetchFiles = async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/downloader/files`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setFiles(data.files);
    } finally {
      setLoadingFiles(false);
    }
  };

  const refreshFiles = () => {
    setLoadingFiles(true);
    fetchFiles();
  };

  useEffect(() => { fetchFiles(); }, []);

  // Refresca el countdown de "vence en..." cada minuto sin volver a pedirle
  // la lista al backend — un archivo que ya venció ahí simplemente
  // desaparece en el próximo refresh manual/al reabrir el panel.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const lookupInfo = async () => {
    if (!url.trim()) return;
    setLoadingInfo(true);
    setInfoError(null);
    setInfo(null);
    try {
      const res = await fetch(`${backendUrl()}/api/downloader/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo leer el link');
      setInfo(data);
      setQuality(data.heights?.[0] ? String(data.heights[0]) : 'best');
    } catch (err) {
      setInfoError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const startDownload = async () => {
    if (!url.trim()) return;
    setStarting(true);
    setJob(null);
    try {
      const res = await fetch(`${backendUrl()}/api/downloader`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: url.trim(), format, quality }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar la descarga');
      setJobId(data.jobId);
      setJob({ status: 'queued', percent: 0 });

      stopPolling();
      pollRef.current = setInterval(async () => {
        const statusRes = await fetch(`${backendUrl()}/api/downloader/status/${data.jobId}`, { headers: authHeaders() });
        const statusData = await statusRes.json();
        if (!statusData.success) { stopPolling(); return; }
        setJob(statusData);
        if (statusData.status === 'done' || statusData.status === 'error') {
          stopPolling();
          if (statusData.status === 'done') fetchFiles();
        }
      }, 1500);
    } catch (err) {
      setJob({ status: 'error', error: err.message });
    } finally {
      setStarting(false);
    }
  };

  const deleteFile = async (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    await fetch(`${backendUrl()}/api/downloader/files/${id}`, { method: 'DELETE', headers: authHeaders() });
  };

  const isBusy = job && ['queued', 'downloading', 'processing'].includes(job.status);

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto gap-6">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">⬇️ Downloader</p>

      <div className="theme-surface w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">NUEVA DESCARGA</h1>
        </div>
        <p className="text-[11px] text-gray-500 mb-4 leading-snug">
          Pega el link de un video de TikTok (sin marca de agua), YouTube o cualquier otro sitio compatible. Los archivos generados se guardan por 2 horas y después se eliminan solos.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setInfo(null); setInfoError(null); }}
            onKeyDown={(event) => event.key === 'Enter' && lookupInfo()}
            placeholder="https://..."
            className="theme-input flex-1 px-3 py-3 text-sm"
          />
          <button
            onClick={lookupInfo}
            disabled={loadingInfo || !url.trim()}
            className="theme-btn-secondary px-4 py-3 rounded-xl font-bold text-xs tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loadingInfo ? '...' : 'Buscar'}
          </button>
        </div>

        {infoError && (
          <div className="rounded-lg px-4 py-3 text-xs font-bold border bg-red-500/10 border-red-500/40 text-red-700 mb-3">
            ⚠️ {infoError}
          </div>
        )}

        {info && (
          <div className="theme-input flex items-center gap-3 px-3 py-2 mb-4">
            {info.thumbnail && <img src={info.thumbnail} className="w-16 h-16 rounded object-cover flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{info.title}</p>
              <p className="text-[10px] text-gray-500 truncate">{info.channel} · {info.duration}s{info.isTikTok ? ' · TikTok' : ''}</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setFormat('mp4')}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all ${format === 'mp4' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}
          >
            🎬 Video (MP4)
          </button>
          <button
            type="button"
            onClick={() => setFormat('mp3')}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all ${format === 'mp3' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}
          >
            🎵 Audio (MP3)
          </button>
        </div>

        {format === 'mp4' && info?.heights?.length > 0 && (
          <label className="block mb-4">
            <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Calidad</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value)} className="theme-input w-full px-3 py-2.5 text-sm">
              {info.heights.map((h) => <option key={h} value={h}>{h}p</option>)}
              <option value="best">Mejor disponible</option>
            </select>
          </label>
        )}

        <button
          onClick={startDownload}
          disabled={starting || isBusy || !url.trim()}
          className="theme-btn-primary w-full py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isBusy ? 'Descargando...' : starting ? 'Iniciando...' : 'Descargar'}
        </button>

        {job && (
          <div className="mt-4">
            {isBusy && (
              <>
                <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
                  <div className="h-full theme-accent-bg transition-all" style={{ width: `${job.percent || 0}%` }} />
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5">
                  {job.status === 'processing' ? 'Procesando (uniendo video y audio)...' : `${job.percent || 0}% · ${job.speed || '—'} · ETA ${job.eta || '—'}`}
                </p>
              </>
            )}
            {job.status === 'done' && (
              <div className="rounded-lg px-4 py-3 text-xs font-bold border bg-emerald-500/10 border-emerald-500/40 text-emerald-600">
                ✅ LISTO — ya aparece abajo, en "Tus descargas"
              </div>
            )}
            {job.status === 'error' && (
              <div className="rounded-lg px-4 py-3 text-xs font-bold border bg-red-500/10 border-red-500/40 text-red-700">
                ❌ {job.error || 'No se pudo completar la descarga'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="theme-surface w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="theme-heading text-lg font-semibold">Tus descargas</h2>
          <button onClick={refreshFiles} className="text-[10px] font-bold theme-accent-text hover:opacity-80 underline">
            {loadingFiles ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        {files.length > 0 ? (
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <div key={file.id} className="theme-input flex items-center gap-3 px-3 py-2">
                <span className="text-lg flex-shrink-0">{file.format === 'mp3' ? '🎵' : '🎬'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{file.title || file.sourceUrl}</p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {formatBytes(file.fileSizeBytes)} · vence en {formatRemaining(file.expiresAt)}
                  </p>
                </div>
                <a
                  href={file.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="theme-chip px-3 py-1.5 rounded text-[10px] font-bold flex-shrink-0"
                >
                  Bajar
                </a>
                <button
                  onClick={() => deleteFile(file.id)}
                  className="text-red-400 hover:text-red-300 text-xs flex-shrink-0"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-xs italic">Todavía no descargaste nada.</p>
        )}
      </div>
    </div>
  );
}
