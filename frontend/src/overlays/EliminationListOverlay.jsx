import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getUsernameOverride, resolveBackgroundStyle, rowBorder, overlayRootProps, labelProps, labelScaleStyle } from '../overlayCustomization';
import { groupElimEntries, paginate, rowsPerPage } from '../eliminationList';
import { OfflineCard } from './shared';

// Overlay secundario de Eliminación (?screen=elimlist): la lista de quién
// sigue participando y con cuántas entradas. El overlay principal solo
// muestra burbujas que se achican con la cantidad; aquí se lee el nombre y
// el número de cada uno sin cargar ese overlay.
// Mismo tamaño fijo que los demás verticales (380x700): lo que no cabe pasa
// a la página siguiente, y las páginas rotan solas cada PAGE_MS (el overlay
// de OBS no tiene controles). Cuántas filas caben se mide en el alto real
// de la lista, así un premio o un texto más grande no recortan ninguna fila.
const ROW_HEIGHT = 52;
const ROW_GAP = 8;
const PAGE_MS = 6000;
const MAX_PAGE_DOTS = 12;

const MODE_LABELS = {
  joining: 'Uniéndose',
  rejoin: 'Reingreso',
  revealing: 'Sorteando',
  result: 'Eliminados',
  finished: 'Terminado',
};

function entriesLabel(n) {
  return n === 1 ? '1 entrada' : `${n} entradas`;
}

export function EliminationListOverlay({ state, customize }) {
  const listRef = useRef(null);
  const [perPage, setPerPage] = useState(1);
  const [page, setPage] = useState(0);

  const rows = groupElimEntries(state?.participants);
  const totalEntries = rows.reduce((sum, r) => sum + r.entries, 0);
  const pages = paginate(rows, perPage);
  const pageCount = pages.length;
  // Si la lista se achica (eliminados) y la página actual deja de existir,
  // se muestra la última que queda en vez de una vacía.
  const current = Math.min(page, pageCount - 1);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setPerPage(rowsPerPage(el.clientHeight, ROW_HEIGHT, ROW_GAP));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state?.isActive, state?.mode]);

  useEffect(() => {
    if (pageCount <= 1) return undefined;
    const id = setInterval(() => setPage((p) => (Math.min(p, pageCount - 1) + 1) % pageCount), PAGE_MS);
    return () => clearInterval(id);
  }, [pageCount]);

  if (!state || (!state.isActive && state.mode !== 'finished')) return <OfflineCard customize={customize} />;

  const rowBg = resolveBackgroundStyle(customize, 'var(--surface-bg-alt)');
  const nameOverride = getUsernameOverride(customize);
  const winnerName = state.mode === 'finished' ? state.winner?.username : null;
  const statusLabel = state.paused && state.mode !== 'finished' ? 'Pausado' : MODE_LABELS[state.mode];
  const firstRank = current * perPage;

  return (
    <div className="theme-die-frame w-[380px] h-[700px] p-6 flex flex-col gap-3 relative overflow-hidden font-sans" {...overlayRootProps(customize, resolveBackgroundStyle(customize))}>
      <div className="flex flex-col items-center gap-1 flex-shrink-0 text-center">
        <p {...labelProps(customize, 'theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black')}>💀 Eliminación — Participantes</p>
        <p {...labelProps(customize, 'text-xs font-bold text-gray-400')}>
          {rows.length} {rows.length === 1 ? 'jugador' : 'jugadores'} · {entriesLabel(totalEntries)}
        </p>
        {statusLabel && (
          <span className="tkc-ovl-fill text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border text-gray-300" style={{ ...labelScaleStyle(customize), borderColor: 'var(--surface-border-color)' }}>
            {statusLabel}
          </span>
        )}
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-hidden">
        {rows.length > 0 ? (
          // `key` por página: al cambiar de página la lista entra con un fundido.
          <div key={current} className="flex flex-col" style={{ gap: ROW_GAP, animation: 'tkc-fade-in var(--motion-slow) var(--ease-out-soft) backwards' }}>
            {pages[current].map((r, i) => {
              const isWinner = r.username === winnerName;
              return (
                <div key={r.username} className={`flex items-center gap-3 rounded-xl px-3 ${isWinner ? 'border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : ''}`}
                  style={{ height: ROW_HEIGHT, ...rowBg, ...(isWinner ? null : { border: rowBorder(customize) }) }}>
                  <span className="w-6 text-center text-xs font-black text-gray-400 flex-shrink-0">{isWinner ? '👑' : firstRank + i + 1}</span>
                  <img alt="" src={r.avatar} className={`w-9 h-9 rounded-full border-2 object-cover flex-shrink-0 ${isWinner ? 'border-yellow-400' : ''}`} style={isWinner ? undefined : { borderColor: 'var(--accent)' }} />
                  <span className={`flex-1 min-w-0 text-sm font-bold text-white truncate ${nameOverride.className}`} style={nameOverride.cssVars}>@{r.username}</span>
                  {/* Color de acento (no amarillo): sobre el fondo pastel el amarillo no se leía. */}
                  <span className="tkc-ovl-fill theme-accent-text text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 tabular-nums"
                    style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', border: '1px solid color-mix(in oklch, var(--accent) 45%, transparent)' }}>
                    {entriesLabel(r.entries)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p {...labelProps(customize, 'text-gray-600 text-sm italic text-center py-4')}>Esperando participantes...</p>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          {/* Puntos solo con pocas páginas: con muchas no caben a lo ancho y basta el texto. */}
          {pageCount <= MAX_PAGE_DOTS && (
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {pages.map((_, i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === current ? 'var(--accent)' : 'var(--surface-border-color)' }} />
              ))}
            </div>
          )}
          <p {...labelProps(customize, 'text-[10px] uppercase tracking-[0.3em] font-bold text-gray-500')}>Página {current + 1} de {pageCount}</p>
        </div>
      )}
    </div>
  );
}
