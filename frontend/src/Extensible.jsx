import { HowItWorks, StartRequirement, LiveTag, LiveAppliedNote, ConfirmButton } from './PanelHelp';
import { liveKey, useLiveApplied, useActionLock } from './liveApply';
import { useState, useEffect, useRef } from 'react';
import TimeInput from './TimeInput';
import { formatHHMMSS } from './timeFormat';
import { useEventDraft } from './app/eventSettingsContext';

// Bug real reportado: los campos de "segundos por moneda"/"segundos por
// seguidor" (y el tiempo base) son estado LOCAL del componente — al cambiar
// de pestaña (Ruleta, Eliminación, etc.) y volver, App.jsx desmonta y
// vuelve a montar <Extensible> de cero, así que esos campos volvían a sus
// valores por defecto (5/3/60) aunque el streamer ya los hubiera
// personalizado. Se guardan con los ajustes de los demás eventos (ver
// eventSettingsStore.js): en la cuenta, no solo en este navegador.
const DEFAULTS = { baseTimeSec: 60, secondsPerFollow: 5, secondsPerGift: 3, reverseMode: false };

// ─────────────────────────────────────────────
// MODO EXTENSIBLE
// Cuenta regresiva tipo "subathon": arranca en un tiempo base y cada follow
// o regalo detectado le SUMA segundos (o RESTA, en Modo Inverso — ver
// reverseMode). Los segundos por follow/regalo y el Modo Inverso son
// editables en vivo sin reiniciar el contador; el tiempo base en cambio
// queda BLOQUEADO una vez arrancado (pedido explícito, ver más abajo) — solo
// se aplica al Iniciar/Reiniciar. Para tocar el tiempo mientras corre están
// los botones de ajuste manual (+/- minutos, ver adjustTime).
// Cualquier regalo cuenta (no hay uno específico que elegir), a propósito:
// la idea es premiar cualquier apoyo, no una dinámica de puntería.
// ─────────────────────────────────────────────
export default function Extensible({ state, socket, username, connectionStatus }) {
  const [startError, setStartError] = useState('');
  // Semilla inicial (pedido explícito, ver comentario de DEFAULTS más
  // arriba): arranca de lo último guardado.
  const [draft, saveDraft] = useEventDraft('extensible');
  const saved = { ...DEFAULTS, ...draft };
  const [baseTimeSec, setBaseTimeSec] = useState(saved.baseTimeSec);
  const [secondsPerFollow, setSecondsPerFollow] = useState(saved.secondsPerFollow);
  const [secondsPerGift, setSecondsPerGift] = useState(saved.secondsPerGift);
  const [reverseMode, setReverseMode] = useState(saved.reverseMode);
  const [customAdjustMin, setCustomAdjustMin] = useState(1);

  // Si el panel se monta con el modo YA activo (se remontó a mitad de una
  // corrida — volver de otra pestaña, o F5 — bug real reportado), los campos
  // tienen que terminar reflejando los valores REALES del servidor, no lo
  // guardado/por defecto. Esto NO se puede resolver en los useState de
  // arriba: al montar, `state` todavía trae el valor inicial de App.jsx
  // (isActive: false) hasta que el socket manda el primer snapshot real, así
  // que leer `state.isActive` ahí siempre ve "false" aunque en verdad ya
  // haya una corrida activa. Este efecto se dispara UNA sola vez, recién
  // cuando `state.isActive` confirma que sí la hay, y nunca más — no debe
  // pisar ediciones manuales posteriores del streamer.
  const syncedFromLiveRef = useRef(false);
  useEffect(() => {
    if (syncedFromLiveRef.current || !state.isActive) return;
    syncedFromLiveRef.current = true;
    setSecondsPerFollow(state.secondsPerFollow ?? saved.secondsPerFollow);
    setSecondsPerGift(state.secondsPerGift ?? saved.secondsPerGift);
    setReverseMode(!!state.reverseMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isActive]);

  // Persiste cualquier cambio para que sobreviva a cambiar de pestaña (o
  // recargar la página) sin perder la configuración personalizada.
  useEffect(() => {
    saveDraft({ baseTimeSec, secondsPerFollow, secondsPerGift, reverseMode });
  }, [baseTimeSec, secondsPerFollow, secondsPerGift, reverseMode, saveDraft]);

  const buildConfig = () => ({
    tiktokUsername: username,
    baseTime: Math.max(1, Math.round(baseTimeSec)),
    secondsPerFollow: Math.max(0, Math.round(secondsPerFollow)),
    secondsPerGift: Math.max(0, Math.round(secondsPerGift)),
    reverseMode,
  });

  const startExtensible = () => {
    setStartError('');
    if (connectionStatus !== 'connected') return setStartError('Espera a que se confirme la conexión en vivo con TikTok antes de iniciar.');
    socket.emit('start_extensible', buildConfig());
  };

  // Confirmación de los cambios en vivo y protección de los botones (ver
  // liveApply.js). Con el contador corriendo hay progreso que perder.
  const appliedPhase = useLiveApplied({
    active: state.isActive,
    localKey: liveKey([Math.max(0, Math.round(secondsPerFollow)), Math.max(0, Math.round(secondsPerGift)), !!reverseMode]),
    serverKey: liveKey([state.secondsPerFollow, state.secondsPerGift, !!state.reverseMode]),
  });
  const [actionLocked, runLocked] = useActionLock(`${state.isActive}:${!!state.finished}`);
  const hasProgress = state.isActive && !state.finished;

  const stopExtensible = () => socket.emit('stop_extensible');
  const restartExtensible = () => socket.emit('restart_extensible', buildConfig());
  const togglePause = () => socket.emit(state.paused ? 'resume_extensible' : 'pause_extensible');

  // Suma/resta tiempo a mano mientras el contador está activo (pedido
  // explícito) — reemplaza la antigua edición en vivo del tiempo base, que
  // ahora queda bloqueada (ver TimeInput más abajo). Puede incluso "revivir"
  // una cuenta que ya llegó a 0 (ver adjust_extensible_time en tenant.js).
  const adjustTime = (deltaSeconds) => socket.emit('adjust_extensible_time', { deltaSeconds });

  // Segundos por follow/regalo y Modo Inverso se reflejan en vivo sin cortar
  // el contador que ya está corriendo — mismo patrón que Ruleta/Eliminación,
  // pero acá SIEMPRE que está activo (no hay una fase "de espera" propia: el
  // contador corre todo el tiempo). El tiempo base YA NO viaja en vivo por
  // acá (pedido explícito, revisado): no corta el contador que ya corre. Se
  // puede editar igual con el contador activo (antes el campo quedaba
  // bloqueado y no había forma de dejar listo el próximo Reiniciar): la
  // etiqueta "Al reiniciar" dice cuándo se usa.
  // El guard de "recién montado" (isMounted) es crítico acá: sin él, cada vez
  // que el streamer cambia de pestaña y vuelve, este efecto corre de nuevo
  // con los valores LOCALES por defecto (secondsPerFollow 5, etc.) y los
  // manda de una, pisando en vivo un contador que ya estaba corriendo con
  // otros valores — esto rompía tener Extensible corriendo en simultáneo con
  // otro modo, con solo pasar por esta pestaña sin tocar nada.
  const isMounted = useRef(false);
  const justActivated = useRef(state.isActive);
  useEffect(() => {
    const activeJustChanged = justActivated.current !== state.isActive;
    justActivated.current = state.isActive;
    if (!isMounted.current) { isMounted.current = true; return; }
    if (activeJustChanged) return;
    if (state.isActive) socket.emit('update_extensible_settings', buildConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsPerFollow, secondsPerGift, reverseMode, state.isActive]);


  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 font-sans flex-1">

      {/* Preview */}
      <div className="theme-surface-featured w-full max-w-md p-5 mb-6 relative overflow-hidden">
        {state.finished && <div className="absolute inset-0 bg-yellow-500/20 animate-pulse" />}

        <div className="flex justify-between items-center relative z-10 mb-3">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">MODO EXTENSIBLE</p>
        </div>

        <p className={`relative z-10 text-center text-6xl font-black tabular-nums ${state.finished ? 'text-yellow-300' : state.paused ? 'text-gray-500' : 'text-white'}`}>
          {formatHHMMSS(state.timeLeft)}
        </p>
        {state.finished && (
          <p className="relative z-10 text-center text-xs font-black text-yellow-300 mt-2 uppercase tracking-widest">TIEMPO AGOTADO</p>
        )}
        {state.isActive && state.paused && !state.finished && (
          <p className="relative z-10 text-center text-xs font-black text-gray-400 mt-2 uppercase tracking-widest">PAUSADO</p>
        )}
        {!state.isActive && !state.finished && (
          <p className="text-gray-600 text-sm italic font-medium relative z-10 text-center mt-2">Todavía no arrancó...</p>
        )}
      </div>

      {/* Settings */}
      <div className="theme-surface w-full max-w-md p-8 relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">AJUSTES</h1>
        </div>

        <HowItWorks storageKey="extensible">
        <p>Un contador que arranca con un <span className="font-bold text-white">tiempo base</span>. Cada nuevo seguidor y cada regalo le <span className="font-bold text-white">suma segundos</span> (o se los resta en Modo Inverso).</p>
        <p>Puedes ajustar el tiempo a mano mientras corre y pausarlo cuando quieras.</p>
        </HowItWorks>

        <div className="space-y-5">
          <div>

            {/* Tiempo base */}
            <div className="mb-4">
              <label className="theme-label text-[10px] uppercase tracking-widest font-semibold block mb-1">
                TIEMPO BASE<LiveTag active={state.isActive} when="restart" title="No cambia el contador que está corriendo: para eso están los botones de ajustar tiempo" />
              </label>
              <TimeInput seconds={baseTimeSec} onChange={setBaseTimeSec} maxSeconds={7200} />
              <p className="text-[10px] text-gray-500 mt-1">Con cuánto tiempo arranca el contador al iniciar o reiniciar. Para cambiar el tiempo que corre ahora, usa los botones de abajo.</p>
            </div>

            {/* Ajuste manual de tiempo en vivo */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">AJUSTAR TIEMPO EN VIVO</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <button type="button" onClick={() => adjustTime(-300)} disabled={!state.isActive}
                  className="theme-btn-danger theme-btn-md font-bold disabled:opacity-40 disabled:cursor-not-allowed">-5m</button>
                <button type="button" onClick={() => adjustTime(-60)} disabled={!state.isActive}
                  className="theme-btn-danger theme-btn-md font-bold disabled:opacity-40 disabled:cursor-not-allowed">-1m</button>
                <button type="button" onClick={() => adjustTime(60)} disabled={!state.isActive}
                  className="theme-btn-primary theme-btn-md font-bold disabled:opacity-40 disabled:cursor-not-allowed">+1m</button>
                <button type="button" onClick={() => adjustTime(300)} disabled={!state.isActive}
                  className="theme-btn-primary theme-btn-md font-bold disabled:opacity-40 disabled:cursor-not-allowed">+5m</button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number" min="0" step="1" value={customAdjustMin}
                  onChange={e => setCustomAdjustMin(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="minutos"
                  className="theme-input flex-1 p-2 text-sm text-center outline-none"
                />
                <button type="button" onClick={() => adjustTime(Math.round(customAdjustMin * 60))}
                  disabled={!state.isActive || !customAdjustMin}
                  className="theme-btn-secondary theme-btn-sm font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed">Sumar</button>
                <button type="button" onClick={() => adjustTime(-Math.round(customAdjustMin * 60))}
                  disabled={!state.isActive || !customAdjustMin}
                  className="theme-btn-secondary theme-btn-sm font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed">Restar</button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Se refleja al instante en el overlay y en el panel, sin reiniciar el contador. Solo funciona con el modo activo.</p>
            </div>

            {/* Segundos por follow */}
            <div className="mb-4">
              <label htmlFor="ext-per-follow" className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">SEGUNDOS POR FOLLOW<LiveTag active={state.isActive} title="Los seguidores nuevos suman con el valor nuevo" /></label>
              <input id="ext-per-follow"
                type="number" min="0"
                value={secondsPerFollow}
                onChange={e => setSecondsPerFollow(Math.max(0, Number(e.target.value) || 0))}
                className="theme-input w-full p-3 text-sm outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">Cada nuevo seguidor le {reverseMode ? 'resta' : 'suma'} esto al contador.</p>
            </div>

            {/* Segundos por regalo */}
            <div className="mb-4">
              <label htmlFor="ext-per-gift" className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-semibold">SEGUNDOS POR MONEDA DEL REGALO<LiveTag active={state.isActive} title="Los regalos que lleguen desde ahora suman con el valor nuevo" /></label>
              <input id="ext-per-gift"
                type="number" min="0"
                value={secondsPerGift}
                onChange={e => setSecondsPerGift(Math.max(0, Number(e.target.value) || 0))}
                className="theme-input w-full p-3 text-sm outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">Cualquier regalo cuenta, multiplicado por su valor en monedas (ej: con 3 acá, un regalo de 50 monedas suma 150s).</p>
            </div>

            {/* Modo Inverso */}
            <div className="mb-6">
              <button type="button" onClick={() => setReverseMode(r => !r)} aria-pressed={!!reverseMode}
                className={`w-full font-black uppercase tracking-wide transition-all theme-btn-md ${reverseMode ? 'theme-btn-danger' : 'theme-btn-secondary'}`}
                title="Cada follow o regalo RESTA tiempo en vez de sumar">
                {reverseMode ? 'Modo Inverso (RESTA tiempo)' : 'Modo Normal (SUMA tiempo)'}
              </button>
              <p className="text-[10px] text-gray-500 mt-1">Se puede cambiar en cualquier momento, incluso con el contador activo.</p>
            </div>
            <LiveAppliedNote phase={appliedPhase} />

            <StartRequirement connectionStatus={connectionStatus} active={state.isActive} error={startError} />

            {/* Botones */}
            <div className="flex gap-4">
              {!state.isActive ? (
                <button
                  onClick={() => runLocked(startExtensible)}
                  disabled={connectionStatus !== 'connected' || actionLocked}
                  className="theme-btn-primary theme-btn-lg flex-1 font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'CONECTANDO...' : 'INICIAR'}
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePause}
                    disabled={state.finished}
                    className="theme-btn-secondary theme-btn-lg flex-1 font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {state.paused ? 'REANUDAR' : 'PAUSAR'}
                  </button>
                  <ConfirmButton
                    needsConfirm={hasProgress}
                    onConfirm={() => runLocked(restartExtensible)}
                    disabled={actionLocked}
                    className="theme-btn-warning theme-btn-lg flex-1 font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    REINICIAR ⟲
                  </ConfirmButton>
                </>
              )}
              <ConfirmButton
                needsConfirm={hasProgress}
                onConfirm={stopExtensible}
                className="theme-btn-danger theme-btn-lg font-bold transition-all"
              >
                DETENER
              </ConfirmButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
