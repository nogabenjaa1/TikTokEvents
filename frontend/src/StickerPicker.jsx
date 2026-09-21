import { useState, useEffect, useRef } from 'react';
import { stickerLabel } from './stickerCatalog';

// Selector de sticker del club de fans para las Alertas: una lista desplegable como la de los
// regalos (ver GiftPicker.jsx), pero con la imagen de cada sticker, que es lo que los distingue
// (TikTok no les da nombre). La primera opción es siempre "cualquier sticker": la alerta general,
// que sirve para los stickers que no tengan la suya. Se cierra con Escape o al hacer clic fuera.
//
// `selected` es un sticker { id, imageUrl } o null (= cualquiera). `renderBadge` pinta un aviso al
// lado de cada opción de la lista (por ejemplo "ya tiene alerta"); en el botón no va, para que el
// nombre no se corte en pantallas angostas (el formulario ya avisa del conflicto del elegido).

// Un sticker sin imagen (todavía no llegó, o TikTok ya no la sirve) se muestra igual con un ícono.
function StickerImage({ sticker, size }) {
  const [failed, setFailed] = useState(false);
  if (!sticker?.imageUrl || failed) {
    return <span className={`${size} flex-shrink-0 flex items-center justify-center text-lg`} aria-hidden="true">🎫</span>;
  }
  return <img src={sticker.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${size} flex-shrink-0 object-contain`} />;
}

export default function StickerPicker({ stickers, selected, onSelect, anyLabel = 'Cualquier sticker', renderBadge }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (sticker) => {
    onSelect(sticker);
    setOpen(false);
  };

  const rowClass = 'w-full text-left p-2 cursor-pointer flex items-center gap-3 hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]';

  return (
    <div ref={rootRef} className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="theme-input w-full p-3 cursor-pointer flex items-center justify-between gap-2 text-left hover:border-[var(--accent)]"
        aria-haspopup="listbox" aria-expanded={open}
      >
        <span className="flex items-center gap-3 min-w-0">
          <StickerImage key={selected?.imageUrl || 'any'} sticker={selected} size="w-9 h-9" />
          <span className="text-sm truncate">{selected ? stickerLabel(selected) : anyLabel}</span>
        </span>
        <span className="text-gray-500 text-xs flex-shrink-0" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="theme-surface absolute top-full left-0 w-full mt-1 z-30 overflow-hidden">
          <div role="listbox" aria-label="Stickers (emotes) de tu chat" className="overflow-y-auto max-h-64">
            <button type="button" role="option" aria-selected={!selected} onClick={() => pick(null)} className={rowClass}>
              <StickerImage sticker={null} size="w-9 h-9" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-tight">{anyLabel}</span>
                <span className="block text-[10px] text-gray-500">Para los que no tengan su propia alerta</span>
              </span>
              {renderBadge?.(null)}
            </button>
            {stickers.map((sticker) => (
              <button type="button" key={sticker.id} role="option" aria-selected={selected?.id === sticker.id} onClick={() => pick(sticker)} className={rowClass}>
                <StickerImage key={sticker.imageUrl} sticker={sticker} size="w-9 h-9" />
                <span className="text-sm truncate flex-1 min-w-0">{stickerLabel(sticker)}</span>
                {renderBadge?.(sticker)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
