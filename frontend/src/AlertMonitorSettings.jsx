import { useState } from 'react';
import { MONITOR_MODES } from './alertMonitor';

// Dónde suenan las alertas para el streamer (ver alertMonitor.js). Vive en los
// "Ajustes generales" del panel de Alertas.
export default function AlertMonitorSettings({ mode, onModeChange, overlayConnected, sinkId, sinkLabel, onSinkChange }) {
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
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="theme-label text-[10px] uppercase tracking-widest font-semibold">🎧 Sonido de las alertas en este navegador</span>
        <span
          className="theme-chip font-bold px-2 rounded text-[10px]"
          title="Si el overlay de alertas está abierto en OBS o TikTok Studio, ahí suena el audio que sale al directo"
        >
          {overlayConnected ? 'Overlay conectado' : 'Sin overlay conectado'}
        </span>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        Con el overlay abierto en OBS o TikTok Studio la alerta ya suena ahí, y eso es lo que sale al directo. Si además sonara esta pestaña y el
        audio de tu computadora también entra al directo, se oiría doble.
      </p>
      <div role="radiogroup" aria-label="Cuándo suenan las alertas en este navegador" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MONITOR_MODES.map((m) => {
          const selected = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onModeChange(m.id)}
              className="theme-input p-3 text-left transition-all"
              style={selected ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : undefined}
            >
              <span className="block text-xs font-bold text-gray-200">{m.label}{selected ? ' ✓' : ''}</span>
              <span className="block text-[10px] text-gray-500 leading-snug mt-0.5">{m.hint}</span>
            </button>
          );
        })}
      </div>

      {canPickOutput && mode !== 'never' && (
        <div className="mt-3">
          <p className="text-[11px] text-gray-500 mb-2">
            Para oírlas tú sin que entren al directo, envía el sonido de esta pestaña a tus audífonos (un dispositivo que tu programa de directo no capte).
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
              aria-label="Dispositivo de salida para las alertas"
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
