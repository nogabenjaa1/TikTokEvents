import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rouletteSnapshot, rouletteSounds } from '../eventSoundRules';
import { getUsernameFill, getUsernameOverride, resolveBackgroundStyle, rowBorder } from '../overlayCustomization';
import { formatMMSS } from '../timeFormat';
import { playOverlaySounds } from './helpers';
import { EliminationResultVisual, OfflineCard, PhaseProgressBar, PrizeStrip, TimeWarningBadge } from './shared';

// Convierte un ángulo (grados, 0 = arriba, sentido horario) + radio en un
// punto x/y sobre el círculo de centro (cx, cy) — la base trigonométrica
// para armar cada sección de la ruleta como un <path> de SVG.
function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const WHEEL_COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#14b8a6'];

// Vueltas completas de más que da la rueda antes de "aterrizar" en el
// índice objetivo — puro efecto visual, no cambia a quién apunta.
const ROULETTE_SPIN_EXTRA_TURNS = 2;

// Calcula la rotación ABSOLUTA (nunca hacia atrás, siempre sumando vueltas
// hacia adelante desde `prevRotation`) que deja al índice LOCAL
// `targetLocalIndex` (dentro de una rueda de `aliveCount` secciones) justo
// debajo del puntero fijo (arriba del todo, igual convención que
// RouletteWheel/polarPoint). Pedido explícito: que la ruleta gire de
// verdad antes de cada eliminado, no solo un destello — la rueda entera
// (el <div> que envuelve RouletteWheel) es la que rota vía CSS, nunca las
// secciones individuales.
function computeRouletteRotation(prevRotation, aliveCount, targetLocalIndex) {
  if (targetLocalIndex === null || targetLocalIndex === undefined || aliveCount <= 0) return prevRotation;
  const anglePer = 360 / aliveCount;
  const midAngle = targetLocalIndex * anglePer + anglePer / 2;
  const delta = (((-midAngle - prevRotation) % 360) + 360) % 360;
  return prevRotation + delta + ROULETTE_SPIN_EXTRA_TURNS * 360;
}

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

// El backend gobierna el ciclo entero de 3 fases por batch (N sub-giros,
// uno por cada eliminado, más un resultado agrupado — ver beginRouletteStep/
// beginRouletteSubSpin/resolveRouletteBatch en tenant.js), así que este
// componente solo tiene que animar la rotación en respuesta a
// `state.currentSpinIndex`: cada vez que cambia (nuevo sub-giro dentro del
// batch), se recalcula el ángulo objetivo sobre `state.aliveOrder` (el
// recorte de quién sigue vivo, fijo durante todo el batch) y se deja que la
// transición CSS haga el giro visual — nunca se resetea a mitad de un
// batch, así que varios eliminados seguidos se sienten como giros
// consecutivos de la MISMA rueda, no una que vuelve a 0 cada vez. Recién
// cuando terminan todos los sub-giros del batch se reemplaza por el
// resultado agrupado en burbujas (ver EliminationResultVisual), igual que
// en Eliminación.
export function RouletteOverlay({ state, prize, customize }) {
  const wheelBoxRef = useRef(null);
  const [wheelSize, setWheelSize] = useState(240);
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);

  // Sonidos: arranca el sorteo ('spinning'), se resuelve un paso
  // ('spinning' -> 'result', el momento real en que el backend ya sacó a
  // los eliminados), y el mismo sonido de ganador que los demás modos.
  const prevRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    const sounds = rouletteSounds(prevRef.current, state);
    prevRef.current = rouletteSnapshot(state);
    playOverlaySounds(sounds);
    // Solo cuando cambia el modo o el ganador: el resto del estado llega a cada rato y no debe repetir el sonido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mode, state?.winner]);

  const entries = (state && state.entries) || [];
  const aliveOrder = (state && state.aliveOrder) || [];

  // Ronda nueva -> la rueda vuelve a 0 (sin esto, el giro de una ronda
  // vieja se arrastraría como punto de partida de la próxima).
  useEffect(() => {
    if (state?.mode === 'joining') { setRotation(0); rotationRef.current = 0; }
  }, [state?.mode]);

  // Cada sub-giro nuevo del batch actual (currentSpinIndex cambia) calcula
  // el próximo ángulo ABSOLUTO (siempre hacia adelante desde donde quedó) y
  // deja que la transición CSS (duración = revealSelectMs, ver el estilo
  // más abajo) anime el giro — puramente declarativo, sin timers propios.
  useEffect(() => {
    if (state?.mode !== 'spinning' || state?.currentSpinIndex === null || state?.currentSpinIndex === undefined) return;
    const next = computeRouletteRotation(rotationRef.current, aliveOrder.length, state.currentSpinIndex);
    rotationRef.current = next;
    setRotation(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentSpinIndex, state?.mode]);

  const rouletteMode = state?.mode;
  useLayoutEffect(() => {
    const el = wheelBoxRef.current;
    if (!el) return;
    const recompute = () => setWheelSize(Math.max(120, Math.min(el.clientWidth, el.clientHeight)));
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [prize, rouletteMode]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard customize={customize} />;

  const entryRuleLabel = state.entryMode === 'gift'
    ? `Manda ${state.targetGiftName || '...'}`
    : `Comenta "${state.keyword || '...'}"`;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-8 flex flex-col items-center relative overflow-hidden font-sans" style={resolveBackgroundStyle(customize)}>
      {/* impeccable-disable-next-line ai-color-palette: el morado es el color de marca del sitio (acento #7C3AED); franja de estado del sorteo en curso */}
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
        <div className="flex items-center justify-between px-5 py-2 rounded-2xl w-full" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
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
                {/* impeccable-disable-next-line bounce-easing: el rebote de la corona del ganador es parte de la identidad del show (decisión del dueño) */}
                <div className="absolute -top-12 -right-8 text-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] z-30 animate-bounce">👑</div>
                <div className="absolute inset-0 rounded-full blur-xl opacity-60 bg-yellow-500" />
                <img src={state.winner.avatar} className="w-32 h-32 rounded-full border-4 relative z-10 object-cover shadow-2xl border-yellow-400" />
              </div>
            </div>
          )
        ) : state.mode === 'result' ? (
          <EliminationResultVisual list={state.lastEliminatedList} />
        ) : state.mode === 'spinning' ? (
          aliveOrder.length > 0 ? (
            <>
              <div style={{ width: wheelSize, height: wheelSize, transform: `rotate(${rotation}deg)`, transition: `transform ${state.revealSelectMs || 2000}ms cubic-bezier(0.15, 0.85, 0.35, 1)` }}>
                <RouletteWheel entries={aliveOrder} highlightUsername={null} size={wheelSize} customize={customize} />
              </div>
              {/* Puntero fijo: no gira, la rueda de abajo sí. */}
              <div className="absolute left-1/2 -translate-x-1/2 top-0 text-3xl drop-shadow-lg" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.4))' }}>🔻</div>
            </>
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
          <div className="border border-fuchsia-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={resolveBackgroundStyle(customize, 'var(--surface-bg-alt)')}>
            <p className="text-2xl font-black text-fuchsia-300 uppercase tracking-widest animate-pulse">🎡 GIRANDO...</p>
            <PhaseProgressBar active={state.mode === 'spinning'} durationMs={state.revealSelectMs} colorClass="bg-fuchsia-400" />
          </div>
        ) : state.mode === 'result' ? (
          <div className="border border-red-700/50 rounded-[2rem] py-6 px-4 shadow-inner" style={resolveBackgroundStyle(customize, 'var(--surface-bg-alt)')}>
            <p className="text-lg font-black text-red-300 uppercase tracking-widest">💀 Eliminadas</p>
            <PhaseProgressBar active={state.mode === 'result'} durationMs={state.revealResultMs} colorClass="bg-red-400" />
          </div>
        ) : (
          <div className="rounded-[2rem] py-2 px-4 shadow-inner" style={{ ...resolveBackgroundStyle(customize, 'var(--surface-bg-alt)'), border: rowBorder(customize) }}>
            <p className="text-[9px] uppercase tracking-[0.4em] text-gray-500 font-bold mb-0.5">TIEMPO PARA ENTRAR</p>
            <p className="text-[52px] leading-none font-black tabular-nums tracking-tighter text-white">{formatMMSS(state.timeLeft)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
