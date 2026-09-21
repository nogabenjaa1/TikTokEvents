import { useEffect, useRef, useState } from 'react';
import { alertTiming, createAlertQueue } from '../alertQueue';
import { preloadAlertMedia, stopMedia } from '../alertMedia';
import { createTicker } from '../ticker';
import { routeToSink } from '../alertMonitor';
import { overlayAudioAllowed } from '../overlayAudio';
import { FONT_SCALES, getUsernameOverride } from '../overlayCustomization';

// Dónde se planta la alerta dentro de la pantalla completa del overlay —
// mapea la `position` guardada en cada alerta (ver AlertsAdmin.jsx) a las
// clases de alineación de un contenedor `fixed inset-0`.
const ALERT_POSITION_CLASSES = {
  center: 'items-center justify-center',
  top: 'items-start justify-center pt-10',
  bottom: 'items-end justify-center pb-10',
  left: 'items-center justify-start pl-10',
  right: 'items-center justify-end pr-10',
};

// Contenido visual de una alerta — separado de AlertOverlay para poder
// reusarlo TAL CUAL en la Vista previa del panel de administración (ver
// AlertsAdmin.jsx) sin depender de un socket real ni de esperar a que un
// espectador mande el regalo. `alert.count` (> 1 cuando el backend agrupó
// un combo nativo de TikTok, ver handleGiftEvent en
// tenant.js) se muestra como "×N" para dejar claro que fue un combo y no
// una alerta más apilada.
// OJO posición: NO se puede usar `fixed inset-0` directo acá — `.themed-app
// > * { position: relative }` (ver index.css) pisa el `position: fixed` de
// cualquier hijo directo con la MISMA especificidad y sin !important de
// ningún lado, así que ganaba por orden de declaración: la alerta quedaba
// con `position: relative` de verdad (no fixed), por eso "Centro" se veía
// arriba — sin un contenedor de tamaño de pantalla completa, "centrado"
// solo centraba dentro de una caja del alto de la imagen, insertada al
// principio del flujo normal. `.tkc-alert-viewport` (index.css) fuerza
// `position: fixed` con !important para ganar esa pelea.
// `phase`: 'entering' | 'visible' | 'exiting' — decide qué animación de
// index.css (`.tkc-alert-anim-in-*`/`.tkc-alert-anim-out-*`) aplicar según
// `alert.entranceAnim`/`alert.exitAnim` ('none' = sin animación, aparece/
// desaparece de golpe). Quien coordina CUÁNDO cambia de fase es el caller
// (AlertOverlay para la alerta real; AlertsAdmin.jsx para la vista
// previa en vivo del panel) — este componente es puramente presentacional.
// `embedded`: la vista previa del panel la usa dentro de una cajita chica
// en vez de la pantalla completa real — ver `.tkc-alert-embedded` en
// index.css.
// `customize`: la personalización global del overlay 'alerts' (ver
// overlayCustomization.js) — SOLO se usa `usernameColor` (color/degradado/
// arcoíris/tamaño) para el texto opcional; `background` no aplica acá
// porque una alerta nunca tiene fondo propio (ver OverlayCustomizePanel.jsx,
// que por eso oculta esa sección para este overlay).
export function AlertVisual({ alert, phase = 'visible', embedded = false, customize, previewMuted = false, silent = false }) {
  // Volumen general (pedido explícito, ver OverlayCustomizePanel.jsx) --
  // `volume` de HTMLMediaElement es una propiedad JS, no un atributo HTML,
  // así que no alcanza con pasarlo como prop de JSX -- se aplica a mano vía
  // ref cada vez que cambia el volumen configurado O el recurso (nuevo
  // src, nuevo <audio>/<video> que reproducir).
  const audioElRef = useRef(null);
  const videoElRef = useRef(null);
  useEffect(() => {
    const vol = Math.max(0, Math.min(1, customize?.volume ?? 1));
    if (audioElRef.current) audioElRef.current.volume = vol;
    if (videoElRef.current) videoElRef.current.volume = vol;
  }, [customize?.volume, alert?.audioUrl, alert?.visualUrl]);
  // La duración de la alerta manda sobre el recurso: si el audio o el video
  // duran más, se cortan cuando la alerta cumple su tiempo (los elementos se
  // leen al disparar, no antes: para entonces el elemento pudo haber cambiado o
  // desaparecido). Es un temporizador y no la limpieza de un efecto a propósito:
  // el modo estricto de React simula desmontajes de efectos y de refs, y cortar
  // ahí dejaría el audio sin fuente en desarrollo. Al quitar la alerta de la
  // página el navegador ya pausa el elemento; esto cubre el resto.
  const alertDurationMs = alert ? alertTiming(alert).duration : 0;
  useEffect(() => {
    if (!alert) return undefined;
    const timer = setTimeout(() => { stopMedia(audioElRef.current); stopMedia(videoElRef.current); }, alertDurationMs);
    return () => clearTimeout(timer);
  }, [alert, alertDurationMs]);

  if (!alert) return null;
  // Las animaciones de entrada y salida se adaptan a la duración de la alerta
  // (una corta las acorta) para que quepan las dos y no se pierdan.
  const { animation: animationMs } = alertTiming(alert);
  const positionClass = ALERT_POSITION_CLASSES[alert.position] || ALERT_POSITION_CLASSES.center;
  const preset = phase === 'exiting' ? (alert.exitAnim || 'none') : (alert.entranceAnim || 'none');
  const animClass = phase !== 'visible' && preset !== 'none' ? `tkc-alert-anim-${phase === 'exiting' ? 'out' : 'in'}-${preset}` : '';

  // Visual (imagen/gif/video, con mute opcional en video) y audio son dos
  // recursos INDEPENDIENTES (pedido explícito) -- un video puede sonar solo
  // con su propio audio, quedar mudo con un audio aparte sonando encima, o
  // no tener audio para nada; ninguna combinación excluye a las otras.
  const hasVisual = !!(alert.visualType && alert.visualUrl);
  const hasText = !!(alert.text && alert.text.trim());
  // Color: el propio de ESTA alerta (alert.textColor) gana sobre el estilo
  // general; si no tiene, se usa el de "Estilo y volumen". El tamaño se aplica
  // como font-size real (no transform) para que el texto ocupe su espacio y
  // nunca se encime con el recurso: si es más grande o más largo, simplemente
  // usa más renglones y todo se acomoda (gap fijo entre texto y recurso).
  const textOverride = alert.textColor
    ? { className: 'tkc-username-custom', cssVars: { '--tkc-username-color': alert.textColor } }
    : getUsernameOverride(customize, { scale: false });
  const textScale = FONT_SCALES[customize?.usernameColor?.fontSize] ?? 1;
  const beside = hasText && alert.textPosition === 'beside' && !!(alert.visualType && alert.visualUrl);
  const textNode = hasText ? (
    <p
      className={`font-black text-center drop-shadow-lg leading-tight break-words whitespace-pre-wrap ${beside ? 'max-w-[420px]' : 'max-w-[860px]'} ${textOverride.className}`}
      style={{ ...textOverride.cssVars, fontSize: `${Math.round(30 * textScale)}px`, textWrap: 'balance' }}
    >
      {alert.text}
    </p>
  ) : null;
  const visualNode = hasVisual ? (
    <>
      {(alert.visualType === 'image' || alert.visualType === 'gif') && (
        <img src={alert.visualUrl} className="max-w-[600px] max-h-[600px] object-contain flex-shrink-0" />
      )}
      {alert.visualType === 'video' && (
        <video ref={videoElRef} src={alert.visualUrl} className="max-w-[720px] max-h-[720px] object-contain flex-shrink-0" autoPlay muted={!!alert.visualMuted || previewMuted || silent} />
      )}
    </>
  ) : null;
  // Sin visual (alerta solo de texto y/o solo de audio), la posición del
  // texto respecto al recurso no tiene sentido -- se muestra solo, centrado.
  const layoutClass = !hasVisual ? '' : alert.textPosition === 'beside' ? 'flex-row items-center gap-6' : 'flex-col items-center gap-4';

  return (
    <div className={`tkc-alert-viewport ${embedded ? 'tkc-alert-embedded' : ''} flex pointer-events-none ${positionClass}`}>
      <div className={`relative flex ${layoutClass} ${animClass}`} style={{ '--tkc-anim-ms': `${animationMs}ms` }}>
        {hasVisual && alert.textPosition === 'above' && textNode}
        {visualNode}
        {(!hasVisual || alert.textPosition !== 'above') && textNode}
        {alert.audioUrl && !silent && <audio ref={audioElRef} src={alert.audioUrl} autoPlay muted={previewMuted} />}
        {alert.count > 1 && (
          <span className="absolute -top-3 -right-3 bg-yellow-400 text-black text-lg font-black px-3 py-1 rounded-full shadow-lg">
            ×{alert.count}
          </span>
        )}
      </div>
    </div>
  );
}

// Overlay y sonido del panel comparten el mismo ciclo FIFO y duración.
function useAlertPlayback(socket, { silent = false } = {}) {
  const [playback, setPlayback] = useState({ alert: null, phase: 'visible' });
  useEffect(() => {
    setPlayback({ alert: null, phase: 'visible' });
    const queue = createAlertQueue((alert, phase) => setPlayback({ alert, phase }));
    // Un overlay silencioso no descarga el audio que no va a reproducir.
    const onTrigger = (alert) => { preloadAlertMedia(silent ? { ...alert, audioUrl: null } : alert); queue.enqueue(alert); };
    // La cola avanza por el reloj real; estos avisos la despiertan aunque el
    // navegador de OBS / TikTok Studio haya frenado los temporizadores de una
    // fuente que no se está pintando (ver alertQueue.js y ticker.js).
    const wake = () => queue.tick();
    socket?.on('alert_triggered', onTrigger);
    socket?.on('connect', wake);
    const stopTicker = createTicker(wake, 250);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      socket?.off('alert_triggered', onTrigger);
      socket?.off('connect', wake);
      stopTicker();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
      queue.dispose();
    };
  }, [socket, silent]);
  return playback;
}

export function AlertOverlay({ socket, customize }) {
  // Solo visual: el sonido de la alerta y de su video lo reproduce el panel
  // (ver overlayAudio.js); con &audio=1 en la URL este overlay sí suena.
  const silent = !overlayAudioAllowed();
  const { alert, phase } = useAlertPlayback(socket, { silent });
  return <AlertVisual key={alert?.playbackId || 'idle'} alert={alert} phase={phase} customize={customize} silent={silent} />;
}

function QueuedAlertSound({ alert, customize, sinkId }) {
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  useEffect(() => {
    const volume = Math.max(0, Math.min(1, customize?.volume ?? 1));
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [customize?.volume]);
  // Salida elegida por el streamer (p. ej. sus audífonos) para que no entre al directo.
  useEffect(() => {
    routeToSink(audioRef.current, sinkId);
    routeToSink(videoRef.current, sinkId);
  }, [sinkId, alert]);
  // Al cumplirse la duración de la alerta, el sonido también se corta (ver AlertVisual).
  useEffect(() => {
    const timer = setTimeout(() => { stopMedia(audioRef.current); stopMedia(videoRef.current); }, alertTiming(alert).duration);
    return () => clearTimeout(timer);
  }, [alert]);
  return (
    <div style={{ display: 'none' }}>
      {alert.audioUrl && <audio ref={audioRef} src={alert.audioUrl} autoPlay />}
      {alert.visualType === 'video' && alert.visualUrl && !alert.visualMuted && <video ref={videoRef} src={alert.visualUrl} autoPlay />}
    </div>
  );
}

export function AlertSoundListener({ socket, customize, sinkId }) {
  const { alert } = useAlertPlayback(socket);
  return alert ? <QueuedAlertSound key={alert.playbackId} alert={alert} customize={customize} sinkId={sinkId} /> : null;
}
