import { useMemo, useState } from 'react';
import { ConfirmButton } from './PanelHelp';
import { summarizeElimEntries, entriesBreakdown, mergeDestination } from './elimEntries';

// Entradas de Eliminación a mano, desde el panel (pedido explícito):
// - Agregar entradas a cualquier @, también a quien ya entró con regalos. Si
//   esa persona mandó cualquier regalo en la ronda (por ejemplo una rosa que
//   no alcanza para una entrada), sale con su foto de TikTok en vez de la
//   foto por defecto: aparece en "Regalaron en esta ronda".
// - Fijar cuántas entradas tiene alguien o quitarlo, sean de regalo o manuales.
// - Combinar a dos participantes en uno de ellos o en otro perfil.
// El servidor valida todo y responde si se aplicó (ver elim_set_entries y
// elim_merge_participants en backend/lib/tenant/elim.js).
export default function ElimEntriesManager({ state, socket }) {
  const [addUser, setAddUser] = useState('');
  const [addCount, setAddCount] = useState(1);
  const [edits, setEdits] = useState({});
  const [selected, setSelected] = useState([]);
  const [mergeTarget, setMergeTarget] = useState('a');
  const [customName, setCustomName] = useState('');
  const [status, setStatus] = useState(null);

  const rows = useMemo(() => summarizeElimEntries(state.participants), [state.participants]);
  const participantNames = useMemo(() => new Set(rows.map((r) => r.username.toLowerCase())), [rows]);
  const recentGifters = state.recentGifters || [];

  // Locked Mode: las entradas se tocan solo durante el tiempo para unirse.
  // Modo normal: en cualquier fase; quitar y combinar, menos durante la
  // animación del sorteo (mismas reglas que el servidor).
  const lockedOut = !!state.lockedMode && !!state.isActive && state.mode !== 'joining' && state.mode !== 'finished';
  const canAdd = !!state.isActive && state.mode !== 'finished' && !lockedOut;
  const canEdit = canAdd && state.mode !== 'revealing';

  // Un seleccionado que ya no está en la lista (eliminado, combinado) se suelta solo.
  const selection = selected.filter((name) => rows.some((r) => r.username === name));
  const [nameA, nameB] = selection;
  const rowA = rows.find((r) => r.username === nameA);
  const rowB = rows.find((r) => r.username === nameB);
  const destination = selection.length === 2 ? mergeDestination(nameA, nameB, mergeTarget, customName) : null;

  const send = (event, payload, onOk) => {
    if (!socket) return;
    setStatus(null);
    socket.emit(event, payload, (res) => {
      if (res?.ok) { setStatus({ ok: true, text: onOk(res) }); }
      else setStatus({ ok: false, text: res?.error || 'No se pudo aplicar el cambio.' });
    });
  };

  const addEntries = () => {
    const username = addUser.trim().replace(/^@+/, '');
    if (!username) return;
    const count = Math.max(1, Math.round(addCount) || 1);
    send('elim_add_manual_entry', { username, count }, (res) => `Listo: ${res.added === 1 ? 'se agregó 1 entrada' : `se agregaron ${res.added} entradas`} a @${res.username}.`);
    setAddUser('');
    setAddCount(1);
  };

  const saveEntries = (username) => {
    const count = Math.max(0, Math.round(Number(edits[username])) || 0);
    send('elim_set_entries', { username, count }, (res) => (res.after === 0 ? `@${res.username} salió de la lista.` : `@${res.username} ahora tiene ${res.after} ${res.after === 1 ? 'entrada' : 'entradas'}.`));
    setEdits((prev) => { const next = { ...prev }; delete next[username]; return next; });
  };

  const removeParticipant = (username) => {
    send('elim_set_entries', { username, count: 0 }, (res) => `@${res.username} salió de la lista.`);
  };

  const toggleSelected = (username) => {
    setSelected((prev) => {
      const current = prev.filter((name) => rows.some((r) => r.username === name));
      if (current.includes(username)) return current.filter((name) => name !== username);
      // Solo se combinan dos a la vez: el tercero reemplaza al más viejo.
      return [...current, username].slice(-2);
    });
  };

  const mergeSelected = () => {
    if (!destination) return;
    send('elim_merge_participants', { a: nameA, b: nameB, target: mergeTarget, customUsername: customName }, (res) => `Listo: @${res.username} ahora tiene ${res.total} ${res.total === 1 ? 'entrada' : 'entradas'}.`);
    setSelected([]);
    setMergeTarget('a');
    setCustomName('');
  };

  return (
    <div className="mb-6 pt-4 border-t border-white/10 space-y-4">
      <div>
        <p className="tkc-label text-gray-400">PARTICIPANTES Y ENTRADAS</p>
        <p className="tkc-hint mt-1">Agrega, corrige, quita o combina entradas. Cuentan igual que las que llegan por regalo. Con Locked Mode solo se pueden cambiar durante el tiempo para unirse.</p>
      </div>

      {lockedOut && (
        <p role="status" className="theme-notice theme-notice-warning">Locked Mode: las entradas ya no se pueden modificar porque empezaron las eliminaciones. Se libera al reiniciar o detener.</p>
      )}

      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={`theme-notice ${status.ok ? 'theme-notice-success' : ''}`}>{status.text}</p>
      )}

      {/* Agregar entradas */}
      <div>
        <label htmlFor="elim-add-user" className="tkc-label block text-gray-400 mb-1">AGREGAR ENTRADAS</label>
        <div className="flex gap-2">
          <input
            id="elim-add-user" list="elim-known-users"
            value={addUser} onChange={(e) => setAddUser(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) addEntries(); }}
            placeholder="usuario de TikTok"
            className="theme-input flex-1 min-w-0 p-2 text-sm outline-none"
          />
          <datalist id="elim-known-users">
            {rows.map((r) => <option key={r.username} value={r.username} />)}
            {recentGifters.filter((g) => !participantNames.has(g.username.toLowerCase())).map((g) => <option key={`g-${g.username}`} value={g.username} />)}
          </datalist>
          <input
            type="number" min="1" inputMode="numeric" value={addCount} aria-label="Cuántas entradas"
            onChange={(e) => setAddCount(Math.max(1, Number(e.target.value) || 1))}
            className="theme-input w-16 p-2 text-center text-sm outline-none"
          />
          <button type="button" onClick={addEntries} disabled={!canAdd || !addUser.trim()}
            className="theme-btn-secondary theme-btn-sm font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed">
            Agregar
          </button>
        </div>
        <p className="tkc-hint mt-1">
          Si ya participa, se le suman con su misma foto. Para que alguien salga con su @ y su foto de TikTok, pídele que mande cualquier regalo (una rosa basta): aparecerá abajo. Si no, sale con una foto por defecto.
        </p>

        {recentGifters.length > 0 && (
          <div className="mt-2">
            <p className="tkc-label text-gray-500 mb-1">REGALARON EN ESTA RONDA</p>
            <div className="flex flex-wrap gap-1.5">
              {recentGifters.map((g) => {
                const inList = participantNames.has(g.username.toLowerCase());
                return (
                  <button key={g.username} type="button" onClick={() => setAddUser(g.username)}
                    title={inList ? 'Ya participa: toca para sumarle entradas' : 'Todavía sin entradas: toca para dárselas'}
                    className="theme-input flex items-center gap-1.5 pl-1 pr-2 py-1 text-xs hover:opacity-80">
                    {g.avatar
                      ? <img alt="" src={g.avatar} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      : <span className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: 'var(--surface-border-color)' }} />}
                    <span className="font-bold text-white">@{g.username}</span>
                    {!inList && <span className="text-gray-500">sin entradas</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Lista editable */}
      {rows.length > 0 && (
        <div>
          <p className="tkc-label text-gray-400 mb-1">EN LA LISTA ({rows.length})</p>
          {state.mode === 'revealing' && !lockedOut && <p className="tkc-hint mb-1">Espera a que termine el sorteo para editar las entradas.</p>}
          <ul className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {rows.map((r) => {
              const draft = edits[r.username];
              const changed = draft !== undefined && Number(draft) !== r.total;
              const isSelected = selection.includes(r.username);
              return (
                <li key={r.username} className={`theme-input flex items-center gap-2 px-2 py-1.5 ${isSelected ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(r.username)} disabled={!canEdit}
                    aria-label={`Seleccionar a @${r.username} para combinar`} className="w-4 h-4 flex-shrink-0" />
                  <img alt="" src={r.avatar} className="w-7 h-7 rounded-full border-2 object-cover flex-shrink-0" style={{ borderColor: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">@{r.username}</p>
                    <p className="text-[11px] text-gray-500 truncate">{entriesBreakdown(r)}</p>
                  </div>
                  <input
                    type="number" min="0" inputMode="numeric" aria-label={`Entradas de @${r.username}`}
                    value={draft ?? r.total} disabled={!canEdit}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [r.username]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && changed) saveEntries(r.username); }}
                    className="theme-input w-16 p-1.5 text-center text-sm font-bold outline-none flex-shrink-0 disabled:opacity-50"
                  />
                  {changed ? (
                    <button type="button" onClick={() => saveEntries(r.username)} disabled={!canEdit}
                      className="theme-btn-primary theme-btn-sm font-black uppercase flex-shrink-0 disabled:opacity-40">
                      Guardar
                    </button>
                  ) : (
                    <ConfirmButton needsConfirm onConfirm={() => removeParticipant(r.username)} disabled={!canEdit} confirmLabel="¿Quitar?"
                      className="theme-btn-danger theme-btn-sm font-black uppercase flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                      Quitar
                    </ConfirmButton>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="tkc-hint mt-1">Cambia el número y toca Guardar: si baja, se quitan primero las entradas más recientes. Marca a dos participantes para combinarlos.</p>
        </div>
      )}

      {/* Combinar */}
      {rowA && rowB && (
        <fieldset className="theme-surface-featured p-4 space-y-3">
          <legend className="tkc-label text-gray-400 px-1">COMBINAR PARTICIPANTES</legend>
          <p className="text-sm text-white">
            @{rowA.username} ({rowA.total}) + @{rowB.username} ({rowB.total}) = <span className="font-black">{rowA.total + rowB.total} entradas</span>
          </p>
          <div className="space-y-1.5 text-sm">
            <p className="tkc-label text-gray-400">¿A QUIÉN SE LE QUEDAN?</p>
            {[
              { id: 'a', label: `A @${rowA.username}`, hint: `@${rowB.username} sale de la lista` },
              { id: 'b', label: `A @${rowB.username}`, hint: `@${rowA.username} sale de la lista` },
              { id: 'custom', label: 'A otro perfil', hint: 'Los dos salen de la lista y el otro perfil recibe la suma como entradas manuales' },
            ].map((opt) => (
              <label key={opt.id} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="elim-merge-target" value={opt.id} checked={mergeTarget === opt.id} onChange={() => setMergeTarget(opt.id)} className="mt-1" />
                <span>
                  <span className="font-bold text-white">{opt.label}</span>
                  <span className="block tkc-hint">{opt.hint}</span>
                </span>
              </label>
            ))}
            {mergeTarget === 'custom' && (
              <>
                <input
                  value={customName} onChange={(e) => setCustomName(e.target.value)} list="elim-known-users"
                  placeholder="usuario que recibe las entradas" aria-label="Usuario que recibe las entradas"
                  className="theme-input w-full p-2 text-sm outline-none"
                />
                <p className="tkc-hint">Si ese usuario ya participa, se le suman a él. Si mandó un regalo en esta ronda, sale con su foto de TikTok.</p>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton needsConfirm onConfirm={mergeSelected} disabled={!canEdit || !destination}
              confirmLabel={destination ? `¿Combinar en @${destination}?` : undefined}
              className="theme-btn-primary theme-btn-md flex-1 font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed">
              Combinar
            </ConfirmButton>
            <button type="button" onClick={() => setSelected([])} className="theme-btn-secondary theme-btn-md font-black uppercase tracking-widest">
              Cancelar
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
