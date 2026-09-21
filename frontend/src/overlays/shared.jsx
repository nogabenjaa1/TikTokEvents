import { useEffect, useState } from 'react';
import { formatMMSS } from '../timeFormat';
import { RESULT_DISPLAY_CAP } from './helpers';

// Aviso fijo del tiempo de snipe (King/Zub) o de re-join (Eliminación),
// arriba de todo y bien visible: la gente lo ve ANTES de mandar el regalo,
// no recién cuando ese modo se activa.
export function TimeWarningBadge({ label, seconds }) {
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
export function PrizeStrip({ prize }) {
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

export function OfflineCard() {
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

// Barra que se vacía de 100% a 0% en `durationMs` — pedido explícito: que
// la duración configurada de cada fase (revealSelectMs/revealResultMs, ver
// tenant.js) se vea reflejada en el overlay, no solo en el timing interno.
// Vía transición CSS pura (sin setInterval): al activarse fuerza un primer
// frame al 100% y recién en el siguiente pide el 0%, así el navegador anima
// la transición completa en vez de arrancar ya vacía. Cambiar `durationMs`
// mientras está activa (ej. Fast Mode a mitad de ciclo) no debería pasar en
// la práctica, ya que cada fase nueva vuelve a montar esta barra desde cero.
export function PhaseProgressBar({ active, durationMs, colorClass }) {
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
      <div className={`h-full w-full ${colorClass}`} style={{ transform: `scaleX(${full ? 1 : 0})`, transformOrigin: 'left center', transition: `transform ${durationMs}ms linear` }} />
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
export function EliminationResultVisual({ list }) {
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
