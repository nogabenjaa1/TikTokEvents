import React, { useEffect, useRef, useState } from 'react';
import { backendUrl, authHeaders } from './auth';

const MP3_QUALITIES = [{ label: '320 kbps', value: '320' }, { label: '192 kbps', value: '192' }, { label: '128 kbps', value: '128' }];
const DEFAULT_HEIGHTS = ['best', '1080', '720', '480', '360'];

// Cada job se poll-ea cada 800ms mientras esté activo -- mismo intervalo
// que el proyecto standalone (YTDownloader), donde ya se probó que es lo
// bastante seguido para una barra de progreso fluida sin saturar al server.
const POLL_MS = 800;

const STATUS_LABELS = {
  queued: 'En cola…', downloading: 'Descargando…', processing: 'Procesando (ffmpeg)…',
  done: 'Completado', error: 'Error',
};

// ─────────────────────────────────────────────
// DOWNLOADER — descarga videos de YouTube/TikTok (sin marca de agua) desde
// el propio panel, vía yt-dlp en el backend (ver backend/downloader.js).
// Puerto del proyecto standalone YTDownloader ya probado (mismos formatos/
// calidad/proxy anti-ban para TikTok) -- acá reimplementado con los
// componentes/clases de tema de este panel (theme-surface/theme-input/
// theme-btn-primary) en vez de su CSS bespoke original, para que se vea
// igual de "de la casa" que Alertas o Membresía.
// Disponible para cualquier sesión válida (incluida la prueba gratis,
// pedido explícito) -- App.jsx solo evita mostrar este componente sin
// sesión, el backend (auth.requireAuth) es quien de verdad lo exige.
// ─────────────────────────────────────────────
export default function Downloader() {
  const [plat, setPlat] = useState('yt');
  const [url, setUrl] = useState('');
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [info, setInfo] = useState(null); // { title, thumbnail, duration, channel, heights, isTikTok }
  const [fetchError, setFetchError] = useState('');

  const [fmt, setFmt] = useState('mp4');
  const [quality, setQuality] = useState('best');

  const [jobs, setJobs] = useState([]); // [{ id, title, status, percent, speed, eta, filename, error }]
  const pollTimers = useRef({});

  useEffect(() => () => {
    // Al desmontar (streamer cambia de sección) se cortan los polls en
    // curso -- las descargas siguen su curso en el server igual, el panel
    // solo deja de refrescar su progreso hasta que se vuelva a entrar acá.
    Object.values(pollTimers.current).forEach(clearInterval);
  }, []);

  const placeholder = plat === 'yt' ? 'https://youtube.com/watch?v=...' : 'https://tiktok.com/@usuario/video/...';

  const fetchInfo = async () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    setFetchingInfo(true);
    setFetchError('');
    try {
      const res = await fetch(`${backendUrl()}/api/downloader/info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: cleanUrl }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo analizar el link');
      setInfo(data);
      setFmt('mp4');
      setQuality('best');
      if (data.isTikTok) setPlat('tt'); else setPlat('yt');
    } catch (err) {
      setFetchError(err.message);
      setInfo(null);
    } finally {
      setFetchingInfo(false);
    }
  };

  const qualityOptions = fmt === 'mp3'
    ? MP3_QUALITIES
    : (info?.heights?.length ? ['best', ...info.heights.map(String)] : DEFAULT_HEIGHTS).map((h) => ({ label: h === 'best' ? '✦ Mejor' : `${h}p`, value: h }));

  const selectFmt = (f) => {
    setFmt(f);
    setQuality(f === 'mp3' ? '320' : 'best');
  };

  const pollJob = (jobId) => {
    pollTimers.current[jobId] = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl()}/api/downloader/status/${jobId}`, { headers: authHeaders() });
        const data = await res.json();
        if (res.status === 404 || data.error) {
          clearInterval(pollTimers.current[jobId]);
          delete pollTimers.current[jobId];
          setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'error', error: data.error || 'El proceso expiró o no se encontró.' } : j)));
          return;
        }
        // El backend no rastrea `title` (job.title en downloader.js
        // siempre queda null) -- se preserva el que ya se conoce del
        // lado del cliente en vez de dejar que este merge lo pise con
        // null en el primer poll.
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...data, title: j.title } : j)));
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollTimers.current[jobId]);
          delete pollTimers.current[jobId];
        }
      } catch {
        // Error de red puntual -- el próximo tick reintenta solo, no hace
        // falta cortar el polling por un fallo aislado.
      }
    }, POLL_MS);
  };

  const [savingJobId, setSavingJobId] = useState(null);

  // Un <a href> comun no puede mandar el header Authorization -- por eso
  // esto pide el archivo con fetch() (que si lo manda) y arma la descarga
  // del lado del cliente con un blob. La alternativa hubiera sido mandar
  // el token por query string, pero eso lo deja expuesto en logs/historial
  // del navegador -- este approach mantiene el token SOLO en el header,
  // igual que el resto de la app.
  const saveJobFile = async (job) => {
    setSavingJobId(job.id);
    try {
      const res = await fetch(`${backendUrl()}/api/downloader/file/${job.id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'No se pudo descargar el archivo');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = job.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error: err.message } : j)));
    } finally {
      setSavingJobId(null);
    }
  };

  const startDownload = async () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    try {
      const res = await fetch(`${backendUrl()}/api/downloader/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: cleanUrl, format: fmt, quality }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo iniciar la descarga');
      const jobId = data.job_id;
      setJobs((prev) => [{ id: jobId, title: info?.title || cleanUrl, status: 'queued', percent: 0, speed: '—', eta: '—', filename: null, error: null }, ...prev]);
      pollJob(jobId);
      setUrl('');
      setInfo(null);
    } catch (err) {
      setFetchError(err.message);
    }
  };

  return (
    <div className="flex-1 min-h-screen p-6 pt-10 flex flex-col items-center gap-6 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">⬇️ Downloader</p>

      <div className="theme-surface w-full max-w-xl p-6">
        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setPlat('yt')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${plat === 'yt' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
            YouTube
          </button>
          <button type="button" onClick={() => setPlat('tt')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${plat === 'tt' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
            TikTok
          </button>
        </div>

        <label className="theme-label block text-[10px] mb-2">{plat === 'tt' ? 'URL · sin marca de agua' : 'URL'}</label>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fetchInfo(); }}
            placeholder={placeholder}
            className="theme-input flex-1 p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm" />
          <button type="button" onClick={fetchInfo} disabled={fetchingInfo || !url.trim()}
            className="theme-btn-secondary px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
            {fetchingInfo ? 'Analizando...' : 'Analizar'}
          </button>
        </div>

        {info && (
          <div className="flex items-center gap-4 mt-5 pt-5" style={{ borderTop: '1px solid var(--surface-border-color)' }}>
            {info.thumbnail && <img src={info.thumbnail} alt="" className="w-24 h-14 object-cover rounded-lg flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{info.title}</p>
              <div className="flex gap-2 mt-1 flex-wrap">
                <span className="theme-chip text-[9px] px-2 py-0.5 rounded">{info.channel}</span>
                <span className="theme-chip text-[9px] px-2 py-0.5 rounded">{info.duration}</span>
              </div>
            </div>
          </div>
        )}

        {fetchError && <p className="text-[11px] font-bold text-red-500 mt-3">⚠ {fetchError}</p>}
      </div>

      {info && (
        <div className="theme-surface w-full max-w-xl p-6">
          <label className="theme-label block text-[10px] mb-2">Formato</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button type="button" onClick={() => selectFmt('mp4')}
              className={`py-3 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${fmt === 'mp4' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
              🎬 MP4
            </button>
            <button type="button" onClick={() => selectFmt('mp3')}
              className={`py-3 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${fmt === 'mp3' ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
              🎵 MP3
            </button>
          </div>

          <label className="theme-label block text-[10px] mb-2">{fmt === 'mp3' ? 'Bitrate de audio' : 'Calidad de video'}</label>
          <div className="flex gap-2 flex-wrap mb-5">
            {qualityOptions.map((q) => (
              <button key={q.value} type="button" onClick={() => setQuality(q.value)}
                className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${quality === q.value ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {q.label}
              </button>
            ))}
          </div>

          <button type="button" onClick={startDownload}
            className="theme-btn-primary w-full py-4 rounded-xl font-black uppercase tracking-widest text-xs">
            Descargar
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="w-full max-w-xl flex flex-col gap-3">
          {jobs.map((job) => (
            <div key={job.id} className="theme-surface p-4">
              <p className="text-xs font-bold truncate mb-2">{job.title}</p>
              <div className="flex items-center gap-2 mb-2">
                <span className={[
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  job.status === 'done' ? 'bg-emerald-500' : job.status === 'error' ? 'bg-red-500' : 'theme-accent-bg animate-pulse',
                ].join(' ')} />
                <span className="text-[10px] text-gray-500 font-mono">{STATUS_LABELS[job.status] || job.status}</span>
              </div>
              {job.status !== 'done' && job.status !== 'error' && (
                <>
                  <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface-border-color)' }}>
                    <div className="h-full theme-accent-bg rounded-full transition-all" style={{ width: `${job.percent || 0}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-500 font-mono">
                    <span>{job.percent || 0}%</span>
                    <span>{job.speed || '—'}</span>
                    <span>ETA {job.eta || '—'}</span>
                  </div>
                </>
              )}
              {job.status === 'done' && job.filename && (
                <div className="flex items-center justify-between gap-3 mt-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-emerald-600 truncate">{job.filename}</p>
                    <p className="text-[9px] text-gray-500">listo para guardar</p>
                  </div>
                  <button type="button" onClick={() => saveJobFile(job)} disabled={savingJobId === job.id}
                    className="theme-btn-primary px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                    {savingJobId === job.id ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              )}
              {job.status === 'error' && <p className="text-[11px] font-bold text-red-500 mt-2">⚠ {job.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
