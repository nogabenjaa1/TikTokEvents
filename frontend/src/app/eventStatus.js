// Estado de cada evento para el Dashboard y la barra de Eventos, sin React:
// solo lo que de verdad se sabe (el estado en vivo que manda el servidor, los
// ajustes guardados de la cuenta y la conexión al LIVE). Nada inventado: si no
// hay forma de saber algo, no se dice.
//
// Tonos (de más a menos urgente):
// - 'live':     en curso ahora.
// - 'paused':   en curso pero en pausa.
// - 'finished': terminó y el overlay muestra el resultado.
// - 'setup':    falta algo para poder iniciarlo (un regalo, una meta válida).
// - 'ready':    configurado; se puede iniciar en cuanto haya LIVE.
// Con extensión: este módulo se prueba con `node --test` tal cual.

// Eventos con inicio/fin propios (Spotify, Alertas, TTS y Chat están siempre
// disponibles y no tienen "en curso").
export const STATUS_EVENT_IDS = ['king', 'zub', 'elim', 'roulette', 'versus', 'extensible', 'goal'];

const TONE_ORDER = { live: 0, paused: 1, finished: 2, setup: 3, ready: 4 };
export const STATUS_LABELS = { live: 'En curso', paused: 'En pausa', finished: 'Terminado', setup: 'Falta configurar', ready: 'Listo para iniciar' };

const hasGift = (g) => !!(g && g.name);

// Lo que falta para poder iniciar, con los ajustes guardados (los mismos que
// ve el panel al abrirse). null = no falta nada. Versus guarda sus regalos en
// el servidor (llegan con su estado en vivo aunque no esté en curso): sin
// ninguno asignado se puede iniciar, pero ningún regalo sumaría nada.
function missingSetup(id, saved = {}, live = {}) {
  switch (id) {
    case 'king':
      return hasGift(saved.selectedGift) ? null : 'Elige el regalo objetivo';
    case 'elim':
      return hasGift(saved.selectedGift) ? null : 'Elige el regalo para unirse';
    case 'roulette':
      return saved.entryMode === 'gift' && !hasGift(saved.selectedGift) ? 'Elige el regalo para entrar' : null;
    case 'goal': {
      const n = Math.round(Number(saved.targetInput));
      return Number.isFinite(n) && n >= 1 ? null : 'Escribe la meta';
    }
    case 'versus':
      return (live.heroes?.length ?? 0) + (live.villains?.length ?? 0) > 0 ? null : 'Asigna regalos a cada lado';
    default:
      return null;
  }
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function liveDetail(id, live) {
  if (id === 'goal' && live.target > 0) return `${live.current ?? 0} de ${live.target}`;
  if (id === 'extensible' && live.timeLeft >= 0) return `Quedan ${mmss(live.timeLeft)}`;
  if (id === 'elim' && live.participants) return `${live.participants.length} participantes`;
  if (id === 'roulette' && live.entries) return `${live.entries.length} participantes`;
  if (id === 'versus') return `${live.heroScore ?? 0} a ${live.villainScore ?? 0}`;
  return null;
}

// `live`: el estado en vivo del evento (state, zubState...). `saved`: sus
// ajustes guardados. Devuelve { tone, label, detail }.
export function getEventStatus(id, live = {}, saved = {}) {
  if (live.isActive) {
    const tone = live.paused ? 'paused' : 'live';
    return { tone, label: STATUS_LABELS[tone], detail: liveDetail(id, live) };
  }
  if (live.finished || live.mode === 'finished') {
    return { tone: 'finished', label: STATUS_LABELS.finished, detail: null };
  }
  const missing = missingSetup(id, saved, live);
  if (missing) return { tone: 'setup', label: STATUS_LABELS.setup, detail: missing };
  return { tone: 'ready', label: STATUS_LABELS.ready, detail: null };
}

// Todos los eventos con estado, los más urgentes primero (a igualdad, en el
// orden de la barra de Eventos).
export function getAllEventStatuses(liveById = {}, settings = {}) {
  return STATUS_EVENT_IDS
    .map((id, index) => ({ id, index, ...getEventStatus(id, liveById[id], settings[id]) }))
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.index - b.index);
}

export const isRunning = (status) => status.tone === 'live' || status.tone === 'paused';
