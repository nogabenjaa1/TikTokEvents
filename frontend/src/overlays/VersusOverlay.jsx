import { getUsernameOverride, resolveBackgroundStyle, rowBorder, FONT_SCALES, overlayRootProps, labelProps, labelScaleStyle, titleProps } from '../overlayCustomization';
import vsImage from '../assets/versus-vs.webp';

// Overlay del modo Versus. Un marcador por lado (pedido explícito: "un solo
// score global que vaya sumando el total de valor en coins"; antes había una
// fila con su propio contador por cada regalo, y con dos regalos del mismo
// lado parecía un error):
//  - Se adapta al tamaño de la fuente de OBS: todo se mide en `cqw` (un
//    porcentaje del ANCHO disponible, ver .tkc-vs en index.css), así que se
//    ve proporcionado igual a 600 que a 1200 px de ancho, sin tocar nada.
//  - Cada lado: título, la acción (texto fijo, personalizable, opcional), las
//    monedas que lleva (grande, junto al VS) y los íconos de los regalos que
//    le suman.
// Héroes a la izquierda y villanos a la derecha, con el marcador hacia el VS
// del medio. Se ve aunque no esté iniciado: los marcadores están en 0 hasta
// que llegue el primer regalo.

function GiftChip({ entry, seconds }) {
  return (
    <span className="tkc-vs-chip flex flex-col items-center flex-shrink-0" title={entry.giftName}>
      {entry.giftIcon
        ? <img src={entry.giftIcon} alt={entry.giftName} className="tkc-vs-gift object-contain" />
        : <span className="tkc-vs-gift tkc-ovl-fill rounded-xl" style={{ background: 'var(--surface-bg-alt)' }} aria-label={entry.giftName} role="img" />}
      {seconds && (
        <span className={`tkc-vs-sub font-black tabular-nums leading-none ${entry.secondsDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          {entry.secondsDelta > 0 ? '+' : ''}{entry.secondsDelta}s
        </span>
      )}
    </span>
  );
}

function VersusSide({ title, action, score, gifts, extGifts, showExt, reverse, customize, countOverride, titleZoom }) {
  const align = reverse ? 'items-end text-right' : 'items-start text-left';
  const chipsAlign = reverse ? 'justify-end' : 'justify-start';
  return (
    <div className={`tkc-vs-col min-w-0 flex-1 flex items-center ${reverse ? 'flex-row-reverse' : ''}`}>
      <div className={`tkc-vs-info min-w-0 flex-1 flex flex-col ${align}`}>
        <p {...titleProps(customize, 'tkc-vs-title uppercase font-black leading-none max-w-full truncate', titleZoom)}>{title}</p>
        {action && <p {...labelProps(customize, 'tkc-vs-action font-bold text-white leading-tight truncate max-w-full')}>{action}</p>}
        <div className={`tkc-vs-chips flex flex-wrap ${chipsAlign}`} style={{ border: rowBorder(customize) }}>
          {gifts.length === 0
            ? <span {...labelProps(customize, 'tkc-vs-sub text-gray-500 italic')}>Sin regalos</span>
            : gifts.map((e) => <GiftChip key={e.id} entry={e} />)}
        </div>
        {showExt && extGifts.length > 0 && (
          <div className={`flex flex-col ${align}`}>
            <p {...labelProps(customize, 'tkc-vs-sub uppercase font-bold text-gray-400')}>⏱️ Extensible</p>
            <div className={`tkc-vs-chips flex flex-wrap ${chipsAlign}`}>
              {extGifts.map((e) => <GiftChip key={e.id} entry={e} seconds />)}
            </div>
          </div>
        )}
      </div>
      <p className={`tkc-vs-count font-black tabular-nums leading-none text-yellow-300 flex-shrink-0 ${countOverride.className}`} style={countOverride.cssVars}>
        {(score || 0).toLocaleString('es-MX')}
      </p>
    </div>
  );
}

export function VersusOverlay({ state, customize }) {
  const s = state || {};
  const paused = s.isActive && s.paused;
  // El marcador es el "dato vivo" del overlay: toma el color del nombre de
  // usuario solo si el streamer lo personalizó (por defecto, amarillo), y su
  // tamaño, con un tamaño real (no un scale que se encima).
  const nameColor = customize?.usernameColor?.type;
  const nameOverride = getUsernameOverride(customize, { scale: false });
  const countOverride = !nameColor || nameColor === 'default' ? { className: '', cssVars: {} } : nameOverride;
  const countScale = FONT_SCALES[customize?.usernameColor?.fontSize] ?? 1;

  return (
    <div className="tkc-vs w-full" style={{ '--tkc-vs-count-scale': countScale }}>
      <div className="theme-die-frame tkc-vs-frame w-full font-sans overflow-hidden flex flex-col" {...overlayRootProps(customize, resolveBackgroundStyle(customize))}>
        {paused && (
          <span className="tkc-ovl-fill tkc-vs-sub self-center bg-gray-950/60 border border-gray-500/60 text-gray-300 font-black uppercase tracking-widest px-3 py-1 rounded-full" style={labelScaleStyle(customize)}>
            ⏸ Pausado
          </span>
        )}
        <div className="flex items-center justify-center tkc-vs-cols">
          <VersusSide
            title={s.heroLabel || 'HÉROES'} action={s.heroAction} score={s.heroScore}
            gifts={s.heroes || []} extGifts={s.extHeroes || []}
            showExt={!!s.extensibleLinkEnabled} reverse={false} customize={customize} countOverride={countOverride}
          />
          <img src={vsImage} alt="VS" className="tkc-vs-badge object-contain flex-shrink-0 self-center" />
          <VersusSide
            title={s.villainLabel || 'VILLANOS'} action={s.villainAction} score={s.villainScore}
            gifts={s.villains || []} extGifts={s.extVillains || []}
            showExt={!!s.extensibleLinkEnabled} reverse customize={customize} countOverride={countOverride}
          />
        </div>
      </div>
    </div>
  );
}
