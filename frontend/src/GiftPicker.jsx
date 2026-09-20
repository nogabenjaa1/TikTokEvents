import React, { useState, useEffect, useMemo, useRef, useContext } from 'react';
import { GiftCatalogContext } from './GiftCatalogContext';

// Selector de regalo compartido (juegos, Insta-Win y Alertas). Pedido
// explícito: buscador arriba de la lista que filtra en vivo mientras se
// escribe, por nombre o por monedas -- así se llega rápido al regalo
// deseado en vez de scrollear todo el catálogo. Maneja su propio abierto/
// cerrado (se cierra al hacer clic afuera), por eso dos selectores en el
// mismo panel ya no necesitan coordinarse entre sí.
//
// La lista de TikTok viene incompleta (le faltan regalos, como "Super GG"), así
// que abajo hay una salida: escribir el regalo a mano (ver giftCatalog.js).

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

// Formulario para un regalo que la lista no trae.
function ManualGiftForm({ initialName, onAdd }) {
  const [name, setName] = useState(initialName || '');
  const [coins, setCoins] = useState('');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (name.trim().length < 2) { setError('Escribe el nombre del regalo.'); return; }
    onAdd({ name, coins });
  };

  return (
    <form onSubmit={submit} className="p-3 flex flex-col gap-2" aria-label="Agregar un regalo a mano">
      <p className="text-[11px] text-gray-500 leading-snug">
        Escríbelo tal como aparece en TikTok (por ejemplo «Super GG»). No importan mayúsculas ni acentos. Se guarda en este navegador. Para los
        juegos pon también sus monedas.
      </p>
      <div className="flex gap-2">
        <input
          type="text" value={name} maxLength={60} placeholder="Nombre del regalo"
          onChange={(e) => { setName(e.target.value); setError(''); }}
          aria-label="Nombre del regalo" className="theme-input flex-1 min-w-0 px-3 py-2 text-sm outline-none"
        />
        <input
          type="number" min="0" max="9999999" inputMode="numeric" value={coins} placeholder="Monedas"
          onChange={(e) => setCoins(e.target.value)}
          aria-label="Monedas del regalo" className="theme-input w-24 px-3 py-2 text-sm outline-none"
        />
      </div>
      {error && <p role="alert" className="text-[11px] text-red-700">{error}</p>}
      <button type="submit" className="theme-btn-primary px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest self-start">
        Agregar y elegir
      </button>
    </form>
  );
}

export default function GiftPicker({
  gifts, selected, onSelect, placeholder = 'Elige un regalo...', emptyText = 'Conecta TikTok LIVE para cargar los regalos. Puedes configurar los demás ajustes ahora.',
  variant = 'default', renderBadge, showCoinsChip = true,
}) {
  const { addGift } = useContext(GiftCatalogContext);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const v = VARIANTS[variant] || VARIANTS.default;
  const hasGifts = gifts.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open && !adding) searchRef.current?.focus();
  }, [open, adding]);

  const visible = useMemo(() => filterGifts(gifts, query), [gifts, query]);

  const toggle = () => {
    setOpen((o) => !o);
    setQuery('');
    setAdding(false);
  };

  const pick = (gift) => {
    onSelect(gift);
    setOpen(false);
    setQuery('');
    setAdding(false);
  };

  const addByHand = (raw) => {
    const gift = addGift?.(raw);
    if (gift) pick(gift);
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <button type="button" onClick={toggle} disabled={!hasGifts && !addGift} className={v.trigger} aria-haspopup="listbox" aria-expanded={open && (hasGifts || !!addGift)}>
        {selected ? (
          <>
            <span className="flex items-center gap-3 min-w-0">
              {selected.icon ? <img src={selected.icon} alt="" className="w-6 h-6 flex-shrink-0" /> : <span className="w-6 h-6 flex-shrink-0 text-center leading-6" aria-hidden="true">🎁</span>}
              <span className={`${v.name} truncate`}>{selected.name}</span>
              {renderBadge?.(selected)}
            </span>
            {showCoinsChip && selected.coins > 0 && (
              <span className="text-yellow-400 text-xs font-bold bg-yellow-400/10 px-2 py-1 rounded-md flex-shrink-0">{selected.coins} 🪙</span>
            )}
          </>
        ) : (
          <span className="text-gray-500 text-sm">{!hasGifts && addGift ? 'Escribe un regalo a mano...' : placeholder}</span>
        )}
      </button>

      {!hasGifts && <p className="text-xs text-gray-400 mt-2">{emptyText}</p>}
      {open && (hasGifts || addGift) && (
        <div className={`${v.panel} absolute top-full left-0 w-full mt-1 z-30 overflow-hidden`}>
          {adding || !hasGifts ? (
            <ManualGiftForm initialName={query.trim()} onAdd={addByHand} />
          ) : (
            <>
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
                {visible.length === 0 ? (
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
                      {gift.icon ? <img src={gift.icon} alt="" className="w-6 h-6 flex-shrink-0" /> : <span className="w-6 h-6 flex-shrink-0 text-center leading-6" aria-hidden="true">🎁</span>}
                      <span className={`${v.name} truncate`}>{gift.name}</span>
                      {renderBadge?.(gift)}
                    </div>
                    {gift.coins > 0 && <span className="text-yellow-400 text-xs flex-shrink-0">{gift.coins} 🪙</span>}
                  </button>
                ))}
              </div>
              {addGift && (
                <div className="p-2 border-t" style={{ borderColor: 'var(--surface-border-color)' }}>
                  <button type="button" onClick={() => setAdding(true)} className="w-full text-left text-[11px] font-bold text-gray-300 hover:text-white underline py-1.5 px-1">
                    ¿No encuentras el regalo? Escríbelo a mano
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
