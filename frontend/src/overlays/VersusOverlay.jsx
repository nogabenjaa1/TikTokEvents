import { getUsernameOverride, resolveBackgroundStyle, rowBorder, FONT_SCALES } from '../overlayCustomization';
import vsImage from '../assets/versus-vs.png';

// Una fila: la imagen del regalo del lado de AFUERA (héroes: a la izquierda;
// villanos: a la derecha, con `reverse`) y el texto del lado de ADENTRO,
// apuntando siempre hacia el VS del medio. `mode 'action'`: acción + cuántos
// van enviando (lista base, con marcador). `mode 'seconds'`: cuántos
// segundos suma o resta (vínculo con Extensible) -- pedido explícito, dos
// contenidos distintos en la misma fila según de cuál lista salga.
function VersusRow({ entry, mode, reverse, customize }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-xl ${reverse ? 'flex-row-reverse text-right' : ''}`} style={{ border: rowBorder(customize) }}>
      {entry.giftIcon ? (
        <img src={entry.giftIcon} className="w-12 h-12 object-contain flex-shrink-0" />
      ) : (
        <span className="w-12 h-12 flex items-center justify-center text-3xl flex-shrink-0" role="img" aria-label="Regalo">🎁</span>
      )}
      <div className="min-w-0 flex-1">
        {mode === 'action' ? (
          <>
            <p className="text-sm font-bold text-white truncate">{entry.actionText || entry.giftName}</p>
            <p className="text-xs text-yellow-300 font-black">{entry.count || 0}</p>
          </>
        ) : (
          <p className={`text-lg font-black ${entry.secondsDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {entry.secondsDelta > 0 ? '+' : ''}{entry.secondsDelta}s
          </p>
        )}
      </div>
    </div>
  );
}

function VersusColumn({ title, actionList, extList, showExt, reverse, textOverride, textScale, customize }) {
  const empty = actionList.length === 0 && (!showExt || extList.length === 0);
  return (
    <div className="flex flex-col gap-3 w-[380px] min-w-0">
      <p
        className={`text-center uppercase tracking-[0.3em] font-black ${textOverride.className}`}
        style={{ ...textOverride.cssVars, fontSize: `${Math.round(18 * textScale)}px` }}
      >
        {title}
      </p>
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 520 }}>
        {empty && <p className="text-gray-600 text-xs italic text-center py-4">Sin regalos configurados.</p>}
        {actionList.map((e) => <VersusRow key={e.id} entry={e} mode="action" reverse={reverse} customize={customize} />)}
        {showExt && extList.length > 0 && (
          <>
            <p className="text-center text-[10px] uppercase tracking-widest text-gray-500 font-bold mt-2">⏱️ Extensible</p>
            {extList.map((e) => <VersusRow key={e.id} entry={e} mode="seconds" reverse={reverse} customize={customize} />)}
          </>
        )}
      </div>
    </div>
  );
}

// Overlay del modo Versus: dos columnas (héroes a la izquierda, villanos a
// la derecha) con un "VS" al medio -- a diferencia de Alertas, SÍ tiene
// fondo propio (como Rey del Trono/Zubastinis/Extensible), así que se
// personaliza igual que esos, sin `hideBackground`. No depende de estar
// "iniciado" para mostrar algo (mismo criterio que ExtensibleOverlay): los
// regalos configurados y sus contadores se ven siempre, en 0 hasta que
// llegue el primero.
export function VersusOverlay({ state, customize }) {
  const s = state || {};
  const textOverride = getUsernameOverride(customize, { scale: false });
  const textScale = FONT_SCALES[customize?.usernameColor?.fontSize] ?? 1;
  const paused = s.isActive && s.paused;

  return (
    <div className="theme-die-frame w-[900px] h-[700px] p-8 flex flex-col items-center gap-4 font-sans overflow-hidden" style={resolveBackgroundStyle(customize)}>
      {paused && (
        <span className="bg-gray-950/60 border border-gray-500/60 text-gray-300 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full flex-shrink-0">
          ⏸ Pausado
        </span>
      )}
      <div className="flex-1 min-h-0 w-full flex items-start justify-center gap-6">
        <VersusColumn
          title={s.heroLabel || 'HÉROES'} actionList={s.heroes || []} extList={s.extHeroes || []}
          showExt={!!s.extensibleLinkEnabled} reverse={false} textOverride={textOverride} textScale={textScale} customize={customize}
        />
        <img src={vsImage} alt="VS" className="w-20 h-20 object-contain flex-shrink-0 self-center" />
        <VersusColumn
          title={s.villainLabel || 'VILLANOS'} actionList={s.villains || []} extList={s.extVillains || []}
          showExt={!!s.extensibleLinkEnabled} reverse textOverride={textOverride} textScale={textScale} customize={customize}
        />
      </div>
    </div>
  );
}
