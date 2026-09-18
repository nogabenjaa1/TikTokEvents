import { HowItWorks, StartRequirement } from './PanelHelp';
import React, { useState, useEffect, useRef } from 'react';
import { backendUrl, authHeaders } from './auth';

// Mismo patrón que Extensible.jsx (ver su comentario de STORAGE_KEY): los
// campos del formulario son estado LOCAL, así que sobreviven a cambiar de
// pestaña y volver (App.jsx desmonta/remonta este componente cada vez).
const STORAGE_KEY = 'tiktok-concurso-goal-settings';
const DEFAULTS = { targetType: 'coins', targetInput: '', title: '' };

function loadSavedConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return DEFAULTS; }
}

const TARGET_TYPES = [
  { id: 'coins', label: '🎁 Monedas en regalos' },
  { id: 'followers', label: '👤 Seguidores nuevos' },
];

// ─────────────────────────────────────────────
// OBJETIVO (pedido explícito: "un apartado para objetivos de regalos/
// seguidores que se actualice en tiempo real"). Uno a la vez -- monedas en
// regalos O seguidores nuevos, nunca los dos corriendo en simultáneo. A
// diferencia de Extensible no hay paso del tiempo: es un simple acumulador
// que crece con cada regalo/seguidor hasta llegar a la meta (ver
// processGiftGoal/processFollowGoal en tenant.js). El progreso NUNCA se
// reinicia solo (ni por tiempo ni por reconexión) -- solo con el botón
// "Reiniciar progreso" de acá abajo.
// ─────────────────────────────────────────────
export default function Goal({ state, socket, username, connectionStatus }) {
  const [startError, setStartError] = useState('');
  const saved = loadSavedConfig();
  const [targetType, setTargetType] = useState(saved.targetType);
  const [targetInput, setTargetInput] = useState(saved.targetInput);
  const [title, setTitle] = useState(saved.title);
  const [error, setError] = useState('');

  // Si el panel se monta con un objetivo YA activo (remontado a mitad de
  // uno -- volver de otra pestaña, o F5), los campos reflejan lo que el
  // servidor confirma, no lo guardado/por defecto -- mismo criterio que
  // syncedFromLiveRef en Extensible.jsx.
  const syncedFromLiveRef = useRef(false);
  useEffect(() => {
    if (syncedFromLiveRef.current || !state.isActive) return;
    syncedFromLiveRef.current = true;
    setTargetType(state.targetType || 'coins');
    setTargetInput(String(state.target || ''));
    setTitle(state.title || '');
  }, [state.isActive, state.targetType, state.target, state.title]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ targetType, targetInput, title })); } catch {}
  }, [targetType, targetInput, title]);

  const cap = targetType === 'coins' ? 10_000_000 : 1_000_000;
  const parsedTarget = Math.round(Number(targetInput));
  const targetValid = Number.isFinite(parsedTarget) && parsedTarget >= 1 && parsedTarget <= cap;

  const startGoal = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    if (!targetValid) return setError(`Ingresa una meta válida (entre 1 y ${cap.toLocaleString('es-MX')}).`);
    setError('');
    socket.emit('start_goal', { targetType, target: parsedTarget, title: title.trim(), tiktokUsername: username });
  };

  // Cambia meta/título en vivo sin tocar el progreso ya acumulado -- mismo
  // patrón que update_extensible_settings, pero disparado por un botón
  // explícito (acá no hay un "segundos por X" que tenga sentido aplicar
  // solo, así que un único botón "Actualizar" es más claro que un efecto
  // que emite en cada tecleo).
  const updateGoal = () => {
    if (!targetValid) return setError(`Ingresa una meta válida (entre 1 y ${cap.toLocaleString('es-MX')}).`);
    setError('');
    socket.emit('update_goal_settings', { target: parsedTarget, title: title.trim() });
  };

  const resetProgress = () => socket.emit('reset_goal');
  const stopGoal = () => socket.emit('stop_goal');

  // Sonido al completar (pedido explícito, opcional) -- a diferencia del
  // tipo/meta/título de arriba, esto es su PROPIA subida independiente (vía
  // /api/goal/audio, mismo criterio que las Alertas): se sube al elegir el
  // archivo, sin esperar a ningún botón "Guardar" -- no hay un objetivo que
  // iniciar/actualizar acá, es una configuración que ya vive aparte del
  // progreso en curso (ver goalAudioUrl en tenant.js).
  const audioInputRef = useRef(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioError, setAudioError] = useState('');

  const uploadAudio = async (file) => {
    if (!file) return;
    setAudioUploading(true);
    setAudioError('');
    try {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`${backendUrl()}/api/goal/audio`, { method: 'POST', headers: authHeaders(), body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo subir el audio');
    } catch (err) {
      setAudioError(err.message);
    } finally {
      setAudioUploading(false);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const removeAudio = async () => {
    setAudioError('');
    try {
      const res = await fetch(`${backendUrl()}/api/goal/audio`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo quitar el audio');
    } catch (err) {
      setAudioError(err.message);
    }
  };

  const testAudio = () => {
    if (state.audioUrl) new Audio(state.audioUrl).play().catch(() => {});
  };

  const pct = state.isActive ? Math.min(100, Math.round(((state.current || 0) / Math.max(1, state.target || 1)) * 100)) : 0;
  // Sin objetivo activo la vista previa muestra lo que se está armando en el
  // formulario (título, meta y barra en 0), para verlo antes de iniciar.
  const previewTitle = (state.isActive ? state.title : title.trim())
    || ((state.isActive ? state.targetType : targetType) === 'followers' ? '👤 Objetivo de seguidores' : '🎁 Objetivo de regalos');
  const previewCurrent = state.isActive ? (state.current || 0) : 0;
  const previewTarget = state.isActive ? (state.target || 0) : (targetValid ? parsedTarget : 0);

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.finished && <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />}
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black relative z-10 mb-3">🎯 OBJETIVO</p>
        <div className="relative z-10">
          <p className="text-sm font-bold text-gray-300 truncate mb-2">{previewTitle}</p>
          <div className="w-full h-6 rounded-full overflow-hidden border mb-2" style={{ borderColor: 'var(--surface-border-color)', background: 'rgba(0,0,0,0.25)' }}>
            <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${state.finished ? 'bg-yellow-400' : 'theme-accent-bg'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-center text-2xl font-black tabular-nums">
            {previewCurrent.toLocaleString('es-MX')} <span className="text-gray-500 text-base">/ {previewTarget.toLocaleString('es-MX')}</span>
          </p>
          {state.finished && <p className="text-center text-xs font-black text-yellow-300 mt-2 uppercase tracking-widest">🎉 ¡Objetivo alcanzado!</p>}
          {!state.isActive && <p className="text-center text-[10px] text-gray-600 italic mt-1">Vista previa — todavía no arrancó</p>}
        </div>
      </div>

      {/* Settings */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <HowItWorks storageKey="goal">
          <p>Elige si la meta es de <span className="font-bold text-white">monedas en regalos</span> o de <span className="font-bold text-white">seguidores nuevos</span> y cuánto quieres juntar. La barra sube sola con cada regalo o seguidor.</p>
          <p>El texto que escribas ("¿Para qué es este objetivo?") aparece sobre la barra en el overlay. El progreso no se reinicia solo: solo con el botón Reiniciar progreso.</p>
        </HowItWorks>

        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">
            TIPO DE OBJETIVO {state.isActive && <span className="text-gray-400 ml-1 text-[8px]" title="Bloqueado mientras el objetivo está activo -- deténlo primero para cambiar de tipo">(bloqueado)</span>}
          </label>
          <div className="flex gap-2">
            {TARGET_TYPES.map((t) => (
              <button key={t.id} type="button" disabled={state.isActive}
                onClick={() => setTargetType(t.id)}
                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${targetType === t.id ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">
            META {targetType === 'coins' ? '(EN MONEDAS)' : '(NUEVOS SEGUIDORES)'}
          </label>
          <input
            type="number" min="1" step="1"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder="Ej: 500"
            className="theme-input w-full p-3 text-sm outline-none"
          />
        </div>

        <div className="mb-6">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">📝 ¿PARA QUÉ ES ESTE OBJETIVO?</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder="Ej: Para la silla nueva"
            className="theme-input w-full p-3 text-sm outline-none"
          />
          <p className="text-[10px] text-gray-500 mt-1">{title.length}/60 — Este texto se muestra sobre la barra de progreso en el overlay. Si lo dejas vacío, se usa un título genérico según el tipo elegido.</p>
        </div>

        <div className="mb-6">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">🔊 SONIDO AL COMPLETAR (OPCIONAL)</label>
          {state.audioUrl && (
            <div className="theme-input flex items-center justify-between gap-2 p-2 mb-2">
              <span className="text-[10px] text-gray-400 truncate">🎧 Ya tiene un sonido guardado</span>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button type="button" onClick={testAudio} className="text-[10px] font-bold text-sky-400 hover:text-sky-300">▶ Probar</button>
                <button type="button" onClick={removeAudio} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline">Quitar</button>
              </div>
            </div>
          )}
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp3,audio/ogg"
            disabled={audioUploading}
            onChange={(e) => uploadAudio(e.target.files?.[0] || null)}
            className="theme-input w-full p-2 text-xs outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:theme-btn-primary file:text-[10px] file:font-black file:uppercase disabled:opacity-50"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {audioUploading ? 'Subiendo...' : 'MP3/WAV/OGG — hasta 15MB. Suena una sola vez cuando el objetivo llega a la meta.'}
          </p>
          {audioError && <p className="text-[10px] text-red-500 mt-1">{audioError}</p>}
        </div>

        {error && <p className="text-[11px] font-bold text-red-500 mb-3">{error}</p>}

        <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />

        <div className="flex gap-4">
          {!state.isActive ? (
            <button onClick={startGoal} disabled={connectionStatus !== 'connected'} className="theme-btn-primary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed">
              {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR OBJETIVO'}
            </button>
          ) : (
            <>
              <button onClick={updateGoal} className="theme-btn-secondary flex-1 py-4 rounded-xl font-bold tracking-wide transition-all">
                ACTUALIZAR META
              </button>
              <button onClick={resetProgress} className="theme-btn-warning flex-1 py-4 font-bold tracking-wide transition-all">
                REINICIAR PROGRESO ⟲
              </button>
              <button onClick={stopGoal} className="theme-btn-danger px-6 py-4 font-bold transition-all">
                ⏹
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
