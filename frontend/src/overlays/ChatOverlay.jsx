import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getUsernameOverride, resolveBackgroundStyle, overlayRootProps, labelProps, rowBorder } from '../overlayCustomization';
import { CHAT_DEFAULT_SETTINGS, CHAT_FADE_OUT_MS as FADE_OUT_MS, chatBadgeIcons, visibleChatItems } from '../chatOverlayModel';

// CHAT EN VIVO (pestaña Chat de Eventos). Pedido explícito: que se vea y se
// comporte como el chat de Social Stream Ninja -- lo más nuevo ARRIBA y lo
// anterior va bajando, cada mensaje se desvanece después de un tiempo, la
// letra conserva su tamaño (nada de deslizar para ver lo nuevo), insignias
// junto al nombre y los eventos (seguidores, regalos, compartidos) dentro del
// mismo chat, más el mensaje anclado arriba. Diseño propio: no se copia nada
// del código de Social Stream Ninja (es GPL-3.0).
//
// Los datos llegan por su propia sala del socket (ver
// backend/lib/tenant/chatOverlay.js): `chat_snapshot` (lo reciente, el
// anclado y los ajustes), `chat_item`, `chat_pinned` y
// `chat_settings_update`. Los ajustes se editan en Eventos > Chat; el
// fondo, el color de los nombres y la fuente, en Overlays > Personalizar.

function HeartIcon() {
  return <svg viewBox="0 0 24 24" className="w-[1.1em] h-[1.1em] flex-shrink-0" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z" /></svg>;
}
function ShareIcon() {
  return <svg viewBox="0 0 24 24" className="w-[1.1em] h-[1.1em] flex-shrink-0" fill="currentColor" aria-hidden="true"><path d="M14 4l7 7-7 7v-4c-5 0-8.5 1.6-11 5 1-5 4-10 11-11V4z" /></svg>;
}
function PinIcon() {
  return <svg viewBox="0 0 24 24" className="w-[1em] h-[1em] flex-shrink-0" fill="currentColor" aria-hidden="true"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-5-5 5-1-1 5-5-5-4 2-2 5 1 4-4 1-3z" /></svg>;
}

// Insignias como íconos (pedido explícito: nada de etiquetas de texto como
// "MOD" o "Fan 12", que alargaban cada mensaje). Qué se muestra y en qué
// orden lo decide chatBadgeIcons (chatOverlayModel.js) con lo que manda
// TikTok; aquí solo se dibuja. Miden lo mismo que la letra y van con su
// color de siempre (fijo, no el del tema: así se reconocen de un vistazo).
// Solo el de miembro lleva número: su nivel.
const BADGE_PATHS = {
  // Escudo con palomita.
  moderator: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3zm-1.2 13.6l5.6-5.6-1.4-1.4-4.2 4.2-2-2-1.4 1.4 3.4 3.4z',
  // Corazón (club de fans).
  member: 'M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z',
  // Corona.
  topGifter: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5v-2z',
  // Diamante (donador).
  gifter: 'M7 3h10l4 6-9 12L3 9l4-6zm1.2 2L6 8.3h3.3L10.6 5H8.2zm5.2 0l1.3 3.3H18L15.8 5h-2.4zM6.4 10.3l4.4 6V10.3H6.4zm6.8 0v6l4.4-6h-4.4z',
  // Estrella (suscriptor).
  subscriber: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9L12 2.5z',
};
const BADGE_COLORS = { moderator: '#34d399', member: '#fb7185', gifter: '#38bdf8', subscriber: '#e879f9' };
const TOP_GIFTER_COLORS = { 1: '#facc15', 2: '#d1d5db', 3: '#d97706' };

function BadgeIcon({ icon }) {
  if (icon.kind === 'image') {
    return <img alt={icon.label} title={icon.label} src={icon.url} className="h-[1.05em] w-auto max-w-[2.6em] object-contain flex-shrink-0" />;
  }
  const color = icon.kind === 'topGifter' ? TOP_GIFTER_COLORS[icon.rank] || TOP_GIFTER_COLORS[3] : BADGE_COLORS[icon.kind];
  return (
    <span role="img" aria-label={icon.label} title={icon.label} className="inline-flex items-center gap-[0.08em] flex-shrink-0 leading-none" style={{ color }}>
      <svg viewBox="0 0 24 24" className="w-[1.05em] h-[1.05em]" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d={BADGE_PATHS[icon.kind]} /></svg>
      {icon.kind === 'member' && <span className="text-[0.72em] font-black tabular-nums" aria-hidden="true">{icon.level}</span>}
    </span>
  );
}

function Badges({ badges }) {
  const icons = chatBadgeIcons(badges);
  if (!icons.length) return null;
  return icons.map((icon, i) => <BadgeIcon key={`${icon.kind}-${icon.url || i}`} icon={icon} />);
}

function Avatar({ user, show }) {
  if (!show) return null;
  // Del alto de una línea de texto (ver CHAT_LINE): la foto, las insignias,
  // el nombre y el comienzo del mensaje quedan en la misma línea.
  return user?.avatar
    ? <img alt="" src={user.avatar} className="w-[1.5em] h-[1.5em] rounded-full object-cover flex-shrink-0" />
    : <span className="tkc-ovl-fill w-[1.5em] h-[1.5em] rounded-full bg-gray-700 flex-shrink-0" />;
}

// El texto del mensaje con sus emotes en su lugar, como el chat de TikTok
// (`parts` lo arma el servidor, ver commentParts en backend/lib/chatOverlay.js).
// Un emote mandado solo es un mensaje de solo emote.
function MessageParts({ item }) {
  const emote = (url, key) => <img key={key} alt="" src={url} className="inline-block h-[1.5em] w-auto align-middle mx-[0.1em]" />;
  if (Array.isArray(item.parts) && item.parts.length > 0) {
    return item.parts.map((part, i) => (part.type === 'emote' ? emote(part.url, i) : <span key={i}>{part.value}</span>));
  }
  return <>{item.text}{item.emotes?.map((url, i) => emote(url, `e${i}`))}</>;
}

// Una fila, en una sola línea de lectura (pedido explícito, para leerse en
// OBS vertical sin abrir la vista previa):
//   [foto] [insignias] [nombre]: [mensaje]
// La foto, las insignias y el nombre van juntos y nunca se parten. Si caben
// en menos de HEAD_MAX del ancho (lo normal), el mensaje va al lado y sigue
// en las líneas de abajo alineado con su propio comienzo. Si no caben (un
// nombre larguísimo o muchas insignias), la fila pasa a texto corrido: el
// mensaje sigue igual justo después de "Nombre:" y baja de línea a todo el
// ancho. Nunca se corta ni se esconde nada. Antes el nombre iba en una línea
// y el mensaje en otra, debajo: el doble de alto.
// Todo mide en `em`, así crece con el tamaño de letra elegido.
const CHAT_LINE = 'leading-[1.5]';
const HEAD_MAX = 0.42;

function HeadParts({ user, settings, nameStyle }) {
  return (
    <>
      <Avatar user={user} show={settings.showAvatars !== false} />
      {settings.showBadges !== false && <Badges badges={user?.badges} />}
      <span className={`font-black ${nameStyle.className}`} style={nameStyle.style}>{user?.nickname || user?.uniqueId}:</span>
    </>
  );
}

function ChatLine({ user, settings, nameStyle, children }) {
  const lineRef = useRef(null);
  const headRef = useRef(null);
  const [flowing, setFlowing] = useState(false);
  const [measure, setMeasure] = useState(0);
  // Se mide con la cabecera en una sola línea; si ocupa demasiado, texto
  // corrido. Si cambia el ancho (otra fuente de OBS, otra vista previa) o la
  // letra, se vuelve a medir desde el principio.
  useLayoutEffect(() => {
    if (flowing) return;
    const line = lineRef.current;
    const head = headRef.current;
    if (line && head && head.scrollWidth > line.clientWidth * HEAD_MAX) setFlowing(true);
  }, [flowing, measure, settings.fontSize]);
  useEffect(() => {
    const line = lineRef.current;
    if (!line || typeof ResizeObserver === 'undefined') return undefined;
    let width = line.clientWidth;
    const ro = new ResizeObserver(() => {
      if (line.clientWidth === width) return;
      width = line.clientWidth;
      setFlowing(false);
      setMeasure((n) => n + 1);
    });
    ro.observe(line);
    return () => ro.disconnect();
  }, []);

  if (flowing) {
    return (
      <div ref={lineRef} className="min-w-0 break-words [overflow-wrap:anywhere]">
        <span ref={headRef} className="tkc-chat-head-inline">
          <HeadParts user={user} settings={settings} nameStyle={nameStyle} />
        </span>{' '}
        <span className="tkc-chat-text">{children}</span>
      </div>
    );
  }
  return (
    <div ref={lineRef} className="flex items-start gap-[0.4em] min-w-0">
      <span ref={headRef} className="flex items-center gap-x-[0.3em] whitespace-nowrap flex-shrink-0">
        <HeadParts user={user} settings={settings} nameStyle={nameStyle} />
      </span>
      <span className="tkc-chat-text min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function ChatRow({ item, settings, now, rowBg, nameStyle, animClass, bubbleClass, rowBorderStyle }) {
  const [fadeDelayMs] = useState(() => {
    const fadeMs = (settings.fadeSeconds || 0) * 1000;
    return fadeMs > 0 ? Math.max(0, fadeMs - (now - (item.at || now))) : null;
  });
  const fadeStyle = fadeDelayMs === null ? {} : { animation: `tkc-chat-out ${FADE_OUT_MS}ms ease-in ${fadeDelayMs}ms forwards` };

  let message;
  let accent = null;
  if (item.kind === 'follow') {
    accent = 'var(--accent)';
    message = <><span className="theme-accent-text inline-block align-[-0.15em] mr-[0.25em]"><HeartIcon /></span><span className="tkc-chat-muted">te siguió</span></>;
  } else if (item.kind === 'share') {
    accent = '#38bdf8';
    message = <><span className="text-sky-400 inline-block align-[-0.15em] mr-[0.25em]"><ShareIcon /></span><span className="tkc-chat-muted">compartió el LIVE</span></>;
  } else if (item.kind === 'gift') {
    accent = '#f59e0b';
    message = (
      <>
        envió <span className="font-black text-amber-300">{item.gift?.name || 'un regalo'}</span>
        {item.gift?.icon && <img alt="" src={item.gift.icon} className="inline-block w-[1.4em] h-[1.4em] object-contain align-middle mx-[0.15em]" />}
        {item.gift?.count > 1 && <span className="font-black text-amber-300"> ×{item.gift.count}</span>}
      </>
    );
  } else {
    message = <MessageParts item={item} />;
  }

  return (
    <div data-chat-row={item.id} style={fadeStyle} className="flex-shrink-0">
      <div
        className={`${animClass} ${bubbleClass} ${CHAT_LINE} rounded-2xl pl-[0.6em] pr-[0.6em] py-[0.4em]`}
        style={{ ...rowBg, border: rowBorderStyle, ...(accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : {}) }}
      >
        <ChatLine user={item.user} settings={settings} nameStyle={nameStyle}>{message}</ChatLine>
      </div>
    </div>
  );
}

function PinnedBanner({ pinned, settings, rowBg, nameStyle, bubbleClass, rowBorderStyle }) {
  if (!pinned || settings.showPinned === false) return null;
  return (
    <div className={`${bubbleClass} ${CHAT_LINE} flex-shrink-0 rounded-2xl pl-[0.6em] pr-[0.6em] py-[0.4em]`} style={{ ...rowBg, border: rowBorderStyle, boxShadow: 'inset 3px 0 0 var(--accent)' }}>
      <span className="flex items-center gap-[0.35em] text-[0.7em] font-black uppercase tracking-widest theme-accent-text"><PinIcon />Anclado</span>
      <ChatLine user={pinned.user} settings={settings} nameStyle={nameStyle}>{pinned.text}</ChatLine>
    </div>
  );
}

const MOVE_MS = 350;
const MOVE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

// La lista de mensajes, sin barra de desplazamiento (pedido explícito):
// - Orden normal (como TikTok): el primero arriba y cada nuevo debajo. Si ya
//   no caben, la lista entera se desliza hacia arriba para que el último se
//   vea completo; lo más viejo sale por arriba.
// - "Lo nuevo arriba": lo que no cabe completo abajo no se muestra a medias.
// Cuando un mensaje se va (se desvaneció) o llega uno nuevo, los demás se
// deslizan a su lugar nuevo en vez de saltar.
function ChatList({ newestOnTop, children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const positions = useRef(new Map());
  const [offset, setOffset] = useState(0);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Sin lista de dependencias a propósito: hay que medir después de CADA
  // render (llegó o se fue un mensaje, cambió el tamaño de letra...). No hace
  // un ciclo: setOffset con el mismo valor no vuelve a renderizar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const rows = [...inner.querySelectorAll(':scope > [data-chat-row]')];
    if (newestOnTop) {
      for (const row of rows) row.style.visibility = row.offsetTop + row.offsetHeight <= outer.clientHeight ? '' : 'hidden';
      setOffset(0);
    } else {
      for (const row of rows) row.style.visibility = '';
      setOffset(Math.max(0, inner.scrollHeight - outer.clientHeight));
    }
    // Cada fila que cambió de lugar se anima desde donde estaba.
    const next = new Map();
    for (const row of rows) {
      const id = row.dataset.chatRow;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, top);
      if (!reduceMotion && previous !== undefined && previous !== top && row.animate) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], { duration: MOVE_MS, easing: MOVE_EASING });
      }
    }
    positions.current = next;
  });

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-hidden">
      <div
        ref={innerRef}
        className="flex flex-col gap-2"
        style={{ transform: `translateY(${-offset}px)`, transition: reduceMotion ? 'none' : `transform ${MOVE_MS}ms ${MOVE_EASING}` }}
      >
        {children}
      </div>
    </div>
  );
}

// Lo que se dibuja (sin socket): lo usa el overlay y las vistas previas.
export function ChatVisual({ items, pinned, settings: rawSettings, viewerCount, customize, now = Date.now(), emptyText = 'Esperando mensajes del chat...' }) {
  const settings = { ...CHAT_DEFAULT_SETTINGS, ...(rawSettings || {}) };
  // Fondo de cada burbuja: el oscuro de Social Stream Ninja salvo que en
  // Personalizar se haya elegido otro (degradado, arcoíris, transparente).
  const bgType = customize?.background?.type;
  const darkBubble = !bgType || bgType === 'solid';
  const rowBg = darkBubble ? {} : resolveBackgroundStyle(customize, 'transparent');
  const bubbleClass = darkBubble ? 'tkc-chat-bubble' : '';
  const rowBorderStyle = rowBorder(customize) === '1px solid transparent' || !darkBubble ? rowBorder(customize) : '1px solid rgba(255,255,255,0.08)';
  // Con el color de nombres en "Predeterminado" se usa el del tema (como los
  // nombres de colores de Social Stream Ninja); si el streamer eligió uno en
  // Personalizar, manda ese.
  const custom = customize?.usernameColor?.type && customize.usernameColor.type !== 'default';
  const override = custom ? getUsernameOverride(customize, { scale: false }) : null;
  const nameStyle = override ? { className: override.className, style: override.cssVars } : { className: 'tkc-username-theme', style: {} };
  const shown = visibleChatItems(items || [], settings, now);
  const ordered = settings.newestOnTop ? [...shown].reverse() : shown;
  // Animación de entrada: la elegida en Personalizar; si no hay ninguna,
  // subir desde abajo (orden normal: cada nuevo sale debajo del anterior) o
  // bajar desde arriba (con "lo nuevo arriba").
  const anim = customize?.messageAnimation || (settings.newestOnTop ? 'slide-down' : 'slide-up');
  const animClass = anim !== 'none' ? `tkc-alert-anim-in-${anim}` : '';

  // Casi sin margen a los lados (pedido explícito: se veía espacio perdido
  // entre la burbuja y la orilla del overlay).
  return (
    // Ocupa todo su contenedor: en OBS, 960 x 480 en una fuente horizontal o
    // toda la fuente en una vertical (ver chatFrameSize y ChatOverlayFrame en
    // app/OverlayModeView.jsx); en las vistas previas, el tamaño de referencia.
    <div className="px-1.5 py-3 flex flex-col gap-2 font-sans overflow-hidden" {...overlayRootProps(customize, { width: '100%', height: '100%', fontSize: `${settings.fontSize}px` })}>
      {settings.showViewerCount && (
        <div className="flex items-center justify-between flex-shrink-0 text-[12px] px-1">
          <p {...labelProps(customize, 'tkc-over-scene theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black')}>Chat en vivo</p>
          <span className="tkc-ovl-fill tkc-chat-bubble tkc-chat-text text-xs font-black px-2.5 py-1 rounded-full flex-shrink-0">
            {Math.max(0, viewerCount || 0).toLocaleString('es-MX')} viendo
          </span>
        </div>
      )}
      <PinnedBanner pinned={pinned} settings={settings} rowBg={rowBg} nameStyle={nameStyle} bubbleClass={bubbleClass} rowBorderStyle={rowBorderStyle} />
      {ordered.length > 0 ? (
        <ChatList newestOnTop={settings.newestOnTop}>
          {ordered.map((item) => (
            <ChatRow key={item.id} item={item} settings={settings} now={now} rowBg={rowBg} nameStyle={nameStyle} animClass={animClass} bubbleClass={bubbleClass} rowBorderStyle={rowBorderStyle} />
          ))}
        </ChatList>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p {...labelProps(customize, 'tkc-over-scene text-gray-500 text-xs italic text-center')}>{emptyText}</p>
        </div>
      )}
    </div>
  );
}

// El overlay de OBS (y la vista previa en vivo de la pestaña Chat): escucha su
// sala del socket. `previewMessages` (Overlays > Personalizar) son filas de
// prueba fijas, sin socket.
export function ChatOverlay({ socket, viewerCount, customize, previewMessages, previewSettings }) {
  const [items, setItems] = useState([]);
  const [pinned, setPinned] = useState(null);
  const [settings, setSettings] = useState(CHAT_DEFAULT_SETTINGS);
  const [now, setNow] = useState(() => Date.now());
  const seenIds = useRef(new Set());

  useEffect(() => {
    if (previewMessages || !socket) return undefined;
    const onSnapshot = (snapshot) => {
      seenIds.current = new Set((snapshot?.items || []).map((item) => item.id));
      setItems(snapshot?.items || []);
      setPinned(snapshot?.pinned || null);
      if (snapshot?.settings) setSettings(snapshot.settings);
    };
    const onItem = (item) => {
      if (!item || seenIds.current.has(item.id)) return;
      seenIds.current.add(item.id);
      if (seenIds.current.size > 500) seenIds.current = new Set([...seenIds.current].slice(-200));
      setItems((current) => [...current, item].slice(-30));
    };
    const onPinned = (value) => setPinned(value || null);
    const onSettings = (value) => { if (value) setSettings(value); };
    // Se pide el resumen cuando ya se está escuchando (y de nuevo tras una
    // reconexión): si llegara antes, se perdería.
    const subscribe = () => socket.emit('chat_overlay_subscribe');
    socket.on('chat_snapshot', onSnapshot);
    socket.on('chat_item', onItem);
    socket.on('chat_pinned', onPinned);
    socket.on('chat_settings_update', onSettings);
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.off('chat_snapshot', onSnapshot);
      socket.off('chat_item', onItem);
      socket.off('chat_pinned', onPinned);
      socket.off('chat_settings_update', onSettings);
      socket.off('connect', subscribe);
      socket.emit('chat_overlay_unsubscribe');
    };
  }, [socket, previewMessages]);

  // Reloj para sacar de la lista lo que ya se desvaneció.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const effectiveSettings = previewSettings ? { ...settings, ...previewSettings } : settings;
  return (
    <ChatVisual
      items={previewMessages || items}
      pinned={previewMessages ? null : pinned}
      settings={previewMessages ? { ...effectiveSettings, fadeSeconds: 0 } : effectiveSettings}
      viewerCount={viewerCount}
      customize={customize}
      now={now}
    />
  );
}
