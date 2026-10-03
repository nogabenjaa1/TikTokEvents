import { getUsernameOverride, resolveBackgroundStyle, rowBorder, FONT_SCALES, overlayRootProps, labelProps, labelScaleStyle, titleProps } from '../overlayCustomization';
import vsImage from '../assets/versus-vs.png';

// Overlay del modo Versus (rediseño, pedido explícito: "demasiado grande,
// letras muy chicas y separadas, mucho espacio desperdiciado"). Ahora:
//  - Se adapta al tamaño de la fuente de OBS: todo se mide en `cqw` (un
//    porcentaje del ANCHO disponible, ver .tkc-vs en index.css), así que se
//    ve proporcionado igual a 600 que a 1200 px de ancho, sin tocar nada.
//  - El alto lo pone el contenido: con un regalo por lado es una franja
//    baja; no reserva 700 px vacíos.
//  - Cada fila es solo lo que importa: imagen del regalo, la acción (texto
//    fijo, personalizable) y el contador, grande.
// Héroes a la izquierda y villanos a la derecha, con la imagen hacia afuera
// y el contador hacia el VS del medio. Se ve aunque no esté iniciado: los
// contadores están en 0 hasta que llegue el primer regalo.

function GiftImage({ src }) {
  return src
    ? <img src={src} alt="" className="tkc-vs-gift object-contain flex-shrink-0" />
    : <span className="tkc-vs-gift tkc-ovl-fill rounded-xl flex-shrink-0" style={{ background: 'var(--surface-bg-alt)' }} aria-hidden="true" />;
}

// `mode 'action'`: acción + cuántos van (lista base). `mode 'seconds'`:
// cuántos segundos suma o resta (vínculo con Extensible).
function VersusRow({ entry, mode, reverse, customize, countOverride }) {
  return (
    <div className={`tkc-vs-row flex items-center ${reverse ? 'flex-row-reverse text-right' : ''}`} style={{ border: rowBorder(customize) }}>
      <GiftImage src={entry.giftIcon} />
      <div className={`min-w-0 flex flex-col ${reverse ? 'items-end' : 'items-start'}`}>
        <p {...labelProps(customize, 'tkc-vs-action font-bold text-white leading-tight truncate max-w-full')}>{entry.actionText || entry.giftName}</p>
        {mode === 'action' ? (
          <p className={`tkc-vs-count font-black tabular-nums leading-none text-yellow-300 ${countOverride.className}`} style={countOverride.cssVars}>
            {entry.count || 0}
          </p>
        ) : (
          <p className={`tkc-vs-count font-black tabular-nums leading-none ${entry.secondsDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {entry.secondsDelta > 0 ? '+' : ''}{entry.secondsDelta}s
          </p>
        )}
      </div>
    </div>
  );
}

function VersusColumn({ title, actionList, extList, showExt, reverse, customize, countOverride, titleZoom }) {
  const empty = actionList.length === 0 && (!showExt || extList.length === 0);
  return (
    <div className="min-w-0 flex flex-col tkc-vs-col">
      <p {...titleProps(customize, `tkc-vs-title uppercase font-black leading-none ${reverse ? 'text-right' : 'text-left'}`, titleZoom)}>{title}</p>
      {empty && <p {...labelProps(customize, `tkc-vs-action text-gray-500 italic ${reverse ? 'text-right' : ''}`)}>Sin regalos</p>}
      {actionList.map((e) => <VersusRow key={e.id} entry={e} mode="action" reverse={reverse} customize={customize} countOverride={countOverride} />)}
      {showExt && extList.length > 0 && (
        <>
          <p {...labelProps(customize, `tkc-vs-sub uppercase font-bold text-gray-400 ${reverse ? 'text-right' : ''}`)}>⏱️ Extensible</p>
          {extList.map((e) => <VersusRow key={e.id} entry={e} mode="seconds" reverse={reverse} customize={customize} countOverride={countOverride} />)}
        </>
      )}
    </div>
  );
}

export function VersusOverlay({ state, customize }) {
  const s = state || {};
  const paused = s.isActive && s.paused;
  // El contador es el "dato vivo" del overlay: toma el color del nombre de
  // usuario solo si el streamer lo personalizó (por defecto, amarillo), y su
  // tamaño, con un tamaño real (no un scale que se encima).
  const nameColor = customize?.usernameColor?.type;
  const nameOverride = getUsernameOverride(customize, { scale: false });
  const countOverride = !nameColor || nameColor === 'default' ? { className: '', cssVars: {} } : nameOverride;
  const countScale = FONT_SCALES[customize?.usernameColor?.fontSize] ?? 1;

  return (
    <div className="tkc-vs w-full" style={{ '--tkc-vs-count-scale': countScale }}>
      <div className="theme-die-frame tkc-vs-frame w-fit max-w-full mx-auto font-sans overflow-hidden flex flex-col" {...overlayRootProps(customize, resolveBackgroundStyle(customize))}>
        {paused && (
          <span className="tkc-ovl-fill tkc-vs-sub self-center bg-gray-950/60 border border-gray-500/60 text-gray-300 font-black uppercase tracking-widest px-3 py-1 rounded-full" style={labelScaleStyle(customize)}>
            ⏸ Pausado
          </span>
        )}
        <div className="flex items-start justify-center tkc-vs-cols">
          <VersusColumn
            title={s.heroLabel || 'HÉROES'} actionList={s.heroes || []} extList={s.extHeroes || []}
            showExt={!!s.extensibleLinkEnabled} reverse={false} customize={customize} countOverride={countOverride}
          />
          <img src={vsImage} alt="VS" className="tkc-vs-badge object-contain flex-shrink-0 self-center" />
          <VersusColumn
            title={s.villainLabel || 'VILLANOS'} actionList={s.villains || []} extList={s.extVillains || []}
            showExt={!!s.extensibleLinkEnabled} reverse customize={customize} countOverride={countOverride}
          />
        </div>
      </div>
    </div>
  );
}
