import { HowItWorks } from './PanelHelp';
import { randomVoicePool, utteranceTimeoutMs } from './ttsVoice';
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';

const STORAGE_KEY = 'tiktok-concurso-tts-settings';
// Segundos que un mensaje puede esperar en la cola antes de descartarse (ver
// maxMessageAgeSec en DEFAULTS y processQueue).
const DEFAULT_MAX_MESSAGE_AGE_SEC = 30;
// voiceURI/pitch/rate: el navegador ya trae varias voces gratis instaladas
// (del sistema operativo, más las "Google ..." que Chrome/Edge exponen
// cuando hay internet) — antes ni se elegían, quedaba lo que el navegador
// decidiera solo. pitch 1 = normal, más alto = voz aguda tipo "ardilla";
// rate 1 = velocidad normal del habla.
const DEFAULTS = {
  enabled: false, allUsers: false, moderators: true, superFans: true, fanMembers: true, minFanLevel: 1,
  usernameOverrides: [], // [{ username, mode: 'enabled'|'disabled' }] -- sincronizado con el backend, igual que los filtros de arriba
  voiceURI: '', pitch: 1, rate: 1, volume: 1, activePreset: 'normal',
  minChars: 2, ignoreRepeats: true, blockedWords: '', messageTemplate: '',
  // Voz aleatoria (pedido explícito): cada mensaje elige una voz al azar
  // entre las disponibles del navegador, en vez de la fija de `voiceURI` --
  // preferencia local de ESTE navegador, mismo criterio que voiceURI/pitch/
  // rate/volumen (ver comentario grande más abajo).
  randomVoice: false,
  maxMessageAgeSec: DEFAULT_MAX_MESSAGE_AGE_SEC,
};

// Tags del formato de lectura (pedido explícito) -- mismo criterio que las
// alertas (ver applyAlertTextTemplate en tenant.js): {username} es el
// @usuario real de TikTok, {nickname} su nombre público (con el mismo
// fallback a @usuario si no tiene uno), y {message} es el mensaje de chat
// en sí. Si el streamer no escribe {message} en algún lado de su plantilla,
// se lo agregamos al final a propósito -- así "listo, ya", el ejemplo más
// simple ("{username} dice:") funciona sin que tenga que acordarse de
// agregar el tag del mensaje. Si la plantilla queda vacía, se lee el
// mensaje tal cual, sin ningún cambio de comportamiento.
function applyMessageTemplate(message, template) {
  const t = (template || '').trim();
  if (!t) return message.comment;
  const hasMessageTag = /\{message\}/i.test(t);
  const built = t
    .replace(/\{username\}/gi, message.uniqueId || message.username || '')
    .replace(/\{nickname\}/gi, message.username || '')
    .replace(/\{message\}/gi, message.comment);
  return hasMessageTag ? built : `${built} ${message.comment}`.trim();
}

// Normaliza igual que el backend (sanitizeUsernameOverrides en tenant.js):
// sin '@' y en minúsculas, para que la comparación contra `message.uniqueId`
// en isOverridden sea directa.
const normalizeOverrideUsername = (value) => value.trim().replace(/^@/, '').toLowerCase();
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
const MAX_QUEUE = 15;
// Antes los mensajes que esperaban más de 12 s se descartaban en silencio,
// y con un chat movido parecía que "el bot dejó de leer". Ahora el tiempo es
// configurable (ver maxMessageAgeSec en DEFAULTS) y por defecto más generoso.
// Cada cuánto revisa que el motor de voz no se haya quedado mudo/pausado.
const ENGINE_KEEPALIVE_MS = 4000;
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
      <span aria-hidden="true" className="tkc-switch" />
      <span>
        <span className="block text-sm font-black text-white">{label}</span>
        <span className="block text-[11px] text-gray-500 mt-0.5">{description}</span>
      </span>
    </label>
  );
}

// `ref`: pedido explícito -- el nuevo Dashboard necesita poder
// activar/desactivar el TTS como un shortcut, sin tener que abrir esta
// pantalla. En vez de partir `enabled` a un estado propio de App.jsx
// (duplicaría la lógica que ya lee `settingsRef.current.enabled` dentro
// del handler de socket, con riesgo real de que un lado quede
// desincronizado del otro), este componente se sigue quedando como el
// único dueño de `settings` — el Dashboard solo recibe un control remoto
// (`toggleEnabled`/`setEnabled` vía ref) y un aviso de cada cambio
// (`onEnabledChange`) para poder mostrar el estado actual sin duplicarlo.
const TtsChat = forwardRef(function TtsChat({ socket, connectionStatus, visible, onEnabledChange, onEngineStatusChange }, ref) {
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
  const [newOverrideUsername, setNewOverrideUsername] = useState('');
  const [newOverrideMode, setNewOverrideMode] = useState('enabled');
  const [editingOverride, setEditingOverride] = useState(null);
  const [editingOverrideValue, setEditingOverrideValue] = useState('');
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

  // El padre (App.jsx) muestra el estado del motor en el indicador de salud.
  useEffect(() => { onEngineStatusChange?.(engineStatus); }, [engineStatus, onEngineStatusChange]);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, enabled: false }));
  }, [settings]);

  // Quién puede activar una lectura (allUsers/moderators/superFans/
  // fanMembers/minFanLevel) -- pedido explícito: que no se pierda al entrar
  // desde otro navegador/computadora. El resto de `settings` (voz elegida,
  // pitch/rate/volumen, filtros de mensaje) se queda 100% local a propósito
  // -- son preferencias de ESTE navegador/dispositivo (una voz instalada acá
  // puede ni existir en otra máquina), no algo que tenga sentido sincronizar.
  //
  // Bug real reportado: tocar +/- varias veces seguido en "nivel mínimo de
  // fan" (o cualquier toggle de arriba) hacía que el valor "subiera y
  // bajara solo" hasta quedar trabado en algo distinto de lo último
  // clickeado. Causa: cada cambio emitía al toque via el efecto de abajo, el
  // backend lo reenviaba (mismo tab incluido, ver Tenant.broadcast en
  // tenant.js) y el handler de acá arriba pisaba `settings` sin fijarse si
  // el streamer ya había hecho un click MÁS NUEVO mientras ese viaje de ida
  // y vuelta estaba en el aire -- y como el efecto de emitir depende del
  // propio `settings`, ese pisado encima disparaba un reenvío del valor
  // viejo, empeorando el problema en vez de asentarse. `emitTimeoutRef`
  // (el debounce de abajo) + `lastEmittedRef` cortan el lazo: mientras haya
  // un envío pendiente, o el eco no coincida con lo último que mandamos
  // (=> hay un click más nuevo que ese eco no vio todavía), se ignora.
  const emitTimeoutRef = useRef(null);
  const lastEmittedRef = useRef(null);
  useEffect(() => {
    if (!socket) return;
    const onSettingsUpdate = (server) => {
      if (!server || emitTimeoutRef.current) return;
      setSettings((current) => {
        const sent = lastEmittedRef.current;
        if (sent) {
          const matchesSent = current.allUsers === sent.allUsers && current.moderators === sent.moderators
            && current.superFans === sent.superFans && current.fanMembers === sent.fanMembers
            && current.minFanLevel === sent.minFanLevel
            && JSON.stringify(current.usernameOverrides) === JSON.stringify(sent.usernameOverrides);
          if (!matchesSent) return current; // ya hay un cambio local mas nuevo que este eco
        }
        return {
          ...current,
          allUsers: !!server.allUsers,
          moderators: !!server.moderators,
          superFans: !!server.superFans,
          fanMembers: !!server.fanMembers,
          minFanLevel: server.minFanLevel || current.minFanLevel,
          usernameOverrides: Array.isArray(server.usernameOverrides) ? server.usernameOverrides : current.usernameOverrides,
        };
      });
    };
    socket.on('tts_settings_update', onSettingsUpdate);
    return () => socket.off('tts_settings_update', onSettingsUpdate);
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    // Debounce a proposito (ver comentario de arriba): colapsa una racha de
    // clicks en un solo envío con el valor final, en vez de uno por click.
    if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
    emitTimeoutRef.current = setTimeout(() => {
      const payload = {
        allUsers: settings.allUsers, moderators: settings.moderators, superFans: settings.superFans,
        fanMembers: settings.fanMembers, minFanLevel: settings.minFanLevel,
        usernameOverrides: settings.usernameOverrides,
      };
      socket.emit('set_tts_settings', payload);
      lastEmittedRef.current = payload;
      emitTimeoutRef.current = null;
    }, 300);
    return () => { if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current); };
  }, [socket, settings.allUsers, settings.moderators, settings.superFans, settings.fanMembers, settings.minFanLevel, settings.usernameOverrides]);

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

  // Voz aleatoria (pedido explícito): con el switch activo, cada mensaje
  // sortea una voz distinta entre TODAS las disponibles del navegador, en
  // vez de usar siempre la fija de `voiceURI`. Si el navegador todavía no
  // reportó ninguna voz (ver el comentario de loadVoices más arriba), cae
  // en la voz configurada normal -- nunca deja el mensaje sin voz por esto.
  const pickVoice = (current) => {
    const pool = current.randomVoice ? randomVoicePool(voicesRef.current) : [];
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
    return resolveVoice(current.voiceURI, voicesRef.current);
  };

  // Muchos motores de voz "leen" los emojis en vez de ignorarlos (dicen el
  // nombre del ícono, o directamente un sonido raro) — se sacan del texto
  // ANTES de armar la utterance. El monitor de voz sigue mostrando el
  // comentario original tal cual lo escribió la persona, esto solo afecta
  // lo que se dice en voz alta.
  const stripEmojis = (text) => text
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  const buildUtterance = (text, voice, pitch, rate, volume) => {
    const utterance = new SpeechSynthesisUtterance(stripEmojis(text));
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
    const maxAgeMs = Math.max(5, Number(settingsRef.current.maxMessageAgeSec) || DEFAULT_MAX_MESSAGE_AGE_SEC) * 1000;
    while (queueRef.current.length && now - queueRef.current[0].ts > maxAgeMs) {
      queueRef.current.shift();
    }
    const next = queueRef.current.shift();
    setQueueCount(queueRef.current.length);
    if (!next) { setEngineStatus('idle'); return; }

    speakingRef.current = true;
    setEngineStatus('speaking');
    const current = settingsRef.current;
    const spokenText = applyMessageTemplate(next.message, current.messageTemplate);
    const utterance = buildUtterance(spokenText, pickVoice(current), current.pitch, current.rate, current.volume);
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
    }, utteranceTimeoutMs(spokenText, current.rate));

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

      // Lista blanca/negra: pisa el resto de los criterios de arriba en
      // ambas direcciones -- 'disabled' descalifica aunque cumpla todo,
      // 'enabled' autoriza aunque no cumpla nada (ver comentario de
      // sanitizeUsernameOverrides en tenant.js).
      const normalizedUniqueId = (message.uniqueId || '').toLowerCase();
      const override = normalizedUniqueId
        ? current.usernameOverrides.find((entry) => entry.username === normalizedUniqueId)
        : null;
      if (override?.mode === 'disabled') return;

      const authorized = override?.mode === 'enabled'
        || current.allUsers
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

  // Vigilancia del motor de voz mientras el TTS está activo. Chrome tiene un
  // bug conocido: a veces pausa o deja de avisar (sin onend/onerror) y la
  // cola se queda esperando para siempre; además congela los temporizadores
  // de las pestañas ocultas, así que el watchdog de cada mensaje puede no
  // dispararse a tiempo. Cada pocos segundos: si quedó pausado se reanuda, y
  // si creemos que hay un mensaje leyéndose pero el navegador ya no habla
  // nada, se da por terminado y se sigue con el siguiente.
  const recoverIfStuck = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (synth.paused) synth.resume();
    if (speakingRef.current && !synth.speaking && !synth.pending) {
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      speakingRef.current = false;
      processQueue();
    } else if (!speakingRef.current && queueRef.current.length > 0) {
      processQueue();
    }
  };
  const recoverIfStuckRef = useRef(recoverIfStuck);
  useEffect(() => { recoverIfStuckRef.current = recoverIfStuck; });

  const [hiddenNotice, setHiddenNotice] = useState('');
  useEffect(() => {
    if (!settings.enabled || !('speechSynthesis' in window)) return;
    const id = setInterval(() => recoverIfStuckRef.current(), ENGINE_KEEPALIVE_MS);
    let hiddenAt = null;
    let noticeTimer = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      recoverIfStuckRef.current();
      if (hiddenFor > 20000) {
        setHiddenNotice(`Esta pestaña estuvo oculta ${Math.round(hiddenFor / 1000)} s: el navegador puede haber pausado la voz. Ya la reanudamos.`);
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => setHiddenNotice(''), 8000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      clearTimeout(noticeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [settings.enabled]);

  useEffect(() => {
    if (!settings.enabled || connected) return;
    resetEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, connected]);

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  // CRUD de la lista blanca/negra -- agregar reemplaza cualquier entrada
  // previa del mismo @usuario en vez de duplicarla (ej: si ya estaba
  // deshabilitado y lo vuelven a agregar como habilitado, gana el nuevo).
  const addOverride = () => {
    const username = normalizeOverrideUsername(newOverrideUsername);
    if (!username) return;
    setSettings((current) => ({
      ...current,
      usernameOverrides: [...current.usernameOverrides.filter((entry) => entry.username !== username), { username, mode: newOverrideMode }],
    }));
    setNewOverrideUsername('');
  };
  const removeOverride = (username) => setSettings((current) => ({
    ...current,
    usernameOverrides: current.usernameOverrides.filter((entry) => entry.username !== username),
  }));
  const toggleOverrideMode = (username) => setSettings((current) => ({
    ...current,
    usernameOverrides: current.usernameOverrides.map((entry) => (
      entry.username === username ? { ...entry, mode: entry.mode === 'enabled' ? 'disabled' : 'enabled' } : entry
    )),
  }));
  const startEditOverride = (username) => { setEditingOverride(username); setEditingOverrideValue(username); };
  const cancelEditOverride = () => setEditingOverride(null);
  const saveEditOverride = () => {
    const username = normalizeOverrideUsername(editingOverrideValue);
    const previous = editingOverride;
    setEditingOverride(null);
    if (!username || username === previous) return;
    setSettings((current) => {
      // Si ya existe otra entrada con el nuevo nombre, se descarta la que
      // se estaba editando en vez de terminar con dos filas iguales.
      if (current.usernameOverrides.some((entry) => entry.username === username)) {
        return { ...current, usernameOverrides: current.usernameOverrides.filter((entry) => entry.username !== previous) };
      }
      return {
        ...current,
        usernameOverrides: current.usernameOverrides.map((entry) => (entry.username === previous ? { ...entry, username } : entry)),
      };
    });
  };

  // Avisa al padre (Dashboard) cada vez que `enabled` cambia -- así puede
  // mostrar el estado actual sin duplicarlo (ver comentario del forwardRef
  // más arriba).
  useEffect(() => {
    onEnabledChange?.(settings.enabled);
  }, [settings.enabled, onEnabledChange]);

  // Control remoto para el shortcut del Dashboard -- mismo candado que ya
  // tiene el botón ACTIVAR/DESACTIVAR de acá abajo: no se puede prender sin
  // estar conectado a un LIVE (sí se puede apagar siempre).
  useImperativeHandle(ref, () => ({
    resetEngine: () => resetEngine(),
    setEnabled: (value) => {
      if (value && !connected) return;
      update('enabled', !!value);
    },
    toggleEnabled: () => {
      if (!settings.enabled && !connected) return;
      update('enabled', !settings.enabled);
    },
  }), [connected, settings.enabled]);

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
    const utterance = buildUtterance(testText.trim(), pickVoice(settings), pitch, rate, volume);
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
    <section className={`${visible ? 'flex-1' : 'hidden'} overflow-y-auto px-4 sm:px-8 pt-10 pb-10 text-white`}>
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="theme-label text-[10px] uppercase tracking-[0.3em] font-black">🔊 Voz del Live</p>
            <h1 className="text-2xl font-black tracking-wide mt-2">TTS</h1>
            <p className="text-sm text-gray-500 mt-2">Lee automáticamente los mensajes autorizados. Los mensajes con @ nunca se reproducen.</p>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border ${statusBadge.cls}`}>
            {statusBadge.text}
          </span>
        </header>

        <HowItWorks storageKey="tts">
          <p>Cada mensaje del chat que cumpla tus reglas se <span className="font-bold text-white">lee en voz alta</span> con la voz del navegador donde tengas abierto este panel.</p>
          <p>Elige a quién leer (todos, moderadores, Super Fans o miembros del Fan Club), ajusta la voz y prueba cómo suena. Por seguridad el TTS se apaga cada vez que recargas la página: vuelve a activarlo al empezar.</p>
        </HowItWorks>

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
            {!connected && <p role="status" className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-700 p-3 text-xs mb-4">Para activar el TTS conecta una cuenta que esté transmitiendo en TikTok LIVE (desde el Dashboard).</p>}
            {!settings.allUsers && !settings.moderators && !settings.superFans && !settings.fanMembers && (
              <p role="status" className="rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-500 p-3 text-xs mb-4">Ahora mismo no se leerá a nadie: activa al menos una opción de abajo (por ejemplo "Todos los usuarios").</p>
            )}

            {hiddenNotice && <p role="status" className="rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-500 p-3 text-xs mb-4">{hiddenNotice}</p>}
            {settings.enabled && (
              <p className="text-[11px] text-gray-500 leading-snug mb-4">
                💡 Para que la voz no se pause, mantén esta pestaña visible (por ejemplo en una ventana aparte junto a tu transmisión): los navegadores frenan las pestañas ocultas.
              </p>
            )}

            <h3 className="text-xs font-black tracking-widest text-gray-400 mb-3">¿A QUIÉN LEER?</h3>

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

              <label className="block mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="theme-label text-[10px] uppercase tracking-widest font-black">Descartar mensajes que esperen más de</span>
                  <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{settings.maxMessageAgeSec} s</span>
                </div>
                <input type="range" min="10" max="120" step="5" value={settings.maxMessageAgeSec} onChange={(event) => update('maxMessageAgeSec', Number(event.target.value))} className="w-full" />
                <p className="text-[10px] text-gray-500 mt-1">Con el chat muy movido, los mensajes que llevan esperando más que esto se saltan para leer lo más reciente. Súbelo si quieres que se lea todo.</p>
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

              <label className="block mt-4">
                <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Formato de lectura</span>
                <input
                  value={settings.messageTemplate}
                  onChange={(event) => update('messageTemplate', event.target.value)}
                  placeholder="Ej: {username} dice:"
                  className="theme-input w-full p-3 outline-none text-sm text-white"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Opcional — si lo dejas vacío, se lee el mensaje tal cual. Tags disponibles:{' '}
                  <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{username}'}</code>{' '}
                  (usuario de TikTok),{' '}
                  <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{nickname}'}</code>{' '}
                  (nombre público) y{' '}
                  <code className="theme-chip px-1 py-0.5 rounded text-[9px]">{'{message}'}</code>{' '}
                  (el mensaje en sí — si no lo escribes, se agrega solo al final).
                </p>
                {settings.messageTemplate.trim() && (
                  <p className="text-[10px] theme-accent-text mt-2">
                    Se escuchará así: "{applyMessageTemplate({ uniqueId: 'usuario_de_prueba', username: 'Usuario de Prueba', comment: 'hola a todos' }, settings.messageTemplate)}"
                  </p>
                )}
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
              <button type="button" onClick={resetEngine} title="Fuerza un reinicio del motor de voz si algo se traba" className="theme-btn-secondary px-4 py-3 text-[10px] font-black tracking-widest">↻ Reiniciar voz</button>
            </div>
          </aside>
        </div>

        <div className="theme-surface p-6 mt-5">
          <h2 className="text-sm font-black tracking-widest mb-1">VOZ Y EFECTOS</h2>
          <p className="text-xs text-gray-500 mb-5">Elige un efecto de partida o ajusta pitch/velocidad/volumen a mano. Usa ▶ para escuchar cada uno antes de aplicarlo.</p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
            {Object.entries(EFFECT_PRESETS).map(([key, preset]) => (
              <div key={key} className={`theme-input p-2 flex flex-col items-center gap-1.5 transition-all ${settings.activePreset === key ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                {/* El efecto se elige con un botón de verdad (antes era un div clicable
                    que el teclado no alcanzaba); el ▶ de abajo solo lo escucha. */}
                <button type="button" onClick={() => applyPreset(key)} aria-pressed={settings.activePreset === key} title={preset.hint} className="w-full flex flex-col items-center gap-1.5 cursor-pointer">
                  <span className="text-lg leading-none" aria-hidden="true">{preset.emoji}</span>
                  <span className="text-[9px] font-black uppercase tracking-wide text-center">{preset.label}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); previewPreset(key); }}
                  disabled={!('speechSynthesis' in window) || !testText.trim()}
                  className="theme-btn-secondary w-full py-1 text-[9px] font-black disabled:opacity-40"
                  aria-label={`Escuchar el efecto ${preset.label}`}
                >▶</button>
              </div>
            ))}
          </div>

          <div className="mb-5">
            <Toggle
              checked={settings.randomVoice}
              onChange={(v) => update('randomVoice', v)}
              label="🎲 Voz aleatoria"
              description={`Cada mensaje usa una voz distinta en español (${randomVoicePool(voices).length} disponibles en este navegador), en vez de la fija de abajo.`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <label className={`block sm:col-span-2 ${settings.randomVoice ? 'opacity-45' : ''}`}>
              <span className="theme-label block text-[10px] uppercase tracking-widest font-black mb-2">Voz ({voices.length} disponibles)</span>
              <select
                value={settings.voiceURI}
                disabled={settings.randomVoice}
                onChange={(event) => update('voiceURI', event.target.value)}
                className="theme-input w-full p-3 outline-none text-sm font-bold text-white disabled:cursor-not-allowed"
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

        <div className="theme-surface p-6 mt-5">
          <h2 className="text-sm font-black tracking-widest mb-1">LISTA BLANCA / NEGRA</h2>
          <p className="text-xs text-gray-500 mb-5">Fuerza que un @usuario puntual se lea siempre o nunca, sin importar los filtros de arriba. Se sincroniza igual que ellos entre dispositivos.</p>

          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={newOverrideUsername}
              onChange={(event) => setNewOverrideUsername(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addOverride(); }}
              placeholder="usuario_de_tiktok (sin @)"
              className="theme-input flex-1 p-3 outline-none text-sm font-bold text-white min-w-0"
            />
            <select
              value={newOverrideMode}
              onChange={(event) => setNewOverrideMode(event.target.value)}
              className="theme-input p-3 outline-none text-sm font-bold text-white flex-shrink-0"
            >
              <option value="enabled">Habilitado (siempre se lee)</option>
              <option value="disabled">Deshabilitado (nunca se lee)</option>
            </select>
            <button type="button" onClick={addOverride} disabled={!newOverrideUsername.trim()} className="theme-btn-primary px-6 py-3 text-xs font-black tracking-widest disabled:opacity-40 flex-shrink-0">
              AGREGAR
            </button>
          </div>

          {settings.usernameOverrides.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">Todavía no agregaste ningún usuario a la lista.</p>
          ) : (
            <div className="space-y-2">
              {settings.usernameOverrides.map((entry) => (
                <div key={entry.username} className="theme-input flex items-center gap-2 px-3 py-2">
                  {editingOverride === entry.username ? (
                    <>
                      <input
                        autoFocus
                        value={editingOverrideValue}
                        onChange={(event) => setEditingOverrideValue(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') saveEditOverride(); if (event.key === 'Escape') cancelEditOverride(); }}
                        className="flex-1 bg-transparent outline-none text-sm font-bold text-white min-w-0"
                      />
                      <button type="button" onClick={saveEditOverride} aria-label="Guardar cambio" className="text-emerald-400 hover:opacity-70 text-sm font-black flex-shrink-0">✓</button>
                      <button type="button" onClick={cancelEditOverride} aria-label="Cancelar edición" className="text-gray-500 hover:opacity-70 text-sm font-black flex-shrink-0">✕</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-bold truncate">@{entry.username}</span>
                      <button
                        type="button"
                        onClick={() => toggleOverrideMode(entry.username)}
                        title="Click para cambiar entre habilitado y deshabilitado"
                        className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border flex-shrink-0 transition-opacity hover:opacity-80 ${entry.mode === 'enabled' ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-red-950/70 border-red-500/50 text-red-300'}`}
                      >
                        {entry.mode === 'enabled' ? 'Habilitado' : 'Deshabilitado'}
                      </button>
                      <button type="button" onClick={() => startEditOverride(entry.username)} aria-label={`Editar @${entry.username}`} className="text-gray-500 hover:opacity-80 text-sm flex-shrink-0">✎</button>
                      <button type="button" onClick={() => removeOverride(entry.username)} aria-label={`Quitar @${entry.username} de la lista`} className="text-gray-500 hover:text-red-400 text-sm font-black flex-shrink-0">✕</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

export default TtsChat;
