import React, { useState, useCallback, useEffect, useRef } from 'react';
import { COLORS, Die } from './colorsData';
import { rollFair, rollWithPairBias } from './diceBias';
import RewardedAdGate from './RewardedAdGate';
import InterstitialAd from './InterstitialAd';
import AdBanner from './AdBanner';
import NativeAdBanner from './NativeAdBanner';
import { getBankedRemainingMs, addBankedHour, formatBankedDuration } from './adBank';
import { GUEST_BANK_CAP_MS, GUEST_INTERSTITIAL_INTERVAL_MS } from './adConfig';

const MIN_DICE = 1;
const MAX_DICE = 6;
const DEFAULT_DICE = 4;

// Safe Mode: fuerza que `colorIdx` aparezca EXACTAMENTE `targetCount` veces
// entre los N dados. Las demás posiciones se llenan con otros colores al
// azar (nunca colorIdx), así el conteo final queda garantizado.
function rollWithExactCount(n, colorIdx, targetCount) {
  const clamped = Math.max(0, Math.min(n, targetCount));
  const otherColors = COLORS.map((_, i) => i).filter(i => i !== colorIdx);
  const positions = Array.from({ length: n }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const result = new Array(n);
  positions.forEach((pos, idx) => {
    result[pos] = idx < clamped ? colorIdx : otherColors[Math.floor(Math.random() * otherColors.length)];
  });
  return result;
}

// "Asegurar": garantiza que ese color salga EXACTAMENTE 1 vez (nunca 3, ni
// ningún otro conteo — a pedido explícito, un solo camino, no dos).
// "Bloquear": garantiza el camino FÁCIL (0 o el punto de equilibrio N/2).
// Generalizado para N dados.
function rollForSafeMode(n, colorIdx, action) {
  const half = Math.floor(n / 2);
  if (action === 'ensure') {
    return rollWithExactCount(n, colorIdx, 1);
  }
  if (action === 'block') {
    const targetCount = Math.random() < 0.7 ? half : 0;
    return rollWithExactCount(n, colorIdx, targetCount);
  }
  return rollWithPairBias(n);
}

let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick() {
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 200 + Math.random() * 100;
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

function playResultSound() {
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// Interruptor visual compartido para activar/desactivar el WIN BONUS —
// mismas clases que el Toggle de TtsChat.jsx, para mantener un solo
// lenguaje de "interruptor" en toda la app (no se comparte el componente
// en sí porque acá no lleva label/descripción propios, se componen aparte).
function WinBonusToggle({ checked, onChange }) {
  return (
    <label className="cursor-pointer flex-shrink-0">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <span aria-hidden="true" className="w-10 h-6 rounded-full bg-gray-700 peer-checked:theme-accent-bg relative inline-flex transition-colors after:absolute after:w-4 after:h-4 after:rounded-full after:bg-white after:left-1 after:top-1 after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}

const DEFAULT_WIN_BONUS_PCT = 50;

// De acceso libre: funciona sin sesión ni conexión al backend, la lógica de
// tiradas es 100% local. Si hay `socket` (sesión real), sincroniza el
// estado con el overlay especial de Colores (?screen=colors, ver
// DiceOverlay.jsx) — cliente autoritativo, el backend solo reenvía (ver
// tenant.js). Sin socket, el juego funciona igual; simplemente no hay
// overlay escuchando del otro lado.
//
// `tier` (regular/pro/vip/admin — ver dice_tier en la licencia, backend)
// solo define el panel de Modo Seguro (exclusivo de Admin). El WIN BONUS
// dejó de venderse/otorgarse automático por dice_tier (pedido explícito:
// la dinámica debe ser transparente para streamers y espectadores) —
// ahora es una excepción manual por licencia (`winBonusUnlocked`, ver
// dice_win_bonus_unlocked en la licencia/backend), que un admin prende
// desde el panel de Licencias para UN streamer puntual. Admin (dice_tier
// 'admin') sigue teniendo el bonus SIEMPRE, sin depender de ese flag — es
// quien "conserva todas las opciones". Ojo, `tier === 'admin'` es un nivel
// de Color Says que se le puede vender a cualquier licencia paga, NO es lo
// mismo que session.isAdmin (que sigue siendo exclusivo del panel de
// administración de licencias). El selector de cantidad de dados es una
// función disponible para todos.
export default function ColorSays({ tier = 'regular', winBonusUnlocked = false, socket = null, isGuest = false }) {
  const isAdmin = tier === 'admin';
  const hasWinBonus = isAdmin || winBonusUnlocked;
  const [diceCount, setDiceCount]   = useState(DEFAULT_DICE);
  const [diceResult, setDiceResult] = useState(() => Array(DEFAULT_DICE).fill(null));
  const [rolling, setRolling]       = useState(false);
  const [history, setHistory]       = useState([]);
  const tickIntervalRef             = useRef(null);

  // WIN BONUS: quien lo tiene (isAdmin, siempre; o winBonusUnlocked, la
  // excepción manual de un admin para un streamer puntual) elige el % con
  // el slider — ya no hay distinción PRO/VIP de intensidad fija, es todo o
  // nada. Admin arranca con el bonus activado al máximo (100%) para
  // preservar el comportamiento de siempre; una excepción manual arranca apagada.
  const [winBonusEnabled, setWinBonusEnabled] = useState(() => isAdmin);
  const [winBonusPct, setWinBonusPct]         = useState(() => isAdmin ? 100 : DEFAULT_WIN_BONUS_PCT);
  const [winBonusHidden, setWinBonusHidden]   = useState(false);

  // Safe Mode: override manual para un color puntual. 'ensure' fuerza el
  // camino difícil y 'block' fuerza el camino fácil. Solo aplica si es Admin.
  const [safeModeColor, setSafeModeColor]   = useState(null);
  const [safeModeAction, setSafeModeAction] = useState('none'); // 'none' | 'ensure' | 'block'

  // Botón de pánico: por si un día se comparte pantalla completa por error,
  // el panel entero se puede ocultar de un clic. No persiste entre recargas
  // a propósito (arranca visible siempre), así nunca queda "oculto sin
  // querer" en la próxima sesión sin que el dueño se dé cuenta.
  const [safeModeHidden, setSafeModeHidden] = useState(false);

  // Invitado (sin sesión): banco de horas sin ads en localStorage (ver
  // adBank.js). Mientras no haya banco activo, se interrumpe el juego cada
  // GUEST_INTERSTITIAL_INTERVAL_MS con un anuncio; mirar el Smartlink de
  // RewardedAdGate suma 1h al banco, hasta un tope de 48h acumuladas.
  const [bankedRemainingMs, setBankedRemainingMs] = useState(() => (isGuest ? getBankedRemainingMs() : 0));
  const [rewardGateOpen, setRewardGateOpen]       = useState(false);
  const [guestAdOpen, setGuestAdOpen]             = useState(false);
  const bankedActive = isGuest && bankedRemainingMs > 0;

  useEffect(() => {
    if (!isGuest) return;
    const id = setInterval(() => setBankedRemainingMs(getBankedRemainingMs()), 1000);
    return () => clearInterval(id);
  }, [isGuest]);

  // AdSense (Auto ads) se inserta donde Google decide en TODA la página, no
  // solo acá dentro, y el script vive fijo en index.html (lo necesita el
  // rastreador de AdSense para verificar el sitio, ver ese archivo) — por
  // eso <body> arranca CON tkc-ads-suppressed puesto por defecto (oculto en
  // cualquier otra pantalla) y esto solo lo saca mientras el invitado sea
  // elegible, restaurando el default seguro al salir de Color Says.
  useEffect(() => {
    const eligible = isGuest && !bankedActive;
    document.body.classList.toggle('tkc-ads-suppressed', !eligible);
    return () => document.body.classList.add('tkc-ads-suppressed');
  }, [isGuest, bankedActive]);

  useEffect(() => {
    if (!isGuest || bankedActive) return;
    const id = setInterval(() => setGuestAdOpen(true), GUEST_INTERSTITIAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isGuest, bankedActive]);

  const claimBankedHour = () => {
    const newBankedUntil = addBankedHour();
    setBankedRemainingMs(Math.max(0, newBankedUntil - Date.now()));
    setRewardGateOpen(false);
  };

  const stopTicking = useCallback(() => {
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
  }, []);

  useEffect(() => stopTicking, [stopTicking]);

  // Sincroniza el overlay especial de Colores con lo que se ve acá — mismo
  // patrón que update_prize/set_theme (cliente autoritativo, el backend
  // solo reenvía). Sin socket (sin sesión) no hace nada, el juego sigue
  // funcionando igual de forma local.
  useEffect(() => {
    socket?.emit('set_dice_state', { diceCount, diceResult, rolling });
  }, [socket, diceCount, diceResult, rolling]);

  // Cambiar la cantidad de dados resetea el tablero (nunca a mitad de tirada).
  const changeDiceCount = (n) => {
    if (rolling || n === diceCount) return;
    setDiceCount(n);
    setDiceResult(Array(n).fill(null));
  };

  const setSafeAction = (colorIdx, action) => {
    if (safeModeColor === colorIdx && safeModeAction === action) {
      setSafeModeAction('none'); // clic de nuevo sobre lo mismo = desactivar
    } else {
      setSafeModeColor(colorIdx);
      setSafeModeAction(action);
    }
  };

  const finishRoll = useCallback(() => {
    let results;
    if (isAdmin && safeModeAction !== 'none' && safeModeColor !== null) {
      results = rollForSafeMode(diceCount, safeModeColor, safeModeAction);
    } else if (hasWinBonus && winBonusEnabled) {
      results = rollWithPairBias(diceCount, winBonusPct / 100);
    } else {
      results = rollFair(diceCount); // sin el bono (default) o con el bono apagado
    }

    const allSame = diceCount > 1 && results.every(r => r === results[0]);

    if (allSame) {
      setDiceResult(Array(diceCount).fill(null));
      setTimeout(() => doRollInternal(), 1500);
      return;
    }

    stopTicking();
    playResultSound();
    setDiceResult(results);
    setRolling(false);
    setHistory(h => [results, ...h].slice(0, 8));
  }, [stopTicking, safeModeColor, safeModeAction, diceCount, isAdmin, hasWinBonus, winBonusEnabled, winBonusPct]);

  const doRollInternal = useCallback(() => {
    setRolling(true);
    setDiceResult(Array(diceCount).fill(null));
    stopTicking();
    tickIntervalRef.current = setInterval(playTick, 110);

    setTimeout(() => {
      finishRoll();
    }, 1200);
  }, [finishRoll, stopTicking, diceCount]);

  const doRoll = () => {
    if (rolling) return;
    ensureAudioCtx();
    doRollInternal();
  };

  return (
    <div className="flex-1 min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-16 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🎲 Colores</p>

      <div className="flex gap-x-3 gap-y-1 justify-center flex-wrap max-w-sm">
        {COLORS.map((c, i) => (
          <span key={i} className={`text-xs font-bold ${c.textClass}`}>{c.name}</span>
        ))}
      </div>

      {/* Marco temático alrededor de la zona de dados: es justo la parte que
          se recorta/captura en OBS, así que queda contenida en una caja
          propia acorde al tema (vidrio/relieve/línea, según el estilo).
          Va pegado a las etiquetas de color, en la misma posición de
          siempre — el selector de dados NO va acá arriba para no correr
          esta zona de donde ya está calibrado el recorte de captura. */}
      <div className="theme-die-frame flex gap-3 justify-center flex-wrap max-w-md p-2">
        {diceResult.map((ci, d) => <Die key={d} colorIdx={ci} rolling={rolling} />)}
      </div>

      <button onClick={doRoll} disabled={rolling}
        className="theme-btn-primary px-12 py-4 rounded-xl font-black tracking-widest uppercase text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
        {rolling ? 'TIRANDO...' : 'TIRAR DADOS'}
      </button>

      {/* Selector de cantidad de dados: disponible para todas las licencias.
          Va DEBAJO del botón a propósito, para no mover la zona de dados de
          donde esté calibrado el recorte de captura en OBS. */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mr-1">Dados</span>
        {Array.from({ length: MAX_DICE - MIN_DICE + 1 }, (_, i) => MIN_DICE + i).map(n => (
          <button
            key={n}
            onClick={() => changeDiceCount(n)}
            disabled={rolling}
            className={[
              'w-7 h-7 rounded-lg border text-xs font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              diceCount === n ? 'theme-btn-primary border-transparent' : 'theme-input text-gray-400',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Altura fija (no depende de la cantidad de tiradas) para que los
          dados de arriba nunca se muevan al capturar una ventana recortada en OBS.
          También en su propio marco temático, igual que la zona de dados. */}
      <div className="theme-surface flex flex-col gap-1.5 w-full max-w-xs h-72 overflow-y-auto p-3">
        {history.length > 0 ? history.map((roll, i) => (
          <div key={i} className="theme-input flex items-center gap-3 px-3 py-2 flex-shrink-0">
            <span className="text-[10px] text-gray-600 w-4 flex-shrink-0">{history.length - i}</span>
            <div className="flex gap-1.5">
              {roll.map((ci, d) => <span key={d} className="text-lg leading-none">{COLORS[ci].emoji}</span>)}
            </div>
          </div>
        )) : (
          <p className="text-gray-700 text-xs italic text-center mt-2">Sin tiradas todavía...</p>
        )}
      </div>

      {/* Banner fijo debajo del historial: ingreso pasivo constante para el
          invitado sin banco activo, aparte del interstitial de cada 15 min
          (ver useEffect de guestAdOpen más arriba). Zona propia (ver
          AdBanner.jsx/AdIframeBanner.jsx), así que puede seguir mostrado
          mientras el interstitial está abierto sin pisarse — solo se apaga
          en cuanto hay banco activo. */}
      {isGuest && (
        <>
          <AdBanner active={!bankedActive} />
          <NativeAdBanner active={!bankedActive} />
        </>
      )}

      {/* Invitado sin sesión: banco de horas sin ads. En desktop (md:) va en
          el mismo lugar que el panel de WIN BONUS (top-48) — nunca se pisan
          porque un invitado siempre tiene tier 'regular' (sin WIN BONUS ni
          Modo Seguro). En mobile no hay espacio libre a la derecha para
          flotar, así que queda en el flujo normal debajo del resto. */}
      {isGuest && (
        <div className="theme-surface w-full max-w-xs md:fixed md:top-48 md:right-4 md:w-56 p-3">
          <p className="theme-accent-text text-[9px] uppercase tracking-widest font-black mb-1">Modo invitado</p>
          <p className="text-[10px] text-gray-500 leading-snug mb-2">
            {bankedActive
              ? `Sin anuncios por ${formatBankedDuration(bankedRemainingMs)} más.`
              : 'Vas a ver anuncios cada tanto mientras juegas.'}
          </p>
          <button
            onClick={() => setRewardGateOpen(true)}
            disabled={bankedRemainingMs >= GUEST_BANK_CAP_MS}
            className="theme-btn-secondary w-full py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Ver anuncio: +1h sin anuncios
          </button>
        </div>
      )}

      {/* Botones de pánico: líneas casi invisibles pegadas al borde derecho,
          una por panel — a propósito sin ícono, texto ni tooltip, nada que
          delate que ahí hay un control si alguien comparte pantalla
          completa sin querer. WIN BONUS va arriba (top-1/3), Modo Seguro
          abajo (top-1/2), para que nunca se pisen. */}
      {hasWinBonus && (
        <button
          onClick={() => setWinBonusHidden(h => !h)}
          aria-label="Mostrar u ocultar Win Bonus"
          className="fixed right-0 top-1/3 -translate-y-1/2 w-1.5 h-14 rounded-l-full bg-white/5 hover:bg-white/25 transition-colors z-50"
        />
      )}
      {isAdmin && (
        <button
          onClick={() => setSafeModeHidden(h => !h)}
          aria-label="Mostrar u ocultar Modo Seguro"
          className="fixed right-0 top-1/2 -translate-y-1/2 w-1.5 h-14 rounded-l-full bg-white/5 hover:bg-white/25 transition-colors z-50"
        />
      )}

      {/* WIN BONUS: discreto, chico, y ocultable igual que Modo Seguro — va
          arriba de ese panel. Solo visible para Admin o para una excepción
          manual habilitada por un admin (ver winBonusUnlocked). */}
      {hasWinBonus && !winBonusHidden && (
        <div className="theme-surface w-full max-w-xs md:fixed md:top-48 md:right-4 md:w-52 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="theme-accent-text text-[9px] uppercase tracking-widest font-black">Win Bonus</p>
            <WinBonusToggle checked={winBonusEnabled} onChange={setWinBonusEnabled} />
          </div>
          <p className="text-[9px] text-gray-500 leading-snug">Sesgo ajustable a favor de sacar pares.</p>
          {winBonusEnabled && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="theme-label text-[9px] uppercase tracking-widest font-semibold">Intensidad</label>
                <span className="theme-chip font-bold px-1.5 rounded text-[10px]">{winBonusPct}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={winBonusPct} onChange={e => setWinBonusPct(Number(e.target.value))} />
            </div>
          )}
        </div>
      )}

      {/* Modo Seguro: exclusivo del nivel Admin de Color Says (no confundir
          con session.isAdmin, ver comentario arriba del componente). */}
      {isAdmin && !safeModeHidden && (
        <div className="theme-surface w-full max-w-xs md:fixed md:top-80 md:right-4 md:w-60 p-4">
          <p className="theme-accent-text text-[10px] uppercase tracking-widest font-black mb-3">🔒 Modo Seguro</p>

          <div className="flex flex-col gap-1 mb-3 max-h-48 overflow-y-auto">
            {COLORS.map((c, i) => (
              <button key={i} onClick={() => setSafeModeColor(i)}
                className={['flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all',
                  safeModeColor === i ? `${c.bgClass} ${c.borderClass} border` : 'border border-transparent hover:bg-[var(--surface-bg-alt)]'].join(' ')}>
                <span>{c.emoji}</span>
                <span className={`text-xs font-bold ${c.textClass}`}>{c.name}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={() => safeModeColor !== null && setSafeAction(safeModeColor, 'ensure')}
              disabled={safeModeColor === null}
              className={['flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed',
                safeModeColor !== null && safeModeAction === 'ensure' ? 'bg-green-600 text-white' : 'bg-[var(--surface-bg-alt)] border border-green-800/50 text-green-400 hover:bg-green-950/50'].join(' ')}>
              Asegurar
            </button>
            <button onClick={() => safeModeColor !== null && setSafeAction(safeModeColor, 'block')}
              disabled={safeModeColor === null}
              className={['flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed',
                safeModeColor !== null && safeModeAction === 'block' ? 'bg-red-600 text-white' : 'bg-[var(--surface-bg-alt)] border border-red-800/50 text-red-400 hover:bg-red-950/50'].join(' ')}>
              Bloquear
            </button>
          </div>

          <p className="text-[9px] text-gray-500 mt-3 leading-snug">
            {safeModeAction === 'none' && 'Elige un color y una acción. Sin nada activo, tira con sesgo normal.'}
            {safeModeAction === 'ensure' && safeModeColor !== null && <>✅ Asegurando <span className={COLORS[safeModeColor].textClass}>{COLORS[safeModeColor].name}</span>: sale exactamente 1 vez.</>}
            {safeModeAction === 'block' && safeModeColor !== null && <>🔒 Bloqueando <span className={COLORS[safeModeColor].textClass}>{COLORS[safeModeColor].name}</span>: camino fácil.</>}
          </p>
        </div>
      )}

      {isGuest && (
        <>
          <RewardedAdGate
            open={rewardGateOpen}
            onClaim={claimBankedHour}
            onCancel={() => setRewardGateOpen(false)}
            title="Suma 1 hora sin anuncios"
            description="Mira un anuncio corto y juega 1 hora sin interrupciones. Se acumula hasta 48 horas."
          />
          <InterstitialAd
            open={guestAdOpen}
            onDone={() => setGuestAdOpen(false)}
            title="Un mensaje de nuestros sponsors"
          />
        </>
      )}
    </div>
  );
}
