import React, { useState, useEffect, useMemo, useRef } from 'react';

// Selector de regalo compartido (juegos, Insta-Win y Alertas). Pedido
// explícito: buscador arriba de la lista que filtra en vivo mientras se
// escribe, por nombre o por monedas -- así se llega rápido al regalo
// deseado en vez de scrollear todo el catálogo. Maneja su propio abierto/
// cerrado (se cierra al hacer clic afuera), por eso dos selectores en el
// mismo panel ya no necesitan coordinarse entre sí.

const normalize = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{M}/gu, '');

// Nombre: contiene el texto (sin importar acentos ni mayúsculas). Monedas:
// el número de monedas EMPIEZA con lo escrito ("99" encuentra 99 y 990,
// pero "9" no trae todos los que solo lo llevan adentro, como 199).
function filterGifts(gifts, query) {
  const q = normalize(query).trim();
  if (!q) return gifts;
  return gifts.filter((gift) => normalize(gift.name).includes(q) || String(gift.coins).startsWith(q));
}

const VARIANTS = {
  default: {
    trigger: 'theme-input w-full p-3 cursor-pointer flex items-center justify-between gap-2 text-left hover:border-[var(--accent)]',
    panel: 'theme-surface',
    row: 'hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]',
    name: 'text-sm',
  },
  insta: {
    trigger: 'w-full p-3 bg-yellow-900/10 rounded-xl border border-yellow-700/50 cursor-pointer flex items-center justify-between gap-2 text-left hover:border-yellow-500',
    panel: 'bg-[var(--surface-bg-alt)] border border-yellow-700/50 rounded-xl shadow-xl',
    row: 'hover:bg-yellow-900/30',
    name: 'text-sm',
  },
};

export default function GiftPicker({
  gifts, selected, onSelect, placeholder = 'Elige un regalo...', emptyText = 'Conecta TikTok LIVE para cargar los regalos. Puedes configurar los demás ajustes ahora.',
  variant = 'default', renderBadge, showCoinsChip = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const v = VARIANTS[variant] || VARIANTS.default;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const visible = useMemo(() => filterGifts(gifts, query), [gifts, query]);

  const toggle = () => {
    setOpen((o) => !o);
    setQuery('');
  };

  const pick = (gift) => {
    onSelect(gift);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <button type="button" onClick={toggle} disabled={!gifts.length} className={v.trigger} aria-haspopup="listbox" aria-expanded={open && gifts.length > 0}>
        {selected ? (
          <>
            <span className="flex items-center gap-3 min-w-0">
              {selected.icon && <img src={selected.icon} alt="" className="w-6 h-6 flex-shrink-0" />}
              <span className={`${v.name} truncate`}>{selected.name}</span>
              {renderBadge?.(selected)}
            </span>
            {showCoinsChip && selected.coins > 0 && (
              <span className="text-yellow-400 text-xs font-bold bg-yellow-400/10 px-2 py-1 rounded-md flex-shrink-0">{selected.coins} 🪙</span>
            )}
          </>
        ) : (
          <span className="text-gray-500 text-sm">{placeholder}</span>
        )}
      </button>

      {!gifts.length && <p className="text-xs text-gray-400 mt-2">{emptyText}</p>}
      {open && gifts.length > 0 && (
        <div className={`${v.panel} absolute top-full left-0 w-full mt-1 z-30 overflow-hidden`}>
          <div className="p-2 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && visible.length > 0) { e.preventDefault(); pick(visible[0]); } }}
              placeholder="Buscar por nombre o monedas..."
              aria-label="Buscar regalo"
              className="theme-input w-full px-3 py-2 text-sm outline-none"
            />
          </div>
          <div role="listbox" className="overflow-y-auto max-h-48">
            {gifts.length === 0 ? (
              <p className="p-3 text-[11px] text-gray-500 leading-snug">{emptyText}</p>
            ) : visible.length === 0 ? (
              <p className="p-3 text-[11px] text-gray-500">Sin resultados para "{query.trim()}".</p>
            ) : visible.map((gift, i) => (
              <button type="button"
                key={`${gift.id ?? 'none'}-${i}`}
                role="option"
                aria-selected={selected?.id === gift.id}
                onClick={() => pick(gift)}
                className={`w-full text-left p-2 ${v.row} cursor-pointer flex items-center justify-between gap-2`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {gift.icon && <img src={gift.icon} alt="" className="w-6 h-6 flex-shrink-0" />}
                  <span className={`${v.name} truncate`}>{gift.name}</span>
                  {renderBadge?.(gift)}
                </div>
                {gift.coins > 0 && <span className="text-yellow-400 text-xs flex-shrink-0">{gift.coins} 🪙</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
