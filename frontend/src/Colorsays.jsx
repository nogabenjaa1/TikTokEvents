import React, { useState, useCallback, useEffect, useRef } from 'react';

const COLORS = [
  { name: 'Rojo',     emoji: '🔴', bgClass: 'bg-red-950',    borderClass: 'border-red-500',    textClass: 'text-red-400'    },
  { name: 'Verde',    emoji: '🟢', bgClass: 'bg-green-950',  borderClass: 'border-green-500',  textClass: 'text-green-400'  },
  { name: 'Azul',     emoji: '🔵', bgClass: 'bg-blue-950',   borderClass: 'border-blue-500',   textClass: 'text-blue-400'   },
  { name: 'Amarillo', emoji: '🟡', bgClass: 'bg-yellow-950', borderClass: 'border-yellow-500', textClass: 'text-yellow-400' },
  { name: 'Naranja',  emoji: '🟠', bgClass: 'bg-orange-950', borderClass: 'border-orange-500', textClass: 'text-orange-400' },
  { name: 'Morado',   emoji: '🟣', bgClass: 'bg-purple-950', borderClass: 'border-purple-500', textClass: 'text-purple-400' },
];

const MIN_DICE = 1;
const MAX_DICE = 6;
const DEFAULT_DICE = 4;

function rollFair(n) { return Array.from({ length: n }, () => Math.floor(Math.random() * COLORS.length)); }

function hasRepeat(results) {
  const counts = {};
  results.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return Object.values(counts).some(c => c >= 2);
}

// Ajuste personal del admin (sin regalos ni apuestas de por medio, solo para
// este mini-juego): sube la chance de que algún color quede repetido en la
// tirada, en vez de dejar el dado 100% libre. Generalizado para N dados —
// con 1 dado no hay repetición posible, y con 2 dados "forzar un par" es
// literalmente forzar que ambos salgan iguales, que es EXACTAMENTE la
// condición de "comodín" que dispara un re-tiro automático en finishRoll —
// forzarla de forma determinística ahí metía el juego en un loop infinito.
// Por eso el bias no hace nada con menos de 3 dados.
// Se aplica SOLO a la sesión admin: el resto de licencias de pago siempre
// tira con rollFair puro (igualdad de condiciones).
const PAIR_BIAS_CHANCE = 1.0;

function rollWithPairBias(n) {
  const results = rollFair(n);
  if (n < 3) return results; // 1-2 dados: ver comentario arriba, el bias no aplica
  if (results.every(r => r === results[0])) return results; // todos iguales: comodín, se resuelve aparte

  if (!hasRepeat(results) && Math.random() < PAIR_BIAS_CHANCE) {
    const idxA = Math.floor(Math.random() * n);
    let idxB = Math.floor(Math.random() * n);
    while (idxB === idxA) idxB = Math.floor(Math.random() * n);
    const adjusted = [...results];
    adjusted[idxB] = adjusted[idxA];
    return adjusted;
  }
  return results;
}

// Safe Mode: fuerza que `colorIdx` aparezca EXACTAMENTE `targetCount` veces
// entre los N dados. Las demás posiciones se llenan con otros colores al
// azar (nunca colorIdx), así el conteo final queda garantizado.
function rollWithExactCount(n, colorIdx, targetCount) {
  const clamped = Math.max(0, Math.min(n, targetCount));
  const otherColors = COLORS.map((_, i) => i).filter(i => i !== colorIdx);
  const positions = Array.from({ length: n }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const result = new Array(n);
  positions.forEach((pos, idx) => {
    result[pos] = idx < clamped ? colorIdx : otherColors[Math.floor(Math.random() * otherColors.length)];
  });
  return result;
}

// "Asegurar": garantiza que ese color salga EXACTAMENTE 1 vez (nunca 3, ni
// ningún otro conteo — a pedido explícito, un solo camino, no dos).
// "Bloquear": garantiza el camino FÁCIL (0 o el punto de equilibrio N/2).
// Generalizado para N dados.
function rollForSafeMode(n, colorIdx, action) {
  const half = Math.floor(n / 2);
  if (action === 'ensure') {
    return rollWithExactCount(n, colorIdx, 1);
  }
  if (action === 'block') {
    const targetCount = Math.random() < 0.7 ? half : 0;
    return rollWithExactCount(n, colorIdx, targetCount);
  }
  return rollWithPairBias(n);
}

let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick() {
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 200 + Math.random() * 100;
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

function playResultSound() {
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// El dado en sí sigue el tema elegido (forma/sombra/vidrio/relieve), pero
// NUNCA el color resultante una vez asentado: ese color es del juego
// (COLORS[i].bgClass/borderClass), no del tema — theme-die-shape solo le
// pone el radio/sombra/blur del estilo activo encima, sin tocar el color.
function Die({ colorIdx, rolling }) {
  const c = colorIdx !== null ? COLORS[colorIdx] : null;
  return (
    <div className={['w-20 h-20 flex items-center justify-center text-4xl flex-shrink-0 transition-all duration-300',
        rolling ? 'animate-[dieRoll_0.1s_ease-in-out_infinite_alternate] theme-die-rolling'
                : (c ? `${c.bgClass} ${c.borderClass} border-2 theme-die-shape` : 'theme-surface'),
      ].join(' ')}>
      {rolling ? '❓' : (c ? c.emoji : '⬜')}
    </div>
  );
}

// Sin overlay ni conexión al backend: se transmite directo desde esta
// pantalla (Window/Browser Capture en OBS), ya que no hay ajustes que
// sincronizar entre el operador y los espectadores.
//
// `isAdmin` gatea el sesgo de pares y el panel de Safe Mode: son ajustes
// personales del dueño de la plataforma (sin regalos ni apuestas de por
// medio), no algo que se le vende a las licencias de pago. El resto de
// usuarios siempre tira con probabilidades limpias (rollFair), en igualdad
// de condiciones entre ellos. El selector de cantidad de dados sí es una
// función disponible para todos.
export default function ColorSays({ isAdmin = false }) {
  const [diceCount, setDiceCount]   = useState(DEFAULT_DICE);
  const [diceResult, setDiceResult] = useState(() => Array(DEFAULT_DICE).fill(null));
  const [rolling, setRolling]       = useState(false);
  const [history, setHistory]       = useState([]);
  const tickIntervalRef             = useRef(null);

  // Safe Mode: override manual para un color puntual. 'ensure' fuerza el
  // camino difícil y 'block' fuerza el camino fácil. Solo aplica si isAdmin.
  const [safeModeColor, setSafeModeColor]   = useState(null);
  const [safeModeAction, setSafeModeAction] = useState('none'); // 'none' | 'ensure' | 'block'

  // Botón de pánico: por si un día se comparte pantalla completa por error,
  // el panel entero se puede ocultar de un clic. No persiste entre recargas
  // a propósito (arranca visible siempre), así nunca queda "oculto sin
  // querer" en la próxima sesión sin que el dueño se dé cuenta.
  const [safeModeHidden, setSafeModeHidden] = useState(false);

  const stopTicking = useCallback(() => {
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
  }, []);

  useEffect(() => stopTicking, [stopTicking]);

  // Cambiar la cantidad de dados resetea el tablero (nunca a mitad de tirada).
  const changeDiceCount = (n) => {
    if (rolling || n === diceCount) return;
    setDiceCount(n);
    setDiceResult(Array(n).fill(null));
  };

  const setSafeAction = (colorIdx, action) => {
    if (safeModeColor === colorIdx && safeModeAction === action) {
      setSafeModeAction('none'); // clic de nuevo sobre lo mismo = desactivar
    } else {
      setSafeModeColor(colorIdx);
      setSafeModeAction(action);
    }
  };

  const finishRoll = useCallback(() => {
    const results = !isAdmin
      ? rollFair(diceCount)
      : (safeModeAction !== 'none' && safeModeColor !== null
          ? rollForSafeMode(diceCount, safeModeColor, safeModeAction)
          : rollWithPairBias(diceCount));

    const allSame = diceCount > 1 && results.every(r => r === results[0]);

    if (allSame) {
      setDiceResult(Array(diceCount).fill(null));
      setTimeout(() => doRollInternal(), 1500);
      return;
    }

    stopTicking();
    playResultSound();
    setDiceResult(results);
    setRolling(false);
    setHistory(h => [results, ...h].slice(0, 8));
  }, [stopTicking, safeModeColor, safeModeAction, diceCount, isAdmin]);

  const doRollInternal = useCallback(() => {
    setRolling(true);
    setDiceResult(Array(diceCount).fill(null));
    stopTicking();
    tickIntervalRef.current = setInterval(playTick, 110);

    setTimeout(() => {
      finishRoll();
    }, 1200);
  }, [finishRoll, stopTicking, diceCount]);

  const doRoll = () => {
    if (rolling) return;
    ensureAudioCtx();
    doRollInternal();
  };

  return (
    <div className="flex-1 min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-16 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🎲 Color Says</p>

      <div className="flex gap-x-3 gap-y-1 justify-center flex-wrap max-w-sm">
        {COLORS.map((c, i) => (
          <span key={i} className={`text-xs font-bold ${c.textClass}`}>{c.name}</span>
        ))}
      </div>

      {/* Marco temático alrededor de la zona de dados: es justo la parte que
          se recorta/captura en OBS, así que queda contenida en una caja
          propia acorde al tema (vidrio/relieve/línea, según el estilo).
          Va pegado a las etiquetas de color, en la misma posición de
          siempre — el selector de dados NO va acá arriba para no correr
          esta zona de donde ya está calibrado el recorte de captura. */}
      <div className="theme-die-frame flex gap-3 justify-center flex-wrap max-w-md p-2">
        {diceResult.map((ci, d) => <Die key={d} colorIdx={ci} rolling={rolling} />)}
      </div>

      <button onClick={doRoll} disabled={rolling}
        className="theme-btn-primary px-12 py-4 rounded-xl font-black tracking-widest uppercase text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
        {rolling ? 'TIRANDO...' : 'TIRAR DADOS'}
      </button>

      {/* Selector de cantidad de dados: disponible para todas las licencias.
          Va DEBAJO del botón a propósito, para no mover la zona de dados de
          donde esté calibrado el recorte de captura en OBS. */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mr-1">Dados</span>
        {Array.from({ length: MAX_DICE - MIN_DICE + 1 }, (_, i) => MIN_DICE + i).map(n => (
          <button
            key={n}
            onClick={() => changeDiceCount(n)}
            disabled={rolling}
            className={[
              'w-7 h-7 rounded-lg border text-xs font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              diceCount === n ? 'theme-btn-primary border-transparent' : 'theme-input text-gray-400',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Altura fija (no depende de la cantidad de tiradas) para que los
          dados de arriba nunca se muevan al capturar una ventana recortada en OBS.
          También en su propio marco temático, igual que la zona de dados. */}
      <div className="theme-surface flex flex-col gap-1.5 w-full max-w-xs h-72 overflow-y-auto p-3">
        {history.length > 0 ? history.map((roll, i) => (
          <div key={i} className="theme-input flex items-center gap-3 px-3 py-2 flex-shrink-0">
            <span className="text-[10px] text-gray-600 w-4 flex-shrink-0">{history.length - i}</span>
            <div className="flex gap-1.5">
              {roll.map((ci, d) => <span key={d} className="text-lg leading-none">{COLORS[ci].emoji}</span>)}
            </div>
          </div>
        )) : (
          <p className="text-gray-700 text-xs italic text-center mt-2">Sin tiradas todavía...</p>
        )}
      </div>

      {/* Botón de pánico: una línea casi invisible pegada al borde derecho.
          A propósito no tiene ícono, texto ni tooltip — nada que delate que
          ahí hay un control si alguien comparte pantalla completa sin querer. */}
      {isAdmin && (
        <button
          onClick={() => setSafeModeHidden(h => !h)}
          aria-label="Mostrar u ocultar Safe Mode"
          className="fixed right-0 top-1/2 -translate-y-1/2 w-1.5 h-14 rounded-l-full bg-white/5 hover:bg-white/25 transition-colors z-50"
        />
      )}

      {/* Safe Mode: exclusivo del admin. El resto de licencias de pago no ve
          este panel ni tiene el sesgo de pares — siempre tiran limpio. */}
      {isAdmin && !safeModeHidden && (
        <div className="theme-surface fixed top-80 right-4 w-60 p-4">
          <p className="theme-accent-text text-[10px] uppercase tracking-widest font-black mb-3">🔒 Safe Mode</p>

          <div className="flex flex-col gap-1 mb-3 max-h-48 overflow-y-auto">
            {COLORS.map((c, i) => (
              <button key={i} onClick={() => setSafeModeColor(i)}
                className={['flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all',
                  safeModeColor === i ? `${c.bgClass} ${c.borderClass} border` : 'border border-transparent hover:bg-[#1A122E]'].join(' ')}>
                <span>{c.emoji}</span>
                <span className={`text-xs font-bold ${c.textClass}`}>{c.name}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={() => safeModeColor !== null && setSafeAction(safeModeColor, 'ensure')}
              disabled={safeModeColor === null}
              className={['flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed',
                safeModeColor !== null && safeModeAction === 'ensure' ? 'bg-green-600 text-white' : 'bg-[#130E24] border border-green-800/50 text-green-400 hover:bg-green-950/50'].join(' ')}>
              Asegurar
            </button>
            <button onClick={() => safeModeColor !== null && setSafeAction(safeModeColor, 'block')}
              disabled={safeModeColor === null}
              className={['flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed',
                safeModeColor !== null && safeModeAction === 'block' ? 'bg-red-600 text-white' : 'bg-[#130E24] border border-red-800/50 text-red-400 hover:bg-red-950/50'].join(' ')}>
              Bloquear
            </button>
          </div>

          <p className="text-[9px] text-gray-500 mt-3 leading-snug">
            {safeModeAction === 'none' && 'Elegí un color y una acción. Sin nada activo, tira con sesgo normal.'}
            {safeModeAction === 'ensure' && safeModeColor !== null && <>✅ Asegurando <span className={COLORS[safeModeColor].textClass}>{COLORS[safeModeColor].name}</span>: sale exactamente 1 vez.</>}
            {safeModeAction === 'block' && safeModeColor !== null && <>🔒 Bloqueando <span className={COLORS[safeModeColor].textClass}>{COLORS[safeModeColor].name}</span>: camino fácil.</>}
          </p>
        </div>
      )}
    </div>
  );
}
