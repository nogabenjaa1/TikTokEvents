import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'tiktok-concurso-tts-settings';
// voiceURI/pitch/rate: el navegador ya trae varias voces gratis instaladas
// (del sistema operativo, más las "Google ..." que Chrome/Edge exponen
// cuando hay internet) — antes ni se elegían, quedaba lo que el navegador
// decidiera solo. pitch 1 = normal, más alto = voz aguda tipo "ardilla";
// rate 1 = velocidad normal del habla.
const DEFAULTS = {
  enabled: false, allUsers: false, moderators: true, superFans: true, fanMembers: true, minFanLevel: 1,
  voiceURI: '', pitch: 1, rate: 1, volume: 1, activePreset: 'normal',
  minChars: 2, ignoreRepeats: true, blockedWords: '',
};
const TEST_TEXT_DEFAULT = 'Así se va a escuchar tu voz del chat.';

// Presets de pitch/rate/volumen — pedido explícito de "más efectos, pero con
// un preajuste que mantenga la naturalidad". IMPORTANTE (limitación real de
// la Web Speech API, no elección nuestra): el navegador no expone el audio
// sintetizado como una señal manipulable, así que un "robot" o "eco" de
// verdad (con procesamiento de la onda) no es técnicamente posible acá —
// estos presets combinan pitch/rate/volumen para acercarse al efecto sin
// prometer algo que el navegador no puede dar. "Helio" en particular se
// deja en un punto medio (1.4, no el 2.0 máximo del slider) porque a partir
// de ahí varias voces dejan de entenderse — pedido explícito de evitar esa
// distorsión.
const EFFECT_PRESETS = {
  normal:  { label: 'Normal',  emoji: '🎙️', pitch: 1,    rate: 1,    volume: 1,    hint: 'La voz tal cual, sin modificar.' },
  helio:   { label: 'Helio',   emoji: '🎈', pitch: 1.4,  rate: 1.15, volume: 1,    hint: 'Aguda pero se entiende — más arriba de esto varias voces se distorsionan.' },
  grave:   { label: 'Grave',   emoji: '🗿', pitch: 0.6,  rate: 0.9,  volume: 1,    hint: 'Más grave y pausada.' },
  rapido:  { label: 'Rápido',  emoji: '⚡', pitch: 1,    rate: 1.6,  volume: 1,    hint: 'Lee más rápido, mismo tono.' },
  susurro: { label: 'Susurro', emoji: '🤫', pitch: 0.9,  rate: 0.85, volume: 0.35, hint: 'Volumen bajo y ritmo pausado, para momentos especiales.' },
};

// Cola propia (no la interna del navegador): pedido explícito de reducir el
// retraso y evitar que se acumulen mensajes viejos. Con la cola nativa del
// navegador no hay forma de descartar un mensaje que ya perdió el momento
// ni de detectar que el motor se trabó — armando la cola nosotros mismos
// podemos: 1) descartar mensajes que llevan demasiado esperando, 2) topear
// cuántos se acumulan, y 3) forzar que avance si un mensaje no termina de
// leerse en un tiempo razonable (bug real y conocido de Chrome: el motor de
// voz a veces se queda "colgado" después de un rato sin avisar).
const MAX_QUEUE = 8;
const MAX_MESSAGE_AGE_MS = 12000;
const UTTERANCE_SAFETY_MS = 15000;
const REPEAT_WINDOW_MS = 15000;
const REPEAT_HISTORY = 3;

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
  // engineStatus: 'idle' (nada pendiente) | 'speaking' (leyendo algo ahora)
  // | 'recovered' (el watchdog tuvo que forzar un avance — se muestra un
  // instante como aviso, después vuelve solo a idle/speaking).
  const [engineStatus, setEngineStatus] = useState('idle');
  const settingsRef = useRef(settings);
  const voicesRef = useRef(voices);
  const seenIds = useRef(new Set());

  // Cola propia + control del motor (ver comentario de MAX_QUEUE más
  // arriba) — todo estado que no necesita re-render directo vive en refs.
  const queueRef = useRef([]); // [{ message, ts }]
  const speakingRef = useRef(false);
  const watchdogRef = useRef(null);
  const recoveredTimeoutRef = useRef(null);
  const recentTextsRef = useRef([]); // [{ text, ts }] — para "ignorar repetidos"

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

  // Corta todo de una: vacía la cola propia Y cancela lo que el navegador
  // tuviera en curso — es el "botón de reconexión" pedido explícito, para
  // cuando el motor de voz queda trabado (ver UTTERANCE_SAFETY_MS) y el
  // streamer quiere forzar que arranque de cero sin esperar al watchdog.
  const resetEngine = () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (recoveredTimeoutRef.current) { clearTimeout(recoveredTimeoutRef.current); recoveredTimeoutRef.current = null; }
    window.speechSynthesis?.cancel();
    queueRef.current = [];
    speakingRef.current = false;
    setQueueCount(0);
    setEngineStatus('idle');
  };

  // Motor de un solo mensaje a la vez: saca el siguiente de la cola propia
  // (descartando primero lo que ya venció, ver MAX_MESSAGE_AGE_MS), lo lee,
  // y al terminar (o al fallar, o al vencer el timeout de seguridad) sigue
  // con el que sigue. Todo declarativo por refs — no dispara re-render por
  // cada paso, solo cuando cambia lo que se muestra (queueCount/lastMessage/
  // engineStatus).
  const processQueue = () => {
    if (speakingRef.current) return;
    const now = Date.now();
    while (queueRef.current.length && now - queueRef.current[0].ts > MAX_MESSAGE_AGE_MS) {
      queueRef.current.shift();
    }
    const next = queueRef.current.shift();
    setQueueCount(queueRef.current.length);
    if (!next) { setEngineStatus('idle'); return; }

    speakingRef.current = true;
    setEngineStatus('speaking');
    const current = settingsRef.current;
    const utterance = buildUtterance(next.message.comment, current.voiceURI, current.pitch, current.rate, current.volume);
    utterance.onstart = () => setLastMessage(next.message);

    const finish = () => {
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      speakingRef.current = false;
      processQueue();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    // Watchdog: si un mensaje no termina de leerse en este tiempo, el motor
    // probablemente se colgó (bug real y documentado de Chrome) — se fuerza
    // el avance en vez de dejar la cola congelada para siempre.
    watchdogRef.current = setTimeout(() => {
      window.speechSynthesis.cancel();
      setEngineStatus('recovered');
      if (recoveredTimeoutRef.current) clearTimeout(recoveredTimeoutRef.current);
      recoveredTimeoutRef.current = setTimeout(() => setEngineStatus(speakingRef.current ? 'speaking' : 'idle'), 4000);
      finish();
    }, UTTERANCE_SAFETY_MS);

    window.speechSynthesis.speak(utterance);
  };

  const normalizeForRepeat = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ');

  const isBlocked = (text, blockedWordsRaw) => {
    const words = blockedWordsRaw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    if (!words.length) return false;
    const lower = text.toLowerCase();
    return words.some(w => lower.includes(w));
  };

  const isRepeat = (normalized) => {
    const now = Date.now();
    recentTextsRef.current = recentTextsRef.current.filter(e => now - e.ts < REPEAT_WINDOW_MS);
    return recentTextsRef.current.some(e => e.text === normalized);
  };

  // Filtros de admisión (pedido explícito: ignorar mensajes cortos o
  // repetitivos, filtro de palabras) — se aplican ACÁ, antes de que el
  // mensaje siquiera entre a la cola, así ni ocupan un lugar ni suman
  // retraso para los mensajes que sí importan.
  const enqueue = (message) => {
    const current = settingsRef.current;
    const text = message.comment;
    if (text.trim().length < current.minChars) return;
    if (isBlocked(text, current.blockedWords)) return;
    const normalized = normalizeForRepeat(text);
    if (current.ignoreRepeats && isRepeat(normalized)) return;
    recentTextsRef.current.push({ text: normalized, ts: Date.now() });
    if (recentTextsRef.current.length > REPEAT_HISTORY) recentTextsRef.current.shift();

    queueRef.current.push({ message, ts: Date.now() });
    // Cola topeada: si se satura, se descarta el más viejo — pedido
    // explícito de que la cola sea eficiente y no crezca sin límite.
    if (queueRef.current.length > MAX_QUEUE) queueRef.current.shift();
    setQueueCount(queueRef.current.length);
    processQueue();
  };

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

      enqueue(message);
    };

    socket.on('tts_chat_message', onMessage);
    return () => socket.off('tts_chat_message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(() => {
    if (!settings.enabled || connected) return;
    resetEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, connected]);

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  // Mover un slider a mano deja de ser "un preset" — se refleja apagando el
  // resaltado de los botones de efecto (ver activePreset).
  const updateSlider = (key, value) => setSettings((current) => ({ ...current, [key]: value, activePreset: null }));
  const applyPreset = (key) => {
    const preset = EFFECT_PRESETS[key];
    setSettings((current) => ({ ...current, pitch: preset.pitch, rate: preset.rate, volume: preset.volume, activePreset: key }));
  };
  const stop = () => resetEngine();

  // Prueba la voz/pitch/velocidad actuales (o las de un preset puntual, ver
  // previewPreset) con un texto propio, sin depender de que el TTS esté
  // activo ni de estar conectado al LIVE — sirve para calibrar el efecto
  // antes de salir en vivo.
  const speakPreview = (pitch, rate, volume) => {
    if (!('speechSynthesis' in window) || !testText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = buildUtterance(testText.trim(), settings.voiceURI, pitch, rate, volume);
    utterance.onstart = () => setTesting(true);
    utterance.onend = () => setTesting(false);
    utterance.onerror = () => setTesting(false);
    window.speechSynthesis.speak(utterance);
  };
  const testVoice = () => speakPreview(settings.pitch, settings.rate, settings.volume);
  const previewPreset = (key) => { const p = EFFECT_PRESETS[key]; speakPreview(p.pitch, p.rate, p.volume); };

  const statusBadge = !settings.enabled
    ? { text: 'Apagado', cls: 'bg-[var(--surface-bg-alt)] border-[var(--surface-border-color)] text-gray-500' }
    : !connected
      ? { text: 'Esperando LIVE', cls: 'bg-amber-950/70 border-amber-500/50 text-amber-300' }
      : engineStatus === 'recovered'
        ? { text: '⚠ Motor recuperado', cls: 'bg-red-950/70 border-red-500/50 text-red-300' }
        : { text: '● Al aire', cls: 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' };

  return (
    <section className={`${visible ? 'flex-1' : 'hidden'} overflow-y-auto px-8 pt-24 pb-10 text-white`}>
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="theme-label text-[10px] uppercase tracking-[0.3em] font-black">🔊 Voz del Live</p>
            <h1 className="text-2xl font-black tracking-wide mt-2">TTS (BETA)</h1>
            <p className="text-sm text-gray-500 mt-2">Lee automáticamente los mensajes autorizados. Los mensajes con @ nunca se reproducen.</p>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border ${statusBadge.cls}`}>
            {statusBadge.text}
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

            <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--surface-border-color)' }}>
              <h3 className="text-xs font-black tracking-widest text-gray-400 mb-3">FILTROS DE MENSAJE</h3>

              <label className="block mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="theme-label text-[10px] uppercase tracking-widest font-black">Largo mínimo</span>
                  <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{settings.minChars} caracteres</span>
                </div>
                <input type="range" min="1" max="20" value={settings.minChars} onChange={(event) => update('minChars', Number(event.target.value))} className="w-full" />
                <p className="text-[10px] text-gray-500 mt-1">Mensajes más cortos que esto se ignoran (ej: "jaja", "ok").</p>
              </label>

              <Toggle checked={settings.ignoreRepeats} onChange={(v) => update('ignoreRepeats', v)} label="Ignorar repetidos" description="No lee el mismo mensaje (o uno igual) dos veces seguidas en pocos segundos." />

              <label className="block mt-4">
                <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Palabras bloqueadas</span>
                <input
                  value={settings.blockedWords}
                  onChange={(event) => update('blockedWords', event.target.value)}
                  placeholder="separadas por coma: palabra1, palabra2"
                  className="theme-input w-full p-3 outline-none text-sm text-white"
                />
                <p className="text-[10px] text-gray-500 mt-1">Si un mensaje contiene alguna de estas palabras, no se lee.</p>
              </label>
            </div>
          </div>

          <aside className="theme-surface p-6 flex flex-col min-h-[320px]">
            <div className="flex items-center justify-between gap-2">
              <p className="theme-label text-[10px] uppercase tracking-[0.25em] font-black">Monitor de voz</p>
              {queueCount > 0 && (
                <span className="theme-chip text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">{queueCount} en cola</span>
              )}
            </div>
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
            {engineStatus === 'recovered' && (
              <p className="text-[10px] text-red-400 font-bold mb-2 text-center">⚠ El motor de voz no respondió a tiempo y se reinició solo.</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={stop} disabled={!queueCount && engineStatus === 'idle'} className="theme-btn-secondary flex-1 py-3 text-[10px] font-black tracking-widest disabled:opacity-40">DETENER Y VACIAR COLA</button>
              <button type="button" onClick={resetEngine} title="Fuerza un reinicio del motor de voz si algo se traba" className="theme-btn-secondary px-4 py-3 text-[10px] font-black tracking-widest">↻</button>
            </div>
          </aside>
        </div>

        <div className="theme-surface p-6 mt-5">
          <h2 className="text-sm font-black tracking-widest mb-1">VOZ Y EFECTOS</h2>
          <p className="text-xs text-gray-500 mb-5">Elige un efecto de partida o ajusta pitch/velocidad/volumen a mano. Usa ▶ para escuchar cada uno antes de aplicarlo.</p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
            {Object.entries(EFFECT_PRESETS).map(([key, preset]) => (
              <div key={key} className={`theme-input p-2 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${settings.activePreset === key ? 'ring-2 ring-[var(--accent)]' : ''}`} onClick={() => applyPreset(key)} title={preset.hint}>
                <span className="text-lg leading-none">{preset.emoji}</span>
                <span className="text-[9px] font-black uppercase tracking-wide text-center">{preset.label}</span>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); previewPreset(key); }}
                  disabled={!('speechSynthesis' in window) || !testText.trim()}
                  className="theme-btn-secondary w-full py-1 text-[9px] font-black disabled:opacity-40"
                >▶</button>
              </div>
            ))}
          </div>

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
              <input type="range" min="0" max="2" step="0.1" value={settings.pitch} onChange={(event) => updateSlider('pitch', Number(event.target.value))} className="w-full" />
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="theme-label text-[10px] uppercase tracking-widest font-black">Velocidad</span>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{settings.rate.toFixed(1)}x</span>
              </div>
              <input type="range" min="0.5" max="3" step="0.1" value={settings.rate} onChange={(event) => updateSlider('rate', Number(event.target.value))} className="w-full" />
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="theme-label text-[10px] uppercase tracking-widest font-black">Volumen</span>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{Math.round(settings.volume * 100)}%</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => updateSlider('volume', Number(event.target.value))} className="w-full" />
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
