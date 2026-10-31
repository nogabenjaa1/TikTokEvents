import { useState } from 'react';
import { HowItWorks, StartRequirement, ConfirmButton } from './PanelHelp';
import { useActionLock } from './liveApply';
import GiftPicker from './GiftPicker';

const MAX_ACTION_TEXT = 40; // mismo tope que MAX_ACTION_TEXT en lib/tenant/versus.js
const BASE_LIST_CAP = 30;   // mismo tope que BASE_LIST_CAP ahí
const EXT_LIST_CAP = 10;    // mismo tope que EXT_LIST_CAP ahí

// Mismo criterio que conflictForTrigger en AlertsAdmin.jsx: id de TikTok
// primero (estable), nombre sin mayúsculas si no hay id.
function findEntryClient(list, gift) {
  if (!gift) return null;
  return list.find((e) => (gift.id && e.giftId && String(e.giftId) === String(gift.id)) || e.giftName.toLowerCase() === gift.name.toLowerCase()) || null;
}

function GiftRow({ entry, icon, valueLabel, onRemove }) {
  return (
    <div className="theme-input flex items-center gap-3 px-3 py-2">
      {icon ? (
        <img alt="" src={icon} className="w-8 h-8 object-contain flex-shrink-0" />
      ) : (
        <span className="w-8 h-8 rounded-lg flex-shrink-0 theme-input" role="img" aria-label="Regalo sin imagen" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white truncate">{entry.giftName}</p>
        <p className="text-[11px] text-gray-500 truncate">{valueLabel}</p>
      </div>
      <button type="button" onClick={onRemove} className="text-[10px] font-bold text-red-400 hover:text-red-300 underline px-1 flex-shrink-0" aria-label={`Borrar ${entry.giftName}`}>
        Borrar
      </button>
    </div>
  );
}

// Agregar + listar los regalos de UN lado de UNA de las dos listas
// independientes (mode 'action': la lista base, cuyas monedas suman al
// marcador del lado; mode 'seconds': el vínculo opcional con Extensible, con
// segundos +/-). `siblingList` es el lado CONTRARIO de esta MISMA lista —
// un regalo no puede estar de los dos lados a la vez (sí puede repetirse
// entre la lista base y la de Extensible, son cosas distintas).
function GiftSideEditor({ title, kind, list, siblingList, giftsList, cap, mode, score, socket }) {
  const [draftGift, setDraftGift] = useState(null);
  const [seconds, setSeconds] = useState(5);

  const conflict = (gift) => findEntryClient(list, gift) || findEntryClient(siblingList, gift);
  const full = list.length >= cap;
  // El catálogo del panel: monedas de cada regalo y su ícono si el servidor
  // todavía no tiene uno.
  const catalogGift = (entry) => giftsList.find((g) => (entry.giftId && String(g.id) === String(entry.giftId)) || g.name.toLowerCase() === entry.giftName.toLowerCase());

  const add = () => {
    if (!draftGift || full || conflict(draftGift)) return;
    socket?.emit('versus_add_gift', {
      kind, giftName: draftGift.name, giftId: draftGift.id, giftIcon: draftGift.icon || undefined,
      secondsDelta: mode === 'seconds' ? seconds : undefined,
    });
    setDraftGift(null); setSeconds(5);
  };

  const remove = (id) => socket?.emit('versus_remove_gift', { id });

  return (
    <div className="theme-surface p-5 flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="theme-heading text-sm font-bold">{title}</h3>
        <span className="theme-chip text-[10px] font-bold px-2 py-0.5 rounded-full">{list.length}/{cap}</span>
      </div>
      {mode === 'action' && (
        <p className="text-2xl font-black tabular-nums text-yellow-300 mb-3">
          {(score || 0).toLocaleString('es-MX')} <span className="text-xs font-bold text-gray-400">monedas</span>
        </p>
      )}
      <div className="flex flex-col gap-2 mb-4">
        <GiftPicker
          gifts={giftsList.filter((g) => g.coins > 0)}
          selected={draftGift}
          onSelect={setDraftGift}
          placeholder="Elige un regalo para agregar..."
          renderBadge={(gift) => conflict(gift) && <span className="theme-chip text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex-shrink-0">ya asignado</span>}
        />
        {mode === 'seconds' && (
          <div className="flex items-center gap-2">
            <input
              type="number" value={seconds} onChange={(e) => setSeconds(Math.trunc(Number(e.target.value) || 0))}
              className="theme-input w-24 p-2 text-sm outline-none" aria-label="Segundos que suma o resta"
            />
            <span className="text-[11px] text-gray-400">segundos (negativo para restar)</span>
          </div>
        )}
        <button
          type="button" onClick={add}
          disabled={!draftGift || full || !!conflict(draftGift)}
          className="theme-btn-primary theme-btn-sm font-black uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ＋ Agregar
        </button>
        {full && <p className="text-[11px] text-amber-500">Llegaste al tope de {cap} regalos de este lado.</p>}
      </div>
      <div className="flex flex-col gap-2">
        {list.length === 0 ? (
          <p className="text-gray-600 text-xs italic">Todavía no hay regalos aquí.</p>
        ) : list.map((entry) => {
          const fromCatalog = catalogGift(entry);
          const coins = fromCatalog?.coins;
          return (
            <GiftRow
              key={entry.id} entry={entry} icon={entry.giftIcon || fromCatalog?.icon || ''}
              valueLabel={mode === 'action' ? (coins ? `Suma ${coins} ${coins === 1 ? 'moneda' : 'monedas'} por regalo` : 'Suma sus monedas') : `${entry.secondsDelta > 0 ? '+' : ''}${entry.secondsDelta}s`}
              onRemove={() => remove(entry.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// VERSUS — Héroes contra villanos
// A diferencia de los demás juegos no tiene timer: es un marcador por lado
// que suma las monedas de cada regalo que matchea, con el mismo ciclo
// Iniciar/Pausar/Reanudar/Reiniciar/Detener de siempre. Dos listas de
// regalos independientes: la base (la que suma al marcador) y, aparte,
// un vínculo opcional con el modo Extensible (segundos +/- al timer).
// ─────────────────────────────────────────────
export default function Versus({ state, socket, username, connectionStatus, giftsList }) {
  const [startError, setStartError] = useState('');
  // Ajustes con guardado explícito (no en vivo con cada tecla, a propósito):
  // son solo cosméticos/de configuración, no hace falta la complejidad de
  // sincronizarlos en vivo entre pestañas — se leen del servidor una sola
  // vez al montar (mismo criterio que otros campos de este código base) y
  // "Guardar ajustes" manda el valor actual completo.
  const [heroLabel, setHeroLabel] = useState(state.heroLabel || 'HÉROES');
  const [villainLabel, setVillainLabel] = useState(state.villainLabel || 'VILLANOS');
  const [heroAction, setHeroAction] = useState(state.heroAction || '');
  const [villainAction, setVillainAction] = useState(state.villainAction || '');
  const [linkEnabled, setLinkEnabled] = useState(!!state.extensibleLinkEnabled);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const saveSettings = () => {
    socket?.emit('update_versus_settings', { heroLabel: heroLabel.trim() || 'HÉROES', villainLabel: villainLabel.trim() || 'VILLANOS', heroAction: heroAction.trim(), villainAction: villainAction.trim(), extensibleLinkEnabled: linkEnabled });
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const startVersus = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    socket.emit('start_versus', { tiktokUsername: username });
  };
  const pauseVersus = () => socket.emit('pause_versus');
  const resumeVersus = () => socket.emit('resume_versus');
  const restartVersus = () => socket.emit('restart_versus');
  const stopVersus = () => socket.emit('stop_versus');
  // Sin doble clic en Iniciar/Reiniciar, y confirmar antes de borrar un
  // marcador que ya tiene puntos (ver liveApply.js / ConfirmButton).
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}`);
  const hasProgress = state.isActive && ((state.heroScore ?? 0) + (state.villainScore ?? 0)) > 0;

  const heroes = state.heroes || [];
  const villains = state.villains || [];
  const extHeroes = state.extHeroes || [];
  const extVillains = state.extVillains || [];

  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 gap-6 overflow-y-auto">
      <div className="w-full max-w-4xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">VERSUS</h1>
        </div>
        <HowItWorks storageKey="versus">
          <p>Asigna regalos a <span className="font-bold text-white">héroes</span> y a <span className="font-bold text-white">villanos</span>, y cada regalo suma sus monedas al marcador de su lado — el overlay muestra cuántas monedas lleva cada lado y los íconos de los regalos que le suman.</p>
          <p>Opcional: vincúlalo con el modo Extensible para que, además, algunos regalos sumen o resten segundos a su cuenta.</p>
        </HowItWorks>
      </div>

      <section className="theme-surface w-full max-w-4xl p-6">
        <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />
        <div className="flex gap-3 flex-wrap">
          {!state.isActive ? (
            <button
              onClick={() => runLocked(startVersus)} disabled={connectionStatus !== 'connected' || actionLocked}
              className="theme-btn-primary theme-btn-lg flex-1 font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
            </button>
          ) : (
            <>
              <button onClick={state.paused ? resumeVersus : pauseVersus} className="theme-btn-secondary theme-btn-lg flex-1 font-bold tracking-wide transition-all">
                {state.paused ? 'REANUDAR' : 'PAUSAR'}
              </button>
              <ConfirmButton needsConfirm={hasProgress} onConfirm={() => runLocked(restartVersus)} disabled={actionLocked} className="theme-btn-warning theme-btn-lg flex-1 font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                REINICIAR ⟲
              </ConfirmButton>
            </>
          )}
          <ConfirmButton needsConfirm={hasProgress} onConfirm={stopVersus} className="theme-btn-danger theme-btn-lg font-bold transition-all">DETENER</ConfirmButton>
        </div>
        {state.isActive && (
          <p className="text-[11px] text-gray-500 mt-3">
            {state.paused ? 'Pausado — los regalos no cuentan hasta que reanudes.' : 'En vivo — contando regalos.'}
          </p>
        )}
      </section>

      <section className="theme-surface w-full max-w-4xl p-6">
        <h2 className="theme-heading text-lg font-semibold mb-4">Ajustes</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">Título del lado héroes</label>
            <input type="text" value={heroLabel} onChange={(e) => setHeroLabel(e.target.value.slice(0, 30))} className="theme-input w-full p-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">Título del lado villanos</label>
            <input type="text" value={villainLabel} onChange={(e) => setVillainLabel(e.target.value.slice(0, 30))} className="theme-input w-full p-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">Acción de los héroes (opcional)</label>
            <input type="text" value={heroAction} onChange={(e) => setHeroAction(e.target.value.slice(0, MAX_ACTION_TEXT))} placeholder="Ej: hablar" className="theme-input w-full p-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">Acción de los villanos (opcional)</label>
            <input type="text" value={villainAction} onChange={(e) => setVillainAction(e.target.value.slice(0, MAX_ACTION_TEXT))} placeholder="Ej: silencio" className="theme-input w-full p-2 text-sm outline-none" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mb-4">
          <input type="checkbox" checked={linkEnabled} onChange={(e) => setLinkEnabled(e.target.checked)} />
          Vincular con el modo Extensible (algunos regalos suman/restan segundos a su cuenta)
        </label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={saveSettings} className="theme-btn-primary theme-btn-md font-black uppercase tracking-widest">
            Guardar ajustes
          </button>
          {settingsSaved && <span className="text-[11px] font-bold text-green-400 tkc-pop">Guardado</span>}
        </div>
      </section>

      <div className="w-full max-w-4xl flex flex-col sm:flex-row gap-4">
        <GiftSideEditor
          title={heroLabel || 'HÉROES'} kind="hero" mode="action"
          list={heroes} siblingList={villains} giftsList={giftsList} cap={BASE_LIST_CAP} score={state.heroScore} socket={socket}
        />
        <GiftSideEditor
          title={villainLabel || 'VILLANOS'} kind="villain" mode="action"
          list={villains} siblingList={heroes} giftsList={giftsList} cap={BASE_LIST_CAP} score={state.villainScore} socket={socket}
        />
      </div>

      {linkEnabled && (
        <div className="w-full max-w-4xl flex flex-col sm:flex-row gap-4">
          <GiftSideEditor
            title={`${heroLabel || 'HÉROES'} (Extensible)`} kind="ext_hero" mode="seconds"
            list={extHeroes} siblingList={extVillains} giftsList={giftsList} cap={EXT_LIST_CAP} socket={socket}
          />
          <GiftSideEditor
            title={`${villainLabel || 'VILLANOS'} (Extensible)`} kind="ext_villain" mode="seconds"
            list={extVillains} siblingList={extHeroes} giftsList={giftsList} cap={EXT_LIST_CAP} socket={socket}
          />
        </div>
      )}
    </div>
  );
}
