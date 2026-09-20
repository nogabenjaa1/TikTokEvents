import { useState } from 'react';

// Sonido de las alertas y de los eventos en ESTE navegador (ver
// alertMonitor.js y overlayAudio.js). Vive en los "Ajustes generales" del panel
// de Alertas.
export default function AlertMonitorSettings({ enabled, onEnabledChange, overlayConnected, sinkId, sinkLabel, onSinkChange }) {
  const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype && !!navigator.mediaDevices;
  const [outputs, setOutputs] = useState(null);
  const [message, setMessage] = useState('');

  const chooseOutput = async () => {
    setMessage('');
    try {
      if (navigator.mediaDevices.selectAudioOutput) {
        const device = await navigator.mediaDevices.selectAudioOutput();
        onSinkChange(device.deviceId, device.label || 'Dispositivo elegido');
        return;
      }
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      if (devices.length === 0) setMessage('Este navegador no muestra otros dispositivos de salida.');
      setOutputs(devices);
    } catch {
      setMessage('No se pudo elegir el dispositivo (o cancelaste). Se sigue usando el actual.');
    }
  };

  return (
    <div className="mt-5 pt-4 border-t border-[var(--surface-border-color)]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="theme-label text-[10px] uppercase tracking-widest font-semibold">🔊 Sonido en este navegador</span>
        <span
          className="theme-chip font-bold px-2 rounded text-[10px]"
          title="El overlay de alertas en OBS o TikTok Studio es solo visual: muestra la imagen, el video y el texto"
        >
          {overlayConnected ? 'Overlay conectado' : 'Sin overlay conectado'}
        </span>
      </div>

      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-xs font-bold text-gray-200">Reproducir aquí el sonido de alertas y eventos</span>
          <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">
            Tu panel reproduce TODO el sonido: las alertas (su audio y el audio de sus videos), el sonido de Objetivo completado y los efectos de los
            juegos. El overlay de OBS es solo visual. Como el directo capta el audio de tu computadora, todos lo oyen una sola vez, sin duplicarse.
            Deja esta pestaña abierta mientras transmites.
          </span>
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} className="sr-only peer" aria-label="Reproducir aquí el sonido de alertas y eventos" />
        <span aria-hidden="true" className="tkc-switch flex-shrink-0" />
      </label>

      {!enabled && (
        <p role="status" className="text-[11px] text-amber-700 mt-2 leading-snug">
          Con el sonido apagado no se oirá nada en tu directo desde este navegador: los overlays no reproducen audio.
        </p>
      )}

      {canPickOutput && enabled && (
        <div className="mt-3">
          <p className="text-[11px] text-gray-500 mb-2">
            Opcional: envía el sonido de esta pestaña a un dispositivo concreto (por ejemplo un cable virtual que capta tu programa de directo).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={chooseOutput} className="theme-btn-secondary px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">
              🎧 Elegir dispositivo de salida
            </button>
            {sinkId && (
              <button type="button" onClick={() => onSinkChange('', '')} className="text-[10px] font-bold text-gray-400 hover:text-white underline py-2">
                Usar el predeterminado
              </button>
            )}
            <span className="text-[11px] text-gray-400">{sinkId ? `Salida: ${sinkLabel || 'dispositivo elegido'}` : 'Salida: predeterminada del sistema'}</span>
          </div>
          {outputs && outputs.length > 0 && (
            <select
              className="theme-input mt-2 p-2 text-xs w-full"
              aria-label="Dispositivo de salida para el sonido"
              value={sinkId}
              onChange={(e) => {
                const device = outputs.find((d) => d.deviceId === e.target.value);
                onSinkChange(e.target.value, device?.label || '');
              }}
            >
              <option value="">Predeterminado del sistema</option>
              {outputs.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Salida ${i + 1}`}</option>)}
            </select>
          )}
          {message && <p role="status" className="text-[11px] text-gray-400 mt-2">{message}</p>}
        </div>
      )}
    </div>
  );
}
