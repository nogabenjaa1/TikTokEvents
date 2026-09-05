import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'tiktok-concurso-tts-settings';
// voiceURI/pitch/rate: el navegador ya trae varias voces gratis instaladas
// (del sistema operativo, más las "Google ..." que Chrome/Edge exponen
// cuando hay internet) — antes ni se elegían, quedaba lo que el navegador
// decidiera solo. pitch 1 = normal, más alto = voz aguda tipo "ardilla";
// rate 1 = velocidad normal del habla.
const DEFAULTS = { enabled: false, allUsers: false, moderators: true, superFans: true, fanMembers: true, minFanLevel: 1, voiceURI: '', pitch: 1, rate: 1, volume: 1 };
const TEST_TEXT_DEFAULT = 'Así se va a escuchar tu voz del chat.';

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
  const [voices, setVoices] = useState([]);
  const [testText, setTestText] = useState(TEST_TEXT_DEFAULT);
  const [testing, setTesting] = useState(false);
  const settingsRef = useRef(settings);
  const voicesRef = useRef(voices);
  const seenIds = useRef(new Set());

  const connected = connectionStatus === 'connected';
  const active = settings.enabled && connected;

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, enabled: false }));
  }, [settings]);

  // getVoices() suele devolver un array vacío en la primera llamada — la
  // lista real llega después, de forma asíncrona, avisada por
  // voiceschanged (comportamiento estándar de la Web Speech API, no un bug
  // nuestro). Español primero (es-*, el uso típico de este panel), el
  // resto de idiomas después por si el streamer quiere una voz rara a propósito.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      const sorted = [...list].sort((a, b) => {
        const aEs = a.lang.toLowerCase().startsWith('es'), bEs = b.lang.toLowerCase().startsWith('es');
        if (aEs !== bEs) return aEs ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      voicesRef.current = sorted;
      setVoices(sorted);
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const resolveVoice = (voiceURI, list) => list.find(v => v.voiceURI === voiceURI) || null;

  // Muchos motores de voz "leen" los emojis en vez de ignorarlos (dicen el
  // nombre del ícono, o directamente un sonido raro) — se sacan del texto
  // ANTES de armar la utterance. El monitor de voz sigue mostrando el
  // comentario original tal cual lo escribió la persona, esto solo afecta
  // lo que se dice en voz alta.
  const stripEmojis = (text) => text
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  const buildUtterance = (text, voiceURI, pitch, rate, volume) => {
    const utterance = new SpeechSynthesisUtterance(stripEmojis(text));
    const voice = resolveVoice(voiceURI, voicesRef.current);
    utterance.voice = voice;
    utterance.lang = voice?.lang || 'es-MX';
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = volume;
    return utterance;
  };

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

      const utterance = buildUtterance(message.comment, current.voiceURI, current.pitch, current.rate, current.volume);
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

  // Prueba la voz/pitch/velocidad actuales con un texto propio, sin
  // depender de que el TTS esté activo ni de estar conectado al LIVE —
  // sirve para calibrar el efecto (ej. pitch alto + rate alto = voz de
  // ardilla) antes de salir en vivo.
  const testVoice = () => {
    if (!('speechSynthesis' in window) || !testText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = buildUtterance(testText.trim(), settings.voiceURI, settings.pitch, settings.rate, settings.volume);
    utterance.onstart = () => setTesting(true);
    utterance.onend = () => setTesting(false);
    utterance.onerror = () => setTesting(false);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className={`${visible ? 'flex-1' : 'hidden'} overflow-y-auto px-8 pt-24 pb-10 text-white`}>
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="theme-label text-[10px] uppercase tracking-[0.3em] font-black">🔊 Voz del Live</p>
            <h1 className="text-2xl font-black tracking-wide mt-2">TTS (BETA)</h1>
            <p className="text-sm text-gray-500 mt-2">Lee automáticamente los mensajes autorizados. Los mensajes con @ nunca se reproducen.</p>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border ${active ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : settings.enabled ? 'bg-amber-950/70 border-amber-500/50 text-amber-300' : 'bg-[var(--surface-bg-alt)] border-[var(--surface-border-color)] text-gray-500'}`}>
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
            {!connected && <p className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-700 p-3 text-xs mb-4">Conecta una cuenta que esté transmitiendo en TikTok LIVE para activar el TTS.</p>}

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

        <div className="theme-surface p-6 mt-5">
          <h2 className="text-sm font-black tracking-widest mb-1">VOZ</h2>
          <p className="text-xs text-gray-500 mb-5">Elige la voz y ajusta pitch/velocidad — súbele el pitch y la velocidad para un efecto de voz aguda tipo ardilla.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <label className="block sm:col-span-2">
              <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Voz ({voices.length} disponibles)</span>
              <select
                value={settings.voiceURI}
                onChange={(event) => update('voiceURI', event.target.value)}
                className="theme-input w-full p-3 outline-none text-sm font-bold text-white"
              >
                <option value="">Predeterminada del navegador</option>
                {voices.map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
              {voices.length === 0 && (
                <span className="block text-[10px] text-gray-500 mt-1">
                  Tu navegador todavía no reportó voces — Chrome/Edge suelen tardar un instante, o revisa que tengas conexión.
                </span>
              )}
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="theme-label text-[10px] uppercase tracking-widest font-black">Pitch (agudo/grave)</span>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{settings.pitch.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="2" step="0.1" value={settings.pitch} onChange={(event) => update('pitch', Number(event.target.value))} className="w-full" />
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="theme-label text-[10px] uppercase tracking-widest font-black">Velocidad</span>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{settings.rate.toFixed(1)}x</span>
              </div>
              <input type="range" min="0.5" max="3" step="0.1" value={settings.rate} onChange={(event) => update('rate', Number(event.target.value))} className="w-full" />
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="theme-label text-[10px] uppercase tracking-widest font-black">Volumen</span>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{Math.round(settings.volume * 100)}%</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => update('volume', Number(event.target.value))} className="w-full" />
            </label>
          </div>

          <label className="block mt-5">
            <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Probar</span>
            <div className="flex gap-2">
              <input
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                placeholder="Escribe un texto para probar la voz"
                className="theme-input flex-1 p-3 outline-none text-sm font-bold text-white"
              />
              <button
                type="button"
                onClick={testVoice}
                disabled={!('speechSynthesis' in window) || !testText.trim()}
                className="theme-btn-primary px-6 py-3 text-xs font-black tracking-widest disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                {testing ? 'REPRODUCIENDO...' : 'PROBAR VOZ'}
              </button>
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
