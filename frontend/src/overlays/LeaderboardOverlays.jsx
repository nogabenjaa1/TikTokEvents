import { getUsernameOverride, resolveBackgroundStyle } from '../overlayCustomization';
import { formatHHMMSS } from '../timeFormat';
import { MEDALS } from './helpers';

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
      <p className={`text-7xl font-black tabular-nums leading-none flex-shrink-0 ${finished ? 'text-yellow-300' : paused ? 'text-gray-500' : reverse ? 'text-red-400' : 'text-white'}`}>
        {formatHHMMSS(seconds)}
      </p>
    </div>
  );
}
