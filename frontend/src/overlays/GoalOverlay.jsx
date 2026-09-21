import { useEffect, useRef } from 'react';
import { goalSnapshot, goalSounds } from '../eventSoundRules';
import { bordersEnabled, getUsernameOverride, resolveBackgroundStyle } from '../overlayCustomization';
import { playOverlaySounds } from './helpers';

// OBJETIVO (meta de regalos en monedas o de seguidores nuevos, pedido
// explícito): mismo marco horizontal (960x260) que Extensible, pensado
// como franja tipo "barra de meta" — a diferencia de Extensible no hay
// paso del tiempo, solo un total que crece hasta `target` (ver
// processGiftGoal/processFollowGoal en tenant.js). Sin librería de
// animación: la barra de progreso es un simple `width: ${pct}%` con
// transición CSS, mismo criterio "sin JS de por medio" que el resto de
// los overlays de esta pantalla.
export function GoalOverlay({ state, customize }) {
  const s = state || {};
  const target = Math.max(1, s.target || 1);
  const current = Math.max(0, Math.min(target, s.current || 0));
  const pct = Math.round((current / target) * 100);
  const finished = !!s.finished;
  const isFollowers = s.targetType === 'followers';
  const defaultTitle = isFollowers ? '👥 Objetivo de seguidores' : '🎁 Objetivo de regalos';
  const unit = isFollowers ? '👤' : '🪙';
  const titleOverride = getUsernameOverride(customize);

  // Sonido al completar (pedido explícito, opcional -- ver Goal.jsx) --
  // se reproduce UNA sola vez, justo en la transición false -> true, nunca
  // en cada re-render mientras `finished` ya es true (ej. el overlay se
  // recarga a mitad de un objetivo ya completado no debe volver a sonar).
  const goalPrevRef = useRef(null);
  useEffect(() => {
    const sounds = goalSounds(goalPrevRef.current, { finished, audioUrl: s.audioUrl });
    goalPrevRef.current = goalSnapshot({ finished });
    playOverlaySounds(sounds, { audioUrl: s.audioUrl });
  }, [finished, s.audioUrl]);

  return (
    <div className={`theme-die-frame w-[960px] h-[260px] px-12 flex flex-col justify-center gap-6 font-sans overflow-hidden ${finished ? 'animate-pulse' : ''}`} style={resolveBackgroundStyle(customize)}>
      <div className="flex items-center justify-between gap-6">
        <p className={`text-2xl font-black leading-tight truncate ${titleOverride.className}`} style={titleOverride.cssVars}>
          {s.title || defaultTitle}
        </p>
        <p className="text-3xl font-black tabular-nums text-white flex-shrink-0">
          {unit} {current.toLocaleString('es-MX')} <span className="text-gray-400">/ {target.toLocaleString('es-MX')}</span>
        </p>
      </div>
      <div className="w-full h-10 rounded-full overflow-hidden border bg-black/25" style={{ borderColor: bordersEnabled(customize) ? 'var(--surface-border-color)' : 'transparent' }}>
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${finished ? 'bg-yellow-400' : 'theme-accent-bg'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {finished && <p className="text-yellow-300 text-sm font-black uppercase tracking-widest text-center">🎉 ¡Objetivo alcanzado!</p>}
    </div>
  );
}
