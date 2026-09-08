import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { playThroneSteal, playSelecting, playEliminate, playWinner } from './sounds';
import { resolveBackgroundStyle, getUsernameOverride, getUsernameFill } from './overlayCustomization';
import { accentStyleVars } from './ThemeContext';
import { formatMMSS } from './timeFormat';

const MEDALS = ['🥇', '🥈', '🥉'];

// Calcula el avatar más grande que hace que TODOS los participantes entren
// en el área REAL medida del contenedor (ancho/alto en px), en vez de
// tamaños fijos por rango de cantidad. Así nunca se recorta ninguna burbuja
// ni la tarjeta necesita estirarse, sin importar cuánto espacio quede libre
// según qué otros bloques (insta-win, premio, aviso de eliminado) estén
// visibles en ese momento.
function computeElimBoxSize(containerWidth, containerHeight, count) {
  if (count <= 0 || containerWidth <= 0 || containerHeight <= 0) return { size: 64, gap: 6 };
  for (let size = 64; size >= 6; size -= 2) {
    const gap = size >= 18 ? 6 : 3; // con burbujas muy chicas, menos separación para aprovechar más el espacio
    const textSpace = size >= 18 ? 14 : 0; // debajo de cierto tamaño ya no se muestra el username
    const cellW = size + gap;
    const cellH = size + textSpace + gap;
    const cols = Math.max(1, Math.floor((containerWidth + gap) / cellW));
    const rows = Math.ceil(count / cols);
    if (rows * cellH <= containerHeight) return { size, gap };
  }
  return { size: 6, gap: 3 };
}

// Aviso fijo del tiempo de snipe (King/Zub) o de re-join (Eliminación),
// arriba de todo y bien visible: la gente lo ve ANTES de mandar el regalo,
// no recién cuando ese modo se activa.
function TimeWarningBadge({ label, seconds }) {
  if (typeof seconds !== 'number') return null;
  return (
    <div className="w-full flex justify-center">
      <span className="bg-red-950/70 border-2 border-red-500/70 text-red-200 font-black uppercase tracking-[0.2em] text-sm px-5 py-1.5 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.35)]">
        ⚠️ {label}: {formatMMSS(seconds)}
      </span>
    </div>
  );
}

// Franja de premio compartida por los tres modos: imagen opcional de
// 50x50 + título. Solo se muestra si hay algo configurado.
function PrizeStrip({ prize }) {
  if (!prize || (!prize.title && !prize.image)) return null;
  return (
    <div className="mt-3 flex items-center gap-3 bg-emerald-900/25 border border-emerald-500/40 px-4 py-2 rounded-xl w-full">
      {prize.image && (
        <img src={prize.image} className="w-[50px] h-[50px] rounded-lg object-cover flex-shrink-0 border border-emerald-400/40" />
      )}
      <div className="text-left leading-tight min-w-0">
        <span className="block text-[8px] uppercase tracking-widest text-emerald-400 font-bold">🎁 PREMIO:</span>
        {prize.title && <span className="text-sm font-black text-emerald-100 break-words">{prize.title}</span>}
      </div>
    </div>
  );
}

function OfflineCard() {
  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <div className="w-32 h-32 rounded-full border-4 border-dashed flex items-center justify-center mb-8 animate-pulse" style={{ borderColor: 'var(--surface-border-color)', background: 'color-mix(in oklch, var(--surface-bg-alt) 50%, transparent)' }}>
        <span className="text-5xl opacity-40">💤</span>
      </div>
      <h2 className="text-2xl font-black text-gray-500 tracking-widest uppercase mb-3 text-center">Sin conexión</h2>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
        <p className="text-[10px] text-gray-600 font-bold text-center uppercase tracking-[0.3em]">Esperando al streamer...</p>
      </div>
    </div>
  );
}

function KingOverlay({ state, prize, customize }) {
  // Detecta transiciones para disparar sonido: robo de trono (cambia el
  // lastParticipant mientras está en 'main') y ganador. El guard `mounted`
  // evita que sonar apenas se abre/recarga el overlay a mitad de una ronda.
  const prevRef = useRef({ mounted: false, mode: null, lastUsername: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevRef.current;
    if (prev.mounted) {
      if (state.mode === 'main' && state.lastParticipant?.username && state.lastParticipant.username !== prev.lastUsername) {
        playThroneSteal();
      }
      if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) {
        playWinner();
      }
    }
    prevRef.current = { mounted: true, mode: state.mode, lastUsername: state.lastParticipant?.username || null };
  }, [state?.mode, state?.lastParticipant?.username, state?.winner]);

  if (!state.isActive && state.mode !== 'finished') return <OfflineCard />;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mb-3">ROBA EL LUGAR CON:</p>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
          <div className="flex items-center gap-2">
            {state.targetGiftIcon && <img src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-xl font-black text-white">{state.targetGiftName}</span>
          </div>
          <span className="text-yellow-400 text-lg font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl shadow-inner">{state.targetGiftCoins} 🪙</span>
        </div>

        {state.instaWinGiftName && state.instaWinGiftName.length > 0 && (
          <div className="mt-3 flex items-center justify-between bg-yellow-900/30 border border-yellow-600/50 px-4 py-2 rounded-xl w-full">
            <div className="flex items-center gap-2">
              <img src={state.instaWinGiftIcon} className="w-6 h-6" />
              <div className="text-left leading-tight">
                <span className="block text-[8px] uppercase tracking-widest text-yellow-500 font-bold">O INSTA-WIN:</span>
                <span className="text-sm font-bold text-yellow-100">{state.instaWinGiftName}</span>
              </div>
            </div>
            <span className="text-yellow-400 text-sm font-black bg-yellow-500/20 px-2 py-1 rounded-lg">{state.instaWinGiftCoins} 🪙</span>
          </div>
        )}

        <PrizeStrip prize={prize} />
      </div>

      <div className="my-10 w-full flex flex-col items-center">
        {state.lastParticipant ? (
          <div key={state.lastParticipant.username + state.timeLeft} className="flex flex-col items-center animate-pop">
            <div className="relative">
              {state.mode === 'finished' && <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>}
              <div className={`absolute inset-0 rounded-full blur-xl opacity-60 ${state.mode === 'finished' ? 'bg-yellow-500' : ''}`} style={state.mode === 'finished' ? undefined : { background: 'var(--accent)' }} />
              <img src={state.lastParticipant.avatar} className={`w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl ${state.mode === 'finished' ? 'border-yellow-400' : ''}`} style={state.mode === 'finished' ? undefined : { borderColor: 'var(--accent)' }} />
            </div>
            <p className={`text-2xl font-black mt-6 tracking-wide drop-shadow-md ${state.mode === 'finished' ? 'text-yellow-400' : ''} ${getUsernameOverride(customize).className}`} style={{ ...(state.mode === 'finished' ? undefined : { color: 'var(--accent-soft)' }), ...getUsernameOverride(customize).cssVars }}>@{state.lastParticipant.username}</p>
          </div>
        ) : <div className="w-32 h-32 rounded-full border-2 border-dashed flex items-center justify-center" style={{ borderColor: 'var(--surface-border-color)', background: 'color-mix(in oklch, var(--surface-bg-alt) 50%, transparent)' }}><span className="text-4xl opacity-30">👤</span></div>}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse py-4">WINNER!</div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">{state.paused ? 'PAUSADO' : state.mode === 'waiting' ? 'ESPERANDO...' : 'TIEMPO RESTANTE'}</p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'waiting' ? 'text-gray-500' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>          </div>
        )}
      </div>
    </div>
  );
}

function ZubastinisOverlay({ state, prize, customize }) {
  // Mismo sonido de ganador que King/Eliminación, para que el momento se
  // sienta igual sin importar el modo.
  const prevModeRef = useRef({ mounted: false, mode: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevModeRef.current;
    if (prev.mounted && state.mode === 'finished' && prev.mode !== 'finished' && state.winner) {
      playWinner();
    }
    prevModeRef.current = { mounted: true, mode: state.mode };
  }, [state?.mode, state?.winner]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard />;

  const top3 = state.top3 || [];
  const noWinnerMessage = state.mode === 'finished' && !state.winner
    ? (state.noWinnerReason === 'minimum' ? `Nadie llegó al mínimo de ${state.minCoins} 🪙` : 'Nadie participó')
    : null;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.mode === 'tiebreak' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-amber-500 to-amber-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🤝 DESEMPATE 🤝</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mt-3 mb-4">🏆 TOP REGALADORES</p>

      <div className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-2" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
        <span className="text-[9px] uppercase tracking-widest text-gray-400 font-bold">Mínimo para ganar:</span>
        <span className={`text-sm font-black ${state.minCoins > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
          {state.minCoins > 0 ? `${state.minCoins} 🪙` : 'Sin mínimo'}
        </span>
      </div>

      <div className="w-full mb-6">
        <PrizeStrip prize={prize} />
      </div>

      <div className="w-full flex-1 flex flex-col gap-3 justify-center">
        {top3.length > 0 ? top3.map((g, i) => (
          <div key={g.username} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${i === 0 ? 'border border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.35)]' : 'border'}`} style={i === 0 ? resolveBackgroundStyle(customize, 'var(--surface-bg-alt)') : { borderColor: 'var(--surface-border-color)', ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)') }}>
            <span className="text-2xl">{MEDALS[i]}</span>
            <img src={g.avatar} className={`w-12 h-12 rounded-full border-2 object-cover ${i === 0 ? 'border-yellow-400' : ''}`} style={i === 0 ? undefined : { borderColor: 'var(--accent)' }} />
            <span className={`flex-1 font-black text-white truncate ${getUsernameOverride(customize).className}`} style={getUsernameOverride(customize).cssVars}>@{g.username}</span>
            <span className="text-yellow-400 font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl">{g.coins} 🪙</span>
          </div>
        )) : (
          <p className="text-gray-600 text-sm italic text-center">Esperando regalos...</p>
        )}
      </div>

      <div className="w-full text-center mt-auto pt-6">
        {state.mode === 'finished' ? (
          <div className="flex flex-col items-center gap-2 py-2">
            {state.winner ? (
              <>
                <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse">¡GANADOR!</div>
                <p className="text-lg font-black text-yellow-400"><span className={getUsernameOverride(customize).className} style={getUsernameOverride(customize).cssVars}>@{state.winner.username}</span> · {state.winner.coins} 🪙</p>
              </>
            ) : (
              <>
                <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
                <p className="text-sm font-bold text-gray-400">{noWinnerMessage}</p>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">
              {state.paused ? 'PAUSADO' : state.mode === 'tiebreak' ? 'DESEMPATE' : 'TIEMPO RESTANTE'}
            </p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'tiebreak' ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>          </div>
        )}
      </div>
    </div>
  );
}

// Tope de cuántos eliminados se dibujan en la fase de "resultado" (1
// grande + hasta 4 burbujas) — mismo valor que ELIM_RESULT_DISPLAY_CAP en
// tenant.js, pedido explícito. El resto (si eliminationsPerRound trae más)
// se resume como texto "y N más...".
const RESULT_DISPLAY_CAP = 5;

// Resalta hasta RESULT_DISPLAY_CAP índices al azar del pool mientras
// `active` es true, cambiando cada `intervalMs` — puramente cosmético
// durante la fase de "selección" (pedido explícito: no importa quién
// aparezca ahí, los eliminados de VERDAD los decidió el backend y recién
// se muestran en la fase de "resultado", ver EliminationResultVisual).
function useFlickerHighlight(active, poolLength, intervalMs = 180) {
  const [indexes, setIndexes] = useState([]);
  useEffect(() => {
    if (!active || poolLength <= 0) { setIndexes([]); return; }
    const pick = () => {
      const pool = Array.from({ length: poolLength }, (_, i) => i);
      const count = Math.min(RESULT_DISPLAY_CAP, poolLength);
      const chosen = [];
      for (let i = 0; i < count && pool.length; i++) {
        chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      setIndexes(chosen);
    };
    pick();
    const id = setInterval(pick, intervalMs);
    return () => clearInterval(id);
  }, [active, poolLength, intervalMs]);
  return indexes;
}

// Barra que se vacía de 100% a 0% en `durationMs` — pedido explícito: que
// la duración configurada de cada fase (revealSelectMs/revealResultMs, ver
// tenant.js) se vea reflejada en el overlay, no solo en el timing interno.
// Vía transición CSS pura (sin setInterval): al activarse fuerza un primer
// frame al 100% y recién en el siguiente pide el 0%, así el navegador anima
// la transición completa en vez de arrancar ya vacía. Cambiar `durationMs`
// mientras está activa (ej. Fast Mode a mitad de ciclo) no debería pasar en
// la práctica, ya que cada fase nueva vuelve a montar esta barra desde cero.
function PhaseProgressBar({ active, durationMs, colorClass }) {
  const [full, setFull] = useState(true);
  useEffect(() => {
    if (!active) return;
    setFull(true);
    const raf = requestAnimationFrame(() => setFull(false));
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs]);
  if (!active) return null;
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden bg-black/30 mt-3">
      <div className={`h-full ${colorClass}`} style={{ width: full ? '100%' : '0%', transition: `width ${durationMs}ms linear` }} />
    </div>
  );
}

// Resultado de una ronda de eliminación — el primero en grande (mismo
// criterio visual que el cartel de GANADOR: avatar con glow + texto
// grande "ELIMINATED", en inglés a propósito, mismo pedido explícito que
// ya usaba el cartel individual anterior), hasta RESULT_DISPLAY_CAP-1 más
// en burbujas al lado, y "y N más..." si sobran. Reemplaza a la grilla de
// participantes mientras dura la fase de "resultado" — el backend ya se
// encarga de que esa fase tenga un fin de ciclo fijo (ver
// REVEAL_RESULT_MS en tenant.js), así que no hace falta ningún timer acá.
function EliminationResultVisual({ list }) {
  if (!list || list.length === 0) return null;
  const [first, ...rest] = list;
  const bubbles = rest.slice(0, RESULT_DISPLAY_CAP - 1);
  const extra = list.length - 1 - bubbles.length;
  return (
    <div className="flex flex-col items-center gap-3 animate-pop">
      <div className="relative">
        <div className="absolute -top-10 -right-6 text-[56px] drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] z-30">💀</div>
        <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-red-600" />
        <img src={first.avatar} className="w-24 h-24 rounded-full border-4 relative z-10 object-cover shadow-2xl border-red-500 grayscale" />
      </div>
      <div className="text-[28px] leading-none font-black tracking-widest text-red-500 animate-pulse">ELIMINATED</div>
      <p className="text-sm font-black text-red-300">@{first.username}</p>
      {(bubbles.length > 0 || extra > 0) && (
        <div className="flex items-center gap-2 flex-wrap justify-center max-w-full px-2">
          {bubbles.map((e, i) => (
            <div key={e.username + i} className="flex flex-col items-center gap-0.5">
              <img src={e.avatar} className="w-10 h-10 rounded-full border-2 border-red-500 object-cover grayscale" />
              <span className="text-[8px] text-red-300 max-w-[44px] truncate">@{e.username}</span>
            </div>
          ))}
          {extra > 0 && <span className="text-xs font-bold text-red-300">y {extra} más...</span>}
        </div>
      )}
    </div>
  );
}

function EliminationOverlay({ state, prize, customize }) {
  const gridRef = useRef(null);
  const [boxSize, setBoxSize] = useState(64);
  const [gridGap, setGridGap] = useState(6);

  // Sonidos: arranca el sorteo ('revealing'), se resuelve la ronda
  // ('revealing' -> 'result', el momento real en que el backend ya sacó a
  // los eliminados), y el mismo sonido de ganador que King/Zub.
  const prevElimRef = useRef({ mounted: false, mode: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevElimRef.current;
    if (prev.mounted) {
      if (state.mode === 'revealing' && prev.mode !== 'revealing') playSelecting();
      if (state.mode === 'result' && prev.mode === 'revealing') playEliminate();
      if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) playWinner();
    }
    prevElimRef.current = { mounted: true, mode: state.mode };
  }, [state?.mode, state?.winner]);

  const participants = (state && state.participants) || [];
  // Puramente cosmético — ver comentario de useFlickerHighlight. Los
  // eliminados de VERDAD llegan en state.lastEliminatedList recién en la
  // fase de "resultado", no dependen de esto para nada.
  const flickerIndexes = useFlickerHighlight(state?.mode === 'revealing', participants.length);

  // Mide el área real disponible para la grilla de participantes y
  // recalcula el tamaño de burbuja más grande que hace que todos entren —
  // se re-ejecuta con cualquier cambio de layout (aparece/desaparece el
  // insta-win, el premio, el aviso de eliminado, etc), no solo la cantidad.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = () => {
      const { size, gap } = computeElimBoxSize(el.clientWidth, el.clientHeight, participants.length);
      setBoxSize(size);
      setGridGap(gap);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [participants.length, state && state.instaWinGiftName, prize, state && state.mode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard />;

  const timerTitle = state.mode === 'rejoin' ? 'REINGRESO' : 'TIEMPO PARA UNIRSE';
  const showLabel = boxSize >= 18;

  return (
    // Altura FIJA (no min-h): con muchos participantes las burbujas se
    // achican vía elimSizeFor en vez de estirar la tarjeta — si el overlay
    // cambia de tamaño se rompe el recorte/captura ya encuadrado en OBS.
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'rejoin' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ REINGRESO ⚠️</div>}
      {state.mode === 'revealing' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🎯 ¿QUIÉN SERÁ? 🎯</div>}
      {state.paused && state.mode !== 'finished' && state.mode !== 'revealing' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      {/* En Eliminación el equivalente al snipe es la ventana de re-join:
          se muestra desde el arranque para que sepan cuánto tiempo van a
          tener para volver a entrar después de cada eliminación. */}
      <div className="mt-6 w-full">
        <TimeWarningBadge label="Reingreso" seconds={state.rejoinTime} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <div className="flex items-center gap-2 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold">💀 ELIMINACIÓN — ÚNETE CON:</p>
          {/* Pedido explícito: el público tiene que saber en qué modo están
              jugando — Locked Mode significa que nadie nuevo entra ya
              arrancada la dinámica. */}
          {state.lockedMode && (
            <span className="bg-slate-800 border border-slate-500/60 text-slate-300 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0">🔒 Locked</span>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
          <div className="flex items-center gap-2">
            {state.targetGiftIcon && <img src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-xl font-black text-white">{state.targetGiftName}</span>
          </div>
          <span className="text-yellow-400 text-lg font-black bg-yellow-400/10 border border-yellow-400/20 px-3 py-1 rounded-xl shadow-inner">{state.targetGiftCoins} 🪙</span>
        </div>

        {state.instaWinGiftName && state.instaWinGiftName.length > 0 && (
          <div className="mt-3 flex items-center justify-between bg-yellow-900/30 border border-yellow-600/50 px-4 py-2 rounded-xl w-full">
            <div className="flex items-center gap-2">
              <img src={state.instaWinGiftIcon} className="w-6 h-6" />
              <div className="text-left leading-tight">
                <span className="block text-[8px] uppercase tracking-widest text-yellow-500 font-bold">O INSTA-WIN:</span>
                <span className="text-sm font-bold text-yellow-100">{state.instaWinGiftName}</span>
              </div>
            </div>
            <span className="text-yellow-400 text-sm font-black bg-yellow-500/20 px-2 py-1 rounded-lg">{state.instaWinGiftCoins} 🪙</span>
          </div>
        )}

        <PrizeStrip prize={prize} />
      </div>

      <div ref={gridRef} style={{ gap: gridGap }} className="w-full flex-1 flex flex-wrap justify-center items-center content-center my-2 overflow-hidden">
        {state.mode === 'finished' ? (
          state.winner && (
            <div className="flex flex-col items-center animate-pop">
              <div className="relative">
                <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-yellow-500" />
                <img src={state.winner.avatar} className="w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
            </div>
          )
        ) : state.mode === 'result' ? (
          <EliminationResultVisual list={state.lastEliminatedList} />
        ) : participants.length > 0 ? (
          participants.map((p, i) => {
            const isHighlighted = state.mode === 'revealing' && flickerIndexes.includes(i);
            return (
              <div key={p.id} title={p.username} style={{ width: boxSize }}
                className={`flex flex-col items-center gap-0.5 transition-all duration-150 ${state.mode === 'revealing' ? (isHighlighted ? 'scale-125 z-10' : 'opacity-30 scale-90') : ''}`}>
                <img src={p.avatar} style={{ width: boxSize, height: boxSize, borderColor: isHighlighted ? undefined : 'var(--accent)' }}
                  className={`rounded-full border-2 object-cover flex-shrink-0 ${isHighlighted ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]' : ''}`} />
                {showLabel && (
                  <span style={{ fontSize: Math.max(4, Math.round(boxSize * 0.22)), ...getUsernameOverride(customize).cssVars }} className={`max-w-full truncate ${isHighlighted ? 'text-yellow-300 font-bold' : 'text-gray-300'} ${getUsernameOverride(customize).className}`}>@{p.username}</span>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-gray-600 text-sm italic text-center">Esperando participantes...</p>
        )}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="flex flex-col items-center gap-2 py-2">
            {state.winner ? (
              <>
                <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse">¡GANADOR!</div>
                <p className={`text-lg font-black text-yellow-400 ${getUsernameOverride(customize).className}`} style={getUsernameOverride(customize).cssVars}>@{state.winner.username}</p>
              </>
            ) : (
              <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
            )}
          </div>
        ) : state.mode === 'revealing' ? (
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎲 SORTEANDO...</p>
            <PhaseProgressBar active={state.mode === 'revealing'} durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
          </div>
        ) : state.mode === 'result' ? (
          <div className="border border-red-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-lg font-black text-red-300 uppercase tracking-widest">💀 Eliminados</p>
            <PhaseProgressBar active={state.mode === 'result'} durationMs={state.revealResultMs} colorClass="bg-red-400" />
          </div>
        ) : (
          // Más chico que en King/Zub a propósito: le deja más espacio a la
          // grilla de participantes, que puede tener muchos más elementos.
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">{state.paused ? 'PAUSADO' : timerTitle}</p>
            <p className={`text-[52px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>{formatMMSS(state.timeLeft)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Convierte un ángulo (grados, 0 = arriba, sentido horario) + radio en un
// punto x/y sobre el círculo de centro (cx, cy) — la base trigonométrica
// para armar cada sección de la ruleta como un <path> de SVG.
function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const WHEEL_COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#14b8a6'];

// La ruleta de verdad: un círculo dividido en tantas secciones iguales
// como entradas queden, cada una con el username adentro (nunca la foto —
// eso pedido explícito: la foto de perfil solo se muestra al final, con
// el ganador). `highlightUsername` resalta la sección que el backend acaba
// de resolver (roja si sale eliminada, dorada si es la ganadora) — quien
// gira la rueda hasta dejarla bajo el puntero es RouletteOverlay, este
// componente solo dibuja el estado actual, nunca gira por su cuenta.
// <defs> con los degradados que puede pedir getUsernameFill: "arcoíris"
// (id fijo, siempre los mismos colores) y "gradient" (id fijo pero
// alimentado con los dos colores que haya elegido el streamer en esta
// personalización) — un solo par compartido por todos los <text> de la
// rueda, se define una sola vez sin importar si algún username lo termina
// usando o no (no cuesta nada si no se referencia).
function UsernameSvgDefs({ customize }) {
  const uc = customize?.usernameColor;
  return (
    <defs>
      <linearGradient id="tkc-rainbow-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ff3b3b" />
        <stop offset="20%" stopColor="#ff9f1c" />
        <stop offset="40%" stopColor="#ffe135" />
        <stop offset="60%" stopColor="#3ddc84" />
        <stop offset="80%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
      <linearGradient id="tkc-custom-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={uc?.from || '#7C3AED'} />
        <stop offset="100%" stopColor={uc?.to || '#3B82F6'} />
      </linearGradient>
    </defs>
  );
}

function RouletteWheel({ entries, highlightUsername, highlightColor, size, customize }) {
  const n = entries.length;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  const nameFill = getUsernameFill(customize, 'white');
  if (n === 0) return null;

  if (n === 1) {
    const only = entries[0];
    return (
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        <UsernameSvgDefs customize={customize} />
        <circle cx={cx} cy={cy} r={r} fill={WHEEL_COLORS[0]} stroke="white" strokeWidth="2" />
        <text x={cx} y={cy} fontSize="13" fill={nameFill} fontWeight="800" textAnchor="middle" dominantBaseline="middle">
          @{only.username.length > 14 ? only.username.slice(0, 13) + '…' : only.username}
        </text>
      </svg>
    );
  }

  const anglePer = 360 / n;
  // Con muchas secciones no entra texto legible — a partir de cierta
  // densidad se muestran solo los colores, sin nombres encimados.
  const fontSize = n > 40 ? 0 : n > 24 ? 6 : n > 14 ? 8 : n > 8 ? 10 : 12;
  const maxChars = n > 24 ? 6 : n > 14 ? 8 : 12;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
      <UsernameSvgDefs customize={customize} />
      {entries.map((e, i) => {
        const startAngle = i * anglePer;
        const endAngle = startAngle + anglePer;
        const start = polarPoint(cx, cy, r, startAngle);
        const end = polarPoint(cx, cy, r, endAngle);
        const largeArc = anglePer > 180 ? 1 : 0;
        const path = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
        const midAngle = startAngle + anglePer / 2;
        const labelPos = polarPoint(cx, cy, r * 0.62, midAngle);
        const isHighlighted = e.username === highlightUsername;
        // Texto RADIAL: del centro hacia el borde de su sección, no
        // tangencial (girando alrededor del círculo). La rotación base es
        // midAngle - 90 (el texto nace apuntando "a la derecha", hay que
        // girarlo hasta apuntar en la dirección radial real); en la mitad
        // izquierda del círculo eso lo dejaría cabeza abajo, así que ahí se
        // le suman 180° más — se sigue leyendo desde el centro hacia
        // afuera, solo que reflejado para que nunca quede invertido.
        const pointsLeft = midAngle > 90 && midAngle < 270;
        const textRotate = pointsLeft ? midAngle + 90 : midAngle - 90;
        return (
          <g key={e.id}>
            <path d={path} fill={isHighlighted ? (highlightColor || '#ef4444') : WHEEL_COLORS[i % WHEEL_COLORS.length]}
              stroke="white" strokeWidth={isHighlighted ? 3 : 1.5} opacity={isHighlighted ? 1 : 0.92}
              style={{ transition: 'fill 200ms ease, opacity 200ms ease' }} />
            {fontSize > 0 && (
              <text x={labelPos.x} y={labelPos.y} fontSize={isHighlighted ? fontSize + 2 : fontSize} fill={nameFill} fontWeight="700"
                textAnchor="middle" dominantBaseline="middle" transform={`rotate(${textRotate}, ${labelPos.x}, ${labelPos.y})`}>
                @{e.username.length > maxChars ? e.username.slice(0, maxChars - 1) + '…' : e.username}
              </text>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.13} fill="white" stroke="var(--accent)" strokeWidth="3" />
    </svg>
  );
}

// El backend gobierna el ciclo entero de 2 fases (spinning/result, ver
// beginRouletteStep/resolveRouletteStep en tenant.js), así que este
// componente ya no tiene que coreografiar nada por su cuenta: la rueda
// (RouletteWheel) es un elemento puramente decorativo mientras se está
// "uniendo" gente — no hay forma física de girarla hasta señalar a VARIAS
// personas a la vez (eliminationsPerRound), así que en cuanto arranca el
// sorteo se reemplaza por el mismo destello + resultado en burbujas que
// usa Eliminación (ver useFlickerHighlight/EliminationResultVisual),
// consistente entre los dos modos.
function RouletteOverlay({ state, prize, customize }) {
  const wheelBoxRef = useRef(null);
  const [wheelSize, setWheelSize] = useState(240);

  // Sonidos: arranca el sorteo ('spinning'), se resuelve un paso
  // ('spinning' -> 'result', el momento real en que el backend ya sacó a
  // los eliminados), y el mismo sonido de ganador que los demás modos.
  const prevRef = useRef({ mounted: false, mode: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevRef.current;
    if (prev.mounted) {
      if (state.mode === 'spinning' && prev.mode !== 'spinning') playSelecting();
      if (state.mode === 'result' && prev.mode === 'spinning') playEliminate();
      if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) playWinner();
    }
    prevRef.current = { mounted: true, mode: state.mode };
  }, [state?.mode, state?.winner]);

  const entries = (state && state.entries) || [];
  const flickerIndexes = useFlickerHighlight(state?.mode === 'spinning', entries.length);

  useLayoutEffect(() => {
    const el = wheelBoxRef.current;
    if (!el) return;
    const recompute = () => setWheelSize(Math.max(120, Math.min(el.clientWidth, el.clientHeight)));
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [prize, state && state.mode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard />;

  const entryRuleLabel = state.entryMode === 'gift'
    ? `Manda ${state.targetGiftName || '...'}`
    : `Comenta "${state.keyword || '...'}"`;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {state.mode === 'spinning' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🎡 GIRANDO 🎡</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Cierra en" seconds={state.mode === 'joining' ? state.timeLeft : undefined} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <div className="flex items-center gap-2 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold">🎡 RULETA</p>
          {/* Pedido explícito: el público tiene que saber en qué modo
              están jugando. Sin condición (a diferencia de Eliminación):
              en Ruleta esto siempre está "trabado" por naturaleza del
              juego, tanto en modo Chat como en modo Gift — nunca se puede
              entrar tarde, no depende de ningún toggle configurable. */}
          <span className="bg-slate-800 border border-slate-500/60 text-slate-300 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0">🔒 Locked</span>
        </div>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
          <div className="flex items-center gap-2">
            {state.entryMode === 'gift' && state.targetGiftIcon && <img src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-lg font-black text-white">{entryRuleLabel}</span>
          </div>
        </div>

        <PrizeStrip prize={prize} />
      </div>

      <div ref={wheelBoxRef} className="w-full flex-1 flex items-center justify-center my-2 overflow-hidden relative">
        {state.mode === 'finished' ? (
          state.winner && (
            <div className="flex flex-col items-center animate-pop">
              <div className="relative">
                <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-yellow-500" />
                <img src={state.winner.avatar} className="w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
            </div>
          )
        ) : state.mode === 'result' ? (
          <EliminationResultVisual list={state.lastEliminatedList} />
        ) : state.mode === 'spinning' ? (
          entries.length > 0 ? (
            <div className="w-full flex flex-wrap gap-2 justify-center items-center content-center max-h-full overflow-hidden">
              {entries.map((e, i) => {
                const isHighlighted = flickerIndexes.includes(i);
                return (
                  <div key={e.id} className={`flex flex-col items-center gap-0.5 transition-all duration-150 ${isHighlighted ? 'scale-125 z-10' : 'opacity-30 scale-90'}`}>
                    <img src={e.avatar} className={`w-12 h-12 rounded-full border-2 object-cover flex-shrink-0 ${isHighlighted ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]' : ''}`} style={{ borderColor: isHighlighted ? undefined : 'var(--accent)' }} />
                    <span className={`text-[8px] max-w-[48px] truncate ${isHighlighted ? 'text-yellow-300 font-bold' : 'text-gray-300'}`}>@{e.username}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-600 text-sm italic text-center">Esperando participantes...</p>
          )
        ) : entries.length > 0 ? (
          <>
            <div style={{ width: wheelSize, height: wheelSize }}>
              <RouletteWheel entries={entries} highlightUsername={null} highlightColor="#ef4444" size={wheelSize} customize={customize} />
            </div>
            {/* Puntero fijo, decorativo mientras se junta gente. */}
            <div className="absolute left-1/2 -translate-x-1/2 top-0 text-3xl drop-shadow-lg" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.4))' }}>🔻</div>
          </>
        ) : (
          <p className="text-gray-600 text-sm italic text-center">Esperando participantes...</p>
        )}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="flex flex-col items-center gap-2 py-2">
            {state.winner ? (
              <>
                <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse">¡GANADOR!</div>
                <p className={`text-lg font-black text-yellow-400 ${getUsernameOverride(customize).className}`} style={getUsernameOverride(customize).cssVars}>@{state.winner.username}</p>
              </>
            ) : (
              <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
            )}
          </div>
        ) : state.mode === 'spinning' ? (
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎡 GIRANDO...</p>
            <PhaseProgressBar active={state.mode === 'spinning'} durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
          </div>
        ) : state.mode === 'result' ? (
          <div className="border border-red-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-lg font-black text-red-300 uppercase tracking-widest">💀 Eliminadas</p>
            <PhaseProgressBar active={state.mode === 'result'} durationMs={state.revealResultMs} colorClass="bg-red-400" />
          </div>
        ) : (
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">TIEMPO PARA ENTRAR</p>
            <p className="text-[52px] leading-none font-black tabular-nums tracking-tighter text-white">{formatMMSS(state.timeLeft)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Widget angosto compartido por Top Tap-Tap y Top Gifter: a diferencia de
// King/Zub/Elim/Ruleta no es una partida (sin timer, sin "finished", sin
// ganador) — solo un ranking corrido que crece mientras dure el directo,
// pensado como fuente de navegador chica aparte (ver ?screen=taptap /
// ?screen=gifter), no como parte del selector activeApp.
// `valueColorClass`/`nameIcon` dejan que cada ranking tenga su propio look
// (rojo+corazón para likes, amarillo+moneda para regalos) sin duplicar todo
// el layout — pedido explícito para que cada widget se vea más llamativo y
// distinguible del otro a simple vista.
// `h-[700px]` (fijo, no automático): estandarizado junto con el resto de
// los overlays verticales (pedido explícito: "380x700 exactos" para todos)
// — antes usaba `h-full` para ocupar lo que fuera que midiera la fuente de
// OBS; ahora con un alto fijo conocido de antemano, el streamer configura
// la fuente a esa misma medida y el recuadro nunca crece/encoge según
// cuántas entradas tenga ahora mismo, que es lo que evita que se reubique
// en la pantalla al sumar o perder una fila (pedido explícito: "posición
// estática"). La lista interna es la única parte que crece/scrollea
// (flex-1 + overflow-y-auto); como el backend ya limita a un top 8 (ver
// CONTINUOUS_LEADERBOARD_SIZE en tenant.js), en la práctica nunca hace
// falta scrollear de verdad.
// Sin `theme-die-frame` a propósito (pedido explícito) — a diferencia de
// Extensible/Colores, este widget NO lleva panel/fondo propio: la
// personalización de fondo (ver overlayCustomization.js) se aplica
// directamente a CADA fila individual, que es la única superficie visible
// acá — así se puede pegar sobre cualquier fondo de la escena sin que el
// color del tema choque con nada.
//
// BUG corregido (pedido explícito): antes la fila 0 (top 1) no tenía NINGÚN
// estilo de fondo propio (quedaba transparente por accidente, sin depender
// de ninguna configuración) mientras las filas 1 a 7 tenían codeado a mano
// `var(--surface-bg-alt)` sin importar nada más — dos comportamientos
// distintos y ninguno de los dos realmente "configurable". Ahora TODAS las
// filas (0 a 7) usan el mismo `resolveBackgroundStyle(customize, ...)`, así
// que elegir transparente/sólido/degradado en el modal de personalización
// se nota igual en el top 1 que en el resto — el borde dorado del top 1
// sigue siendo su propio detalle (rango), independiente del fondo.
function ContinuousLeaderboardWidget({ title, icon, entries, valueKey, valueSuffix, valueColorClass, nameIcon = '', emptyLabel, customize }) {
  const rowBg = resolveBackgroundStyle(customize, 'var(--surface-bg-alt)');
  const nameOverride = getUsernameOverride(customize);
  return (
    <div className="w-[380px] h-[700px] p-5 flex flex-col gap-3 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black text-center flex-shrink-0">{icon} {title}</p>
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={e.username} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === 0 ? 'border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border'}`} style={i === 0 ? rowBg : { borderColor: 'var(--surface-border-color)', ...rowBg }}>
              <span className="w-5 text-center text-xs font-black text-gray-400">{MEDALS[i] || i + 1}</span>
              <img src={e.avatar} className={`w-9 h-9 rounded-full border-2 object-cover flex-shrink-0 ${i === 0 ? 'border-yellow-400' : ''}`} style={i === 0 ? undefined : { borderColor: 'var(--accent)' }} />
              <span className={`flex-1 text-sm font-bold text-white truncate ${nameOverride.className}`} style={nameOverride.cssVars}>{nameIcon ? `${nameIcon} ` : ''}@{e.username}</span>
              <span className={`${valueColorClass} text-sm font-black px-2 py-1 rounded-lg flex-shrink-0`}>{e[valueKey]}{valueSuffix}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-600 text-xs italic text-center py-4">{emptyLabel}</p>
      )}
    </div>
  );
}

export function TopTapTapOverlay({ state, customize }) {
  return (
    <ContinuousLeaderboardWidget
      title="Top Taps" icon="❤️" entries={(state && state.leaderboard) || []}
      valueKey="likes" valueSuffix=" ❤️" valueColorClass="text-red-400 bg-red-400/10 border border-red-400/20"
      emptyLabel="Esperando likes..." customize={customize}
    />
  );
}

export function TopGifterOverlay({ state, customize }) {
  return (
    <ContinuousLeaderboardWidget
      title="Top Gifts" icon="💎" entries={(state && state.leaderboard) || []}
      valueKey="coins" valueSuffix=" 🪙" valueColorClass="text-yellow-400 bg-yellow-400/10 border border-yellow-400/20"
      nameIcon="🪙" emptyLabel="Esperando regalos..." customize={customize}
    />
  );
}

// MODO EXTENSIBLE: a diferencia de los widgets angostos de arriba, este
// overlay va horizontal a propósito (pedido explícito) — pensado como franja
// ancha tipo "barra de subathon" en la parte de abajo/arriba del stream, no
// como recuadro vertical. Mismo marco (`theme-die-frame`) y tamaño que ya
// usa Color Says (960x260) para que el streamer recorte igual en OBS.
export function ExtensibleOverlay({ state, customize }) {
  const s = state || {};
  const seconds = Math.max(0, Math.round(s.timeLeft || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const finished = !!s.finished;
  const paused = !finished && !!s.paused;
  // Modo Inverso (pedido explícito): el signo que se muestra tiene que
  // reflejar lo que de verdad hace cada follow/regalo ahora mismo — resta
  // en vez de sumar — para que el público entienda la dinámica al toque.
  const reverse = !!s.reverseMode;
  const sign = reverse ? '-' : '+';
  const titleOverride = getUsernameOverride(customize);
  return (
    <div className={`theme-die-frame w-[960px] h-[260px] px-12 flex items-center justify-between gap-10 font-sans overflow-hidden ${finished ? 'animate-pulse' : ''}`} style={resolveBackgroundStyle(customize)}>
      {/* flex-shrink-0 en los DOS lados a propósito: sin esto, el bloque de
          texto de la izquierda se comprimía apenas el contador arrancaba
          (el número de la derecha ocupa más ancho corriendo que en 00:00),
          y el texto se veía más chico de lo que en verdad estaba — pedido
          explícito de que el tamaño quede fijo en reposo y en marcha. */}
      <div className="flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <p className={`theme-accent-text text-sm uppercase tracking-[0.3em] font-black ${titleOverride.className}`} style={titleOverride.cssVars}>⏱️ Extensible</p>
          {reverse && (
            <span className="bg-red-950/60 border border-red-500/60 text-red-300 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0">🔻 Inverso</span>
          )}
        </div>
        {/* Pedido explícito: que el público vea claramente cuánto suma (o
            resta, en Modo Inverso) cada acción — texto grande, no una nota
            chica al pie. */}
        <p className={`text-3xl font-black leading-tight ${reverse ? 'text-red-300' : 'text-gray-300'}`}>
          👤 {sign}{s.secondsPerFollow ?? 0}s <span className="text-lg font-bold text-gray-500">por follow</span><br />
          🪙 {sign}{s.secondsPerGift ?? 0}s <span className="text-lg font-bold text-gray-500">por moneda del regalo</span>
        </p>
        {finished && <p className="text-yellow-300 text-xs font-black uppercase tracking-widest">Tiempo agotado</p>}
        {paused && <p className="text-gray-400 text-xs font-black uppercase tracking-widest">Pausado</p>}
      </div>
      <p className={`text-8xl font-black tabular-nums leading-none flex-shrink-0 ${finished ? 'text-yellow-300' : paused ? 'text-gray-500' : reverse ? 'text-red-400' : 'text-white'}`}>
        {mins}:{String(secs).padStart(2, '0')}
      </p>
    </div>
  );
}

// SPOTIFY: cola de canciones pedidas por chat (!play) — mismo criterio que
// Top Tap-Tap/Top Gifter (sin panel/fondo propio, alto fijo de 700px
// anclado arriba en vez de centrado, para no reubicarse en la pantalla al
// sumar una canción). El backend ya limita a las últimas 8 (ver
// SPOTIFY_QUEUE_DISPLAY_SIZE).
// `playing` (marcado por el polling de tenant.js contra la cola REAL de
// Spotify, ver pollSpotifyQueue) resalta cuál está sonando ahora mismo —
// las demás son lo que sigue. La lista se actualiza sola cuando el backend
// detecta que Spotify avanzó (canción terminada o saltada con !skip): esa
// entrada desaparece de acá sin que el overlay tenga que hacer nada además
// de escuchar el socket, ya viene filtrada desde tenant.js.
export function SpotifyQueueOverlay({ state, customize }) {
  const queue = (state && state.queue) || [];
  // Mismo fix que Top Tap-Tap/Top Gifter: la fila (única superficie visible
  // acá, sin marco propio) usa la personalización de fondo elegida en vez
  // de un `var(--surface-bg-alt)` fijo — la canción "Sonando" solo se
  // distingue por el borde/glow verde, no por un fondo distinto.
  const rowBg = resolveBackgroundStyle(customize, 'var(--surface-bg-alt)');
  const nameOverride = getUsernameOverride(customize);
  return (
    <div className="w-[380px] h-[700px] p-5 flex flex-col gap-3 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black text-center flex-shrink-0">🎵 Playlist</p>
      {queue.length > 0 ? (
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
          {queue.map((song) => (
            <div
              key={song.id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 border ${song.playing ? 'shadow-[0_0_15px_rgba(34,197,94,0.35)]' : ''}`}
              style={song.playing ? { borderColor: '#22c55e', ...rowBg } : { borderColor: 'var(--surface-border-color)', ...rowBg }}
            >
              {song.albumArt
                ? <img src={song.albumArt} className="w-9 h-9 rounded object-cover flex-shrink-0" />
                : <span className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0 text-sm" style={{ background: 'var(--surface-bg-alt)' }}>🎵</span>}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{song.title}</p>
                <p className="text-[10px] text-gray-400 truncate">{song.artist} · pedido por <span className={nameOverride.className} style={nameOverride.cssVars}>@{song.requestedBy}</span></p>
              </div>
              {song.playing && (
                <span className="text-[9px] font-black uppercase tracking-widest text-green-400 flex items-center gap-1 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Sonando
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-600 text-xs italic text-center py-4">Pide una canción con !play...</p>
      )}
    </div>
  );
}

// Dónde se planta la alerta dentro de la pantalla completa del overlay —
// mapea la `position` guardada en cada alerta (ver AlertsAdmin.jsx) a las
// clases de alineación de un contenedor `fixed inset-0`.
const ALERT_POSITION_CLASSES = {
  center: 'items-center justify-center',
  top: 'items-start justify-center pt-10',
  bottom: 'items-end justify-center pb-10',
  left: 'items-center justify-start pl-10',
  right: 'items-center justify-end pr-10',
};

// Tope duro de duración en pantalla, sin importar lo guardado — mismo
// límite que ya aplica el slider y el backend (ver AlertsAdmin.jsx /
// server.js), repetido acá como última red de seguridad para alertas
// guardadas antes de que existiera el límite.
const ALERT_MAX_DURATION_MS = 15000;

// Duración FIJA de las animaciones de entrada/salida — tiene que coincidir
// con la de las clases `.tkc-alert-anim-*` en index.css: quien coordina las
// fases (entering/visible/exiting) es JS (acá y en AlertsAdmin.jsx), así
// que si un lado cambia sin el otro, la animación se corta a mitad de
// camino o el contenido queda "pegado" un instante antes de ocultarse.
export const ANIM_DURATION_MS = 400;

// Contenido visual de una alerta — separado de AlertOverlay para poder
// reusarlo TAL CUAL en la Vista previa del panel de administración (ver
// AlertsAdmin.jsx) sin depender de un socket real ni de esperar a que un
// espectador mande el regalo. `alert.count` (> 1 cuando el backend agrupó
// varios envíos del mismo regalo en un combo, ver settleAlertCombo en
// tenant.js) se muestra como "×N" para dejar claro que fue un combo y no
// una alerta más apilada.
// OJO posición: NO se puede usar `fixed inset-0` directo acá — `.themed-app
// > * { position: relative }` (ver index.css) pisa el `position: fixed` de
// cualquier hijo directo con la MISMA especificidad y sin !important de
// ningún lado, así que ganaba por orden de declaración: la alerta quedaba
// con `position: relative` de verdad (no fixed), por eso "Centro" se veía
// arriba — sin un contenedor de tamaño de pantalla completa, "centrado"
// solo centraba dentro de una caja del alto de la imagen, insertada al
// principio del flujo normal. `.tkc-alert-viewport` (index.css) fuerza
// `position: fixed` con !important para ganar esa pelea.
// `phase`: 'entering' | 'visible' | 'exiting' — decide qué animación de
// index.css (`.tkc-alert-anim-in-*`/`.tkc-alert-anim-out-*`) aplicar según
// `alert.entranceAnim`/`alert.exitAnim` ('none' = sin animación, aparece/
// desaparece de golpe). Quien coordina CUÁNDO cambia de fase es el caller
// (AlertOverlay para la alerta real; AlertsAdmin.jsx para la vista
// previa en vivo del panel) — este componente es puramente presentacional.
// `embedded`: la vista previa del panel la usa dentro de una cajita chica
// en vez de la pantalla completa real — ver `.tkc-alert-embedded` en
// index.css.
export function AlertVisual({ alert, phase = 'visible', embedded = false }) {
  if (!alert) return null;
  const positionClass = ALERT_POSITION_CLASSES[alert.position] || ALERT_POSITION_CLASSES.center;
  const preset = phase === 'exiting' ? (alert.exitAnim || 'none') : (alert.entranceAnim || 'none');
  const animClass = phase !== 'visible' && preset !== 'none' ? `tkc-alert-anim-${phase === 'exiting' ? 'out' : 'in'}-${preset}` : '';
  return (
    <div className={`tkc-alert-viewport ${embedded ? 'tkc-alert-embedded' : ''} flex pointer-events-none ${positionClass}`}>
      <div className={`relative ${animClass}`}>
        {(alert.mediaType === 'image' || alert.mediaType === 'gif') && (
          <img src={alert.mediaUrl} className="max-w-[600px] max-h-[600px] object-contain" />
        )}
        {alert.mediaType === 'video' && (
          <video src={alert.mediaUrl} className="max-w-[720px] max-h-[720px] object-contain" autoPlay muted={false} />
        )}
        {alert.mediaType === 'audio' && (
          <audio src={alert.mediaUrl} autoPlay />
        )}
        {alert.count > 1 && (
          <span className="absolute -top-3 -right-3 bg-yellow-400 text-black text-lg font-black px-3 py-1 rounded-full shadow-lg">
            ×{alert.count}
          </span>
        )}
      </div>
    </div>
  );
}

// ALERTAS DE REGALOS: reproduce el recurso (imagen/gif/video/audio)
// asignado al regalo que acaba de llegar (ver processGiftAlert/
// settleAlertCombo en tenant.js). Cola propia — si llegan varios regalos
// con alerta casi juntos, se muestran una atrás de la otra en vez de
// superponerse; cada una dura exactamente `durationMs` (tope duro
// ALERT_MAX_DURATION_MS) sin importar el tipo de recurso (el audio/video
// sigue sonando de fondo si es más largo que eso, pero la alerta visual/
// el turno de la cola avanza igual).
export function AlertOverlay({ socket }) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('visible');
  // Ref (no state): si hay una alerta en pantalla ahora mismo. Separar esto
  // del efecto que la oculta es lo que arregla el bug real que tenía esto
  // antes: un solo useEffect con `[queue, current]` de dependencias se
  // reiniciaba a sí mismo apenas llamaba `setCurrent(next)` en su propio
  // cuerpo (current pasó de null a `next`), y el cleanup de ESE reinicio
  // cancelaba el setTimeout recién creado antes de que llegara a disparar
  // — la alerta quedaba pegada en pantalla para siempre y la cola nunca
  // avanzaba a la siguiente.
  const showingRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const onTrigger = (alert) => setQueue((q) => [...q, alert]);
    socket.on('alert_triggered', onTrigger);
    return () => socket.off('alert_triggered', onTrigger);
  }, [socket]);

  // Avanza la cola — depende SOLO de `queue`, así que setear `current`
  // acá adentro no vuelve a disparar este mismo efecto.
  useEffect(() => {
    if (showingRef.current || queue.length === 0) return;
    const [next, ...rest] = queue;
    showingRef.current = true;
    setCurrent(next);
    setQueue(rest);
  }, [queue]);

  // Oculta la alerta actual — depende SOLO de `current`, así que su
  // cleanup nunca se dispara por avanzar la cola, solo cuando `current`
  // cambia de verdad (o el componente se desmonta). Además coordina las 3
  // fases de la animación (entering -> visible -> exiting) DENTRO de la
  // misma ventana `duration` configurada — la entrada ocupa los primeros
  // ANIM_DURATION_MS y la salida los últimos, así la alerta nunca queda
  // más tiempo en pantalla del que el streamer configuró.
  useEffect(() => {
    if (!current) return;
    const duration = Math.min(ALERT_MAX_DURATION_MS, Math.max(500, current.durationMs || 5000));
    setPhase('entering');
    const timers = [
      setTimeout(() => setPhase('visible'), ANIM_DURATION_MS),
      setTimeout(() => setPhase('exiting'), Math.max(ANIM_DURATION_MS, duration - ANIM_DURATION_MS)),
      setTimeout(() => {
        setCurrent(null);
        showingRef.current = false;
      }, duration),
    ];
    return () => timers.forEach(clearTimeout);
  }, [current]);

  return <AlertVisual alert={current} phase={phase} />;
}

// El overlay refleja el skin (material + acento) elegido en el panel — le
// llega por socket en `theme` (ver App.jsx/tenant.js), nunca de su propio
// localStorage: esta ventana corre aparte, en OBS, y la idea es justamente
// que la audiencia vea el mismo skin que el streamer eligió para representarse.
//
// `embedded`: además del uso normal como página completa de OBS
// (min-h-screen), este mismo componente se reusa como vista previa dentro
// del panel en mobile — ver App.jsx, donde no hay forma de tener OBS y el
// panel abiertos a la vez en un solo teléfono — y en el modal de
// personalización (ver OverlayPreviewBox.jsx). En esos casos no debe
// reservar el viewport entero, solo el tamaño real de la tarjeta (380x700).
// OJO: sacar la clase `min-h-screen` NO alcanza — `.themed-app` (index.css)
// tiene su PROPIO `min-height: 100vh` incondicional, así que sin este
// `style` inline el "grid place-items-center" seguía centrando la tarjeta
// dentro de un alto de pantalla completa en vez del alto real del
// contenedor — en el modal (mucho más chico que 100vh) esto empujaba la
// tarjeta varios píxeles hacia abajo del punto de anclaje esperado.
export default function Overlay({ state, zubState, elimState, rouletteState, activeApp, prize = null, theme = { style: 'default', accent: 'purple' }, embedded = false, customization }) {
  // Rey del Trono/Zubastinis/Eliminación/Ruleta comparten UNA sola URL/
  // fuente de OBS (?screen=games) — así que también comparten una sola
  // personalización de fondo/nombre de usuario, la de id "games" (ver
  // OVERLAY_CUSTOMIZE_LABELS en overlayCustomization.js).
  const gamesCustomize = customization?.games;
  return (
    <div className={`themed-app grid place-items-center ${embedded ? '' : 'min-h-screen'}`} style={{ ...(embedded ? { minHeight: 0 } : null), ...accentStyleVars(theme) }} data-theme-style={theme.style} data-accent={theme.accent}>
      <div className="relative grid">
        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'king' ? 1 : 0, visibility: activeApp === 'king' ? 'visible' : 'hidden', transform: activeApp === 'king' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <KingOverlay state={state} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'zub' ? 1 : 0, visibility: activeApp === 'zub' ? 'visible' : 'hidden', transform: activeApp === 'zub' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <ZubastinisOverlay state={zubState} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'elim' ? 1 : 0, visibility: activeApp === 'elim' ? 'visible' : 'hidden', transform: activeApp === 'elim' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <EliminationOverlay state={elimState} prize={prize} customize={gamesCustomize} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'roulette' ? 1 : 0, visibility: activeApp === 'roulette' ? 'visible' : 'hidden', transform: activeApp === 'roulette' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <RouletteOverlay state={rouletteState} prize={prize} customize={gamesCustomize} />
        </div>
      </div>
    </div>
  );
}
