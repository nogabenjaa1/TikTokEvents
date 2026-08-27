import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'tiktok-concurso-tts-settings';
const DEFAULTS = { enabled: false, allUsers: false, moderators: true, superFans: true, fanMembers: true, minFanLevel: 1 };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), enabled: false }; }
  catch { return DEFAULTS; }
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="theme-input flex items-center gap-3 px-4 py-3 cursor-pointer transition-opacity hover:opacity-90">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only peer" />
      <span aria-hidden="true" className="w-10 h-6 rounded-full bg-gray-700 peer-checked:theme-accent-bg relative flex-shrink-0 transition-colors after:absolute after:w-4 after:h-4 after:rounded-full after:bg-white after:left-1 after:top-1 after:transition-transform peer-checked:after:translate-x-4" />
      <span>
        <span className="block text-sm font-black text-white">{label}</span>
        <span className="block text-[11px] text-gray-500 mt-0.5">{description}</span>
      </span>
    </label>
  );
}

export default function TtsChat({ socket, connectionStatus, visible }) {
  const [settings, setSettings] = useState(loadSettings);
  const [lastMessage, setLastMessage] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const settingsRef = useRef(settings);
  const seenIds = useRef(new Set());

  const connected = connectionStatus === 'connected';
  const active = settings.enabled && connected;

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, enabled: false }));
  }, [settings]);

  useEffect(() => {
    const updateQueue = () => setQueueCount(window.speechSynthesis?.pending ? 1 : 0);
    const timer = window.setInterval(updateQueue, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket || !('speechSynthesis' in window)) return;

    const onMessage = (message) => {
      const current = settingsRef.current;
      if (!current.enabled || message.comment.includes('@')) return;
      if (seenIds.current.has(message.id)) return;
      seenIds.current.add(message.id);
      if (seenIds.current.size > 500) seenIds.current.clear();

      const authorized = current.allUsers
        || (current.moderators && message.isModerator)
        || (current.superFans && message.isSuperFan)
        || (current.fanMembers && message.fanLevel >= current.minFanLevel);
      if (!authorized) return;

      const utterance = new SpeechSynthesisUtterance(message.comment);
      utterance.lang = 'es-MX';
      utterance.rate = 1;
      utterance.volume = 1;
      utterance.onstart = () => setLastMessage(message);
      utterance.onend = () => setQueueCount(window.speechSynthesis.pending ? 1 : 0);
      window.speechSynthesis.speak(utterance);
      setQueueCount(1);
    };

    socket.on('tts_chat_message', onMessage);
    return () => socket.off('tts_chat_message', onMessage);
  }, [socket]);

  useEffect(() => {
    if (!settings.enabled || connected) return;
    window.speechSynthesis?.cancel();
  }, [settings.enabled, connected]);

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const stop = () => { window.speechSynthesis?.cancel(); setQueueCount(0); };

  return (
    <section className={`${visible ? 'flex-1' : 'hidden'} overflow-y-auto px-8 pt-24 pb-10 text-white`}>
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="theme-label text-[10px] uppercase tracking-[0.3em] font-black">🔊 Voz del Live</p>
            <h1 className="text-2xl font-black tracking-wide mt-2">TTS CHAT</h1>
            <p className="text-sm text-gray-500 mt-2">Lee automáticamente los mensajes autorizados. Los mensajes con @ nunca se reproducen.</p>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border ${active ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : settings.enabled ? 'bg-amber-950/70 border-amber-500/50 text-amber-300' : 'bg-gray-900/70 border-gray-700 text-gray-500'}`}>
            {active ? '● Al aire' : settings.enabled ? 'Esperando LIVE' : 'Apagado'}
          </span>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
          <div className="theme-surface-featured p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-sm font-black tracking-widest">LECTURA AUTOMÁTICA</h2>
                <p className="text-xs text-gray-500 mt-1">Se desactiva al recargar por seguridad.</p>
              </div>
              <button type="button" disabled={!connected && !settings.enabled} onClick={() => update('enabled', !settings.enabled)} className={`px-6 py-3 text-xs font-black tracking-widest transition-opacity disabled:opacity-40 ${settings.enabled ? 'bg-red-950/70 border border-red-700/60 text-red-300 rounded-xl' : 'theme-btn-primary'}`}>
                {settings.enabled ? 'DESACTIVAR' : 'ACTIVAR TTS'}
              </button>
            </div>

            {!('speechSynthesis' in window) && <p className="rounded-xl bg-red-950/60 border border-red-800 text-red-300 p-3 text-xs">Este navegador no admite Speech Synthesis.</p>}
            {!connected && <p className="rounded-xl bg-amber-950/50 border border-amber-800/60 text-amber-300 p-3 text-xs mb-4">Conecta una cuenta que esté transmitiendo en TikTok LIVE para activar el TTS.</p>}

            <div className="space-y-3">
              <Toggle checked={settings.allUsers} onChange={(v) => update('allUsers', v)} label="Todos los usuarios" description="Lee a cualquier persona del chat; anula los filtros inferiores." />
              <Toggle checked={settings.moderators} onChange={(v) => update('moderators', v)} label="Moderadores" description="Permite mensajes de los moderadores del creador." />
              <Toggle checked={settings.superFans} onChange={(v) => update('superFans', v)} label="Super Fans" description="Permite usuarios identificados con insignia Super Fan." />
              <Toggle checked={settings.fanMembers} onChange={(v) => update('fanMembers', v)} label="Miembros del Fan Club" description="Aplica el nivel mínimo seleccionado abajo." />
            </div>

            <label className={`block mt-5 ${settings.fanMembers && !settings.allUsers ? '' : 'opacity-45'}`}>
              <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Nivel mínimo de miembro</span>
              <div className="flex items-center gap-4">
                <input type="range" min="1" max="50" value={settings.minFanLevel} disabled={!settings.fanMembers || settings.allUsers} onChange={(event) => update('minFanLevel', Number(event.target.value))} className="flex-1" />
                <div className="theme-input w-28 flex items-center overflow-hidden flex-shrink-0">
                  <button
                    type="button"
                    aria-label="Bajar nivel mínimo"
                    disabled={!settings.fanMembers || settings.allUsers || settings.minFanLevel <= 1}
                    onClick={() => update('minFanLevel', Math.max(1, settings.minFanLevel - 1))}
                    className="w-7 h-9 flex items-center justify-center text-sm font-black theme-accent-text hover:opacity-60 disabled:opacity-30 transition-opacity flex-shrink-0"
                  >−</button>
                  <input
                    type="number" min="1" max="50"
                    value={settings.minFanLevel}
                    disabled={!settings.fanMembers || settings.allUsers}
                    onChange={(event) => update('minFanLevel', Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
                    className="w-full bg-transparent outline-none text-center font-black text-sm py-2 min-w-0"
                  />
                  <button
                    type="button"
                    aria-label="Subir nivel mínimo"
                    disabled={!settings.fanMembers || settings.allUsers || settings.minFanLevel >= 50}
                    onClick={() => update('minFanLevel', Math.min(50, settings.minFanLevel + 1))}
                    className="w-7 h-9 flex items-center justify-center text-sm font-black theme-accent-text hover:opacity-60 disabled:opacity-30 transition-opacity flex-shrink-0"
                  >+</button>
                </div>
              </div>
            </label>
          </div>

          <aside className="theme-surface p-6 flex flex-col min-h-[320px]">
            <p className="theme-label text-[10px] uppercase tracking-[0.25em] font-black">Monitor de voz</p>
            <div className="flex-1 flex flex-col justify-center py-8">
              {lastMessage ? (
                <div>
                  <p className="theme-accent-text text-xs font-black mb-2">{lastMessage.username}</p>
                  <p className="text-lg font-bold leading-relaxed">“{lastMessage.comment}”</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-4">Último mensaje leído</p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-4xl mb-3 opacity-60">🎙️</div>
                  <p className="text-sm font-bold text-gray-400">Aún no hay mensajes leídos</p>
                  <p className="text-xs text-gray-600 mt-2">El monitor se actualizará cuando un usuario autorizado escriba.</p>
                </div>
              )}
            </div>
            <button type="button" onClick={stop} disabled={!queueCount} className="theme-btn-secondary w-full py-3 text-[10px] font-black tracking-widest disabled:opacity-40">DETENER Y VACIAR COLA</button>
          </aside>
        </div>
      </div>
    </section>
  );
}
