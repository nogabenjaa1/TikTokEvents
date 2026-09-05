import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { playThroneSteal, playSelecting, playEliminate, playWinner } from './sounds';

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

// Arma la secuencia de "paradas" (tipo ruleta / yo-no-fui) para la animación
// de sorteo: arranca rápido y se va frenando, y el ÚLTIMO paso siempre cae
// exactamente en targetIdx, sin importar cuántas vueltas dio antes.
function buildRevealPath(listLength, targetIdx, totalMs) {
  const delays = [];
  let d = 70;
  let total = 0;
  while (total + d < totalMs - 350) {
    delays.push(d);
    total += d;
    d = Math.min(d * 1.18, 380);
  }
  delays.push(Math.max(totalMs - total, 300)); // paso final: el "aterrizaje"

  // Cada parada salta a una posición al azar (no un recorrido secuencial
  // tipo ruleta) para que se vea genuinamente aleatorio mientras "tira los
  // dados" — evita repetir la misma posición dos veces seguidas para que
  // no parezca trabada. El aterrizaje final siempre es targetIdx, que ya
  // se decidió al azar en el backend (ver beginEliminationReveal).
  const path = [];
  for (let i = 0; i < delays.length - 1; i++) {
    let idx = Math.floor(Math.random() * listLength);
    if (listLength > 1) {
      const prev = path[path.length - 1];
      while (idx === prev) idx = Math.floor(Math.random() * listLength);
    }
    path.push(idx);
  }
  path.push(targetIdx);
  return { path, delays };
}

// Aviso fijo del tiempo de snipe (King/Zub) o de re-join (Eliminación),
// arriba de todo y bien visible: la gente lo ve ANTES de mandar el regalo,
// no recién cuando ese modo se activa.
function TimeWarningBadge({ label, seconds }) {
  if (typeof seconds !== 'number') return null;
  return (
    <div className="w-full flex justify-center">
      <span className="bg-red-950/70 border-2 border-red-500/70 text-red-200 font-black uppercase tracking-[0.2em] text-sm px-5 py-1.5 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.35)]">
        ⚠️ {label}: {seconds}s
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
    <div className="theme-die-frame w-[400px] min-h-[680px] p-8 flex flex-col items-center justify-center relative overflow-hidden font-sans">
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

function KingOverlay({ state, prize }) {
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
    <div className="theme-die-frame w-[400px] min-h-[680px] p-8 flex flex-col items-center relative overflow-hidden font-sans">
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mb-3">ROBA EL LUGAR CON:</p>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
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
            <p className={`text-2xl font-black mt-6 tracking-wide drop-shadow-md ${state.mode === 'finished' ? 'text-yellow-200' : ''}`} style={state.mode === 'finished' ? undefined : { color: 'var(--accent-soft)' }}>@{state.lastParticipant.username}</p>
          </div>
        ) : <div className="w-32 h-32 rounded-full border-2 border-dashed flex items-center justify-center" style={{ borderColor: 'var(--surface-border-color)', background: 'color-mix(in oklch, var(--surface-bg-alt) 50%, transparent)' }}><span className="text-4xl opacity-30">👤</span></div>}
      </div>

      <div className="w-full text-center mt-auto">
        {state.mode === 'finished' ? (
          <div className="text-[40px] leading-none font-black tracking-widest text-yellow-400 animate-pulse py-4">WINNER!</div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">{state.paused ? 'PAUSADO' : state.mode === 'waiting' ? 'ESPERANDO...' : 'TIEMPO RESTANTE'}</p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'waiting' ? 'text-gray-500' : 'text-white'}`}>{state.timeLeft}</p>          </div>
        )}
      </div>
    </div>
  );
}

function ZubastinisOverlay({ state, prize }) {
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
    <div className="theme-die-frame w-[400px] min-h-[680px] p-8 flex flex-col items-center relative overflow-hidden font-sans">
      {state.mode === 'snipe' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-red-600 to-red-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">⚠️ SNIPE ⚠️</div>}
      {state.mode === 'tiebreak' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-amber-500 to-amber-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🤝 DESEMPATE 🤝</div>}
      {state.paused && state.mode !== 'finished' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-gray-600 to-gray-800 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 shadow-lg">⏸ PAUSADO ⏸</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Snipe" seconds={state.snipeTime} />
      </div>

      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mt-3 mb-4">🏆 TOP REGALADORES</p>

      <div className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-2" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
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
          <div key={g.username} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${i === 0 ? 'border border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.35)]' : 'border'}`} style={i === 0 ? undefined : { borderColor: 'var(--surface-border-color)', background: 'var(--surface-bg-alt)' }}>
            <span className="text-2xl">{MEDALS[i]}</span>
            <img src={g.avatar} className={`w-12 h-12 rounded-full border-2 object-cover ${i === 0 ? 'border-yellow-400' : ''}`} style={i === 0 ? undefined : { borderColor: 'var(--accent)' }} />
            <span className="flex-1 font-black text-white truncate">@{g.username}</span>
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
                <p className="text-lg font-black text-yellow-200">@{state.winner.username} · {state.winner.coins} 🪙</p>
              </>
            ) : (
              <>
                <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
                <p className="text-sm font-bold text-gray-400">{noWinnerMessage}</p>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-[2rem] py-4 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-1">
              {state.paused ? 'PAUSADO' : state.mode === 'tiebreak' ? 'DESEMPATE' : 'TIEMPO RESTANTE'}
            </p>
            <p className={`text-[80px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'snipe' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : state.mode === 'tiebreak' ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'text-white'}`}>{state.timeLeft}</p>          </div>
        )}
      </div>
    </div>
  );
}

function EliminationOverlay({ state, prize }) {
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const revealKeyRef = useRef(null);
  const gridRef = useRef(null);
  const [boxSize, setBoxSize] = useState(64);
  const [gridGap, setGridGap] = useState(6);

  // Sonidos: arranca el sorteo ('revealing'), se resuelve una eliminación
  // ('revealing' -> 'rejoin'), y el mismo sonido de ganador que King/Zub.
  const prevElimRef = useRef({ mounted: false, mode: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevElimRef.current;
    if (prev.mounted) {
      if (state.mode === 'revealing' && prev.mode !== 'revealing') playSelecting();
      if (state.mode === 'rejoin' && prev.mode === 'revealing') playEliminate();
      if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) playWinner();
    }
    prevElimRef.current = { mounted: true, mode: state.mode };
  }, [state?.mode, state?.winner]);

  // Corre la animación de sorteo una sola vez por cada reveal (identificado
  // por revealTargetId), y la resetea cuando termina o cambia de ronda.
  useEffect(() => {
    if (!state || state.mode !== 'revealing') {
      revealKeyRef.current = null;
      setHighlightIdx(-1);
      return;
    }

    const list = state.participants || [];
    if (list.length === 0 || revealKeyRef.current === state.revealTargetId) return;
    revealKeyRef.current = state.revealTargetId;

    let targetIdx = list.findIndex(p => p.id === state.revealTargetId);
    if (targetIdx === -1) targetIdx = 0;

    const { path, delays } = buildRevealPath(list.length, targetIdx, state.revealDurationMs || 4000);
    let elapsed = 0;
    const timers = path.map((idx, i) => {
      elapsed += delays[i];
      return setTimeout(() => setHighlightIdx(idx), elapsed);
    });

    return () => timers.forEach(clearTimeout);
  }, [state && state.mode, state && state.revealTargetId]);

  const participants = (state && state.participants) || [];

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
  }, [participants.length, state && state.instaWinGiftName, prize, state && state.lastEliminated, state && state.mode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard />;

  const timerTitle = state.mode === 'rejoin' ? 'REINGRESO' : 'TIEMPO PARA UNIRSE';
  const showLabel = boxSize >= 18;

  return (
    // Altura FIJA (no min-h): con muchos participantes las burbujas se
    // achican vía elimSizeFor en vez de estirar la tarjeta — si el overlay
    // cambia de tamaño se rompe el recorte/captura ya encuadrado en OBS.
    <div className="theme-die-frame w-[400px] h-[680px] p-8 flex flex-col items-center relative overflow-hidden font-sans">
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
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mb-3">💀 ELIMINACIÓN — ÚNETE CON:</p>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
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

      {state.lastEliminated && state.mode !== 'finished' && (
        <div className="mt-4 flex items-center gap-2 bg-red-950/40 border border-red-800/50 rounded-xl px-3 py-2 w-full">
          <img src={state.lastEliminated.avatar} className="w-8 h-8 rounded-full border-2 border-red-500 object-cover grayscale" />
          <span className="text-xs font-bold text-red-300">
            💀 @{state.lastEliminated.username} {state.lastEliminated.final === false ? 'perdió un slot' : 'fue eliminado'}
          </span>
        </div>
      )}

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
        ) : participants.length > 0 ? (
          participants.map((p, i) => {
            const isHighlighted = state.mode === 'revealing' && i === highlightIdx;
            return (
              <div key={p.id} title={p.username} style={{ width: boxSize }}
                className={`flex flex-col items-center gap-0.5 transition-all duration-150 ${state.mode === 'revealing' ? (isHighlighted ? 'scale-125 z-10' : 'opacity-30 scale-90') : ''}`}>
                <img src={p.avatar} style={{ width: boxSize, height: boxSize, borderColor: isHighlighted ? undefined : 'var(--accent)' }}
                  className={`rounded-full border-2 object-cover flex-shrink-0 ${isHighlighted ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]' : ''}`} />
                {showLabel && (
                  <span style={{ fontSize: Math.max(4, Math.round(boxSize * 0.22)) }} className={`max-w-full truncate ${isHighlighted ? 'text-yellow-300 font-bold' : 'text-gray-300'}`}>@{p.username}</span>
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
                <p className="text-lg font-black text-yellow-200">@{state.winner.username}</p>
              </>
            ) : (
              <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
            )}
          </div>
        ) : state.mode === 'revealing' ? (
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎲 SORTEANDO...</p>
          </div>
        ) : (
          // Más chico que en King/Zub a propósito: le deja más espacio a la
          // grilla de participantes, que puede tener muchos más elementos.
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">{state.paused ? 'PAUSADO' : timerTitle}</p>
            <p className={`text-[52px] leading-none font-black tabular-nums transition-colors tracking-tighter ${state.paused ? 'text-gray-500' : state.mode === 'rejoin' ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>{state.timeLeft}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// El giro de la Ruleta lo pacea el BACKEND (ver stepRouletteReveal en
// tenant.js — cada eliminación llega ya con el delay de suspenso aplicado
// del lado del servidor), así que a diferencia de EliminationOverlay este
// componente no necesita simular ningún recorrido falso: solo refleja el
// estado tal cual llega, reaccionando a cada roulette_step con una
// transición corta.
function RouletteOverlay({ state, prize }) {
  const gridRef = useRef(null);
  const [boxSize, setBoxSize] = useState(64);
  const [gridGap, setGridGap] = useState(6);

  const prevRef = useRef({ mounted: false, mode: null });
  useEffect(() => {
    if (!state) return;
    const prev = prevRef.current;
    if (prev.mounted) {
      if (state.mode === 'spinning' && prev.mode !== 'spinning') playSelecting();
      if (state.mode === 'finished' && prev.mode !== 'finished' && state.winner) playWinner();
    }
    prevRef.current = { mounted: true, mode: state.mode };
  }, [state?.mode, state?.winner]);

  // Un "eliminate" por cada paso del giro — cada roulette_step trae un
  // objeto lastEliminated nuevo (broadcast fresco del backend), así que
  // comparar por referencia alcanza para saber que es un paso distinto.
  useEffect(() => {
    if (state?.mode === 'spinning' && state?.lastEliminated) playEliminate();
  }, [state?.lastEliminated]);

  const entries = (state && state.entries) || [];

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = () => {
      const { size, gap } = computeElimBoxSize(el.clientWidth, el.clientHeight, entries.length);
      setBoxSize(size);
      setGridGap(gap);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries.length, prize, state && state.lastEliminated, state && state.mode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard />;

  const showLabel = boxSize >= 18;
  const entryRuleLabel = state.entryMode === 'gift'
    ? `Manda ${state.targetGiftName || '...'}`
    : `Comenta "${state.keyword || '...'}"`;

  return (
    <div className="theme-die-frame w-[400px] h-[680px] p-8 flex flex-col items-center relative overflow-hidden font-sans">
      {state.mode === 'spinning' && <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-center font-black text-white uppercase tracking-[0.3em] text-xs py-2 animate-pulse shadow-lg">🎡 GIRANDO 🎡</div>}

      <div className="mt-6 w-full">
        <TimeWarningBadge label="Cierra en" seconds={state.mode === 'joining' ? state.timeLeft : undefined} />
      </div>

      <div className="mt-3 flex flex-col items-center text-center w-full">
        <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-bold mb-3">🎡 RULETA</p>
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
          <div className="flex items-center gap-2">
            {state.entryMode === 'gift' && state.targetGiftIcon && <img src={state.targetGiftIcon} className="w-10 h-10 drop-shadow-xl" />}
            <span className="text-lg font-black text-white">{entryRuleLabel}</span>
          </div>
        </div>

        <PrizeStrip prize={prize} />
      </div>

      {state.lastEliminated && state.mode === 'spinning' && (
        <div className="mt-4 flex items-center gap-2 bg-red-950/40 border border-red-800/50 rounded-xl px-3 py-2 w-full">
          <img src={state.lastEliminated.avatar} className="w-8 h-8 rounded-full border-2 border-red-500 object-cover grayscale" />
          <span className="text-xs font-bold text-red-300">💀 @{state.lastEliminated.username} quedó fuera</span>
        </div>
      )}

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
        ) : entries.length > 0 ? (
          entries.map((e) => (
            <div key={e.id} title={e.username} style={{ width: boxSize }} className="flex flex-col items-center gap-0.5 transition-all duration-150">
              <img src={e.avatar} style={{ width: boxSize, height: boxSize, borderColor: 'var(--accent)' }} className="rounded-full border-2 object-cover flex-shrink-0" />
              {showLabel && <span style={{ fontSize: Math.max(4, Math.round(boxSize * 0.22)) }} className="max-w-full truncate text-gray-300">@{e.username}</span>}
            </div>
          ))
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
                <p className="text-lg font-black text-yellow-200">@{state.winner.username}</p>
              </>
            ) : (
              <div className="text-[32px] leading-none font-black tracking-widest text-red-500">SIN GANADOR</div>
            )}
          </div>
        ) : state.mode === 'spinning' ? (
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)' }}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎡 GIRANDO...</p>
          </div>
        ) : (
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ background: 'var(--surface-bg-alt)', border: '1px solid var(--surface-border-color)' }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">TIEMPO PARA ENTRAR</p>
            <p className="text-[52px] leading-none font-black tabular-nums tracking-tighter text-white">{state.timeLeft}</p>
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
function ContinuousLeaderboardWidget({ title, icon, entries, valueKey, valueSuffix, emptyLabel }) {
  return (
    <div className="theme-die-frame w-[380px] p-5 flex flex-col gap-3 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black text-center">{icon} {title}</p>
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => (
            <div key={e.username} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === 0 ? 'border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border'}`} style={i === 0 ? undefined : { borderColor: 'var(--surface-border-color)', background: 'var(--surface-bg-alt)' }}>
              <span className="w-5 text-center text-xs font-black text-gray-400">{MEDALS[i] || i + 1}</span>
              <img src={e.avatar} className={`w-9 h-9 rounded-full border-2 object-cover flex-shrink-0 ${i === 0 ? 'border-yellow-400' : ''}`} style={i === 0 ? undefined : { borderColor: 'var(--accent)' }} />
              <span className="flex-1 text-sm font-bold text-white truncate">@{e.username}</span>
              <span className="text-yellow-400 text-sm font-black bg-yellow-400/10 border border-yellow-400/20 px-2 py-1 rounded-lg flex-shrink-0">{e[valueKey]}{valueSuffix}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-600 text-xs italic text-center py-4">{emptyLabel}</p>
      )}
    </div>
  );
}

export function TopTapTapOverlay({ state }) {
  return (
    <ContinuousLeaderboardWidget
      title="Top Tap-Tap" icon="❤️" entries={(state && state.leaderboard) || []}
      valueKey="likes" valueSuffix="" emptyLabel="Esperando likes..."
    />
  );
}

export function TopGifterOverlay({ state }) {
  return (
    <ContinuousLeaderboardWidget
      title="Top Gifter" icon="💎" entries={(state && state.leaderboard) || []}
      valueKey="coins" valueSuffix=" 🪙" emptyLabel="Esperando regalos..."
    />
  );
}

// El overlay refleja el skin (material + acento) elegido en el panel — le
// llega por socket en `theme` (ver App.jsx/tenant.js), nunca de su propio
// localStorage: esta ventana corre aparte, en OBS, y la idea es justamente
// que la audiencia vea el mismo skin que el streamer eligió para representarse.
//
// `embedded`: además del uso normal como página completa de OBS
// (min-h-screen), este mismo componente se reusa como vista previa dentro
// del panel en mobile — ver App.jsx, donde no hay forma de tener OBS y el
// panel abiertos a la vez en un solo teléfono. En ese caso no debe reservar
// el viewport entero, solo el tamaño real de la tarjeta (400x680).
export default function Overlay({ state, zubState, elimState, rouletteState, activeApp, prizes = {}, theme = { style: 'default', accent: 'purple' }, embedded = false }) {
  return (
    <div className={`themed-app grid place-items-center ${embedded ? '' : 'min-h-screen'}`} data-theme-style={theme.style} data-accent={theme.accent}>
      <div className="relative grid">
        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'king' ? 1 : 0, visibility: activeApp === 'king' ? 'visible' : 'hidden', transform: activeApp === 'king' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <KingOverlay state={state} prize={prizes.king} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'zub' ? 1 : 0, visibility: activeApp === 'zub' ? 'visible' : 'hidden', transform: activeApp === 'zub' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)' }}>
          <ZubastinisOverlay state={zubState} prize={prizes.zub} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'elim' ? 1 : 0, visibility: activeApp === 'elim' ? 'visible' : 'hidden', transform: activeApp === 'elim' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <EliminationOverlay state={elimState} prize={prizes.elim} />
        </div>

        <div className="col-start-1 row-start-1 transition-all duration-700 ease-in-out origin-center"
          style={{ opacity: activeApp === 'roulette' ? 1 : 0, visibility: activeApp === 'roulette' ? 'visible' : 'hidden', transform: activeApp === 'roulette' ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)' }}>
          <RouletteOverlay state={rouletteState} prize={prizes.roulette} />
        </div>
      </div>
    </div>
  );
}
