import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HowItWorks } from './PanelHelp';
import { buildOverlayUrl } from './auth';
import { ChatOverlay } from './overlays/ChatOverlay';
import { CHAT_DEFAULT_SETTINGS, CHAT_OVERLAY_SIZE, CHAT_OVERLAY_SIZE_VERTICAL } from './chatOverlayModel';

// ─────────────────────────────────────────────
// CHAT (pestaña de Eventos, pedido explícito): el overlay de chat con su
// propio apartado, como los demás módulos. Aquí se decide cómo se comporta
// (cuánto dura cada mensaje, orden, tamaño de letra, qué eventos se ven); el
// fondo, el color de los nombres y la fuente se cambian en Overlays >
// Personalizar, igual que en el resto de los overlays.
//
// Los ajustes viven en el servidor (chat_settings, ver
// backend/lib/tenant/chatOverlay.js): el overlay de OBS los recibe al momento
// y sobreviven a un reinicio o a entrar desde otro dispositivo.
// ─────────────────────────────────────────────

const FADE_OPTIONS = [
  { value: 0, label: 'Nunca' },
  { value: 10, label: '10 s' },
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
];

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 flex-shrink-0" />
      <span className="min-w-0">
        <span className="block text-xs font-bold text-white">{label}</span>
        {hint && <span className="block text-[10px] text-gray-500 leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

// El overlay a un tamaño de referencia (horizontal 960 x 480 o vertical
// 540 x 960, ver CHAT_OVERLAY_SIZE), achicado para que entre en el panel: a lo
// ancho y, el vertical, sin pasar de un alto cómodo. Se mide con el ancho
// disponible, igual que OverlayPreviewBox.
const PREVIEW_MAX_HEIGHT = 620;
function ScaledPreview({ size, children }) {
  const wrapRef = useRef(null);
  const [available, setAvailable] = useState(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const { w, h } = size;
  const scale = Math.min(1, PREVIEW_MAX_HEIGHT / h, available ? available / w : 0.5);
  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="themed-app rounded-2xl overflow-hidden border mx-auto"
        // minHeight: .themed-app trae el alto de la pantalla completa.
        style={{ width: Math.round(w * scale), height: Math.round(h * scale), minHeight: 0, borderColor: 'var(--surface-border-color)', background: 'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 50% / 20px 20px' }}
      >
        <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-semibold">{children}</p>;
}

export default function ChatPanel({ socket, viewerCount, customization }) {
  const [settings, setSettings] = useState(CHAT_DEFAULT_SETTINGS);
  const [copied, setCopied] = useState(false);
  // Cómo se ve la vista previa (solo aquí; el overlay se adapta solo al
  // tamaño de la fuente de OBS). Se recuerda en este navegador.
  const [orientation, setOrientation] = useState(() => {
    try { return localStorage.getItem('tkc_chat_preview_orientation') === 'vertical' ? 'vertical' : 'horizontal'; } catch { return 'horizontal'; }
  });
  const chooseOrientation = (value) => {
    setOrientation(value);
    try { localStorage.setItem('tkc_chat_preview_orientation', value); } catch { /* sin almacenamiento: solo no se recuerda */ }
  };
  const saveTimer = useRef(null);
  const overlayUrl = buildOverlayUrl('chat');

  // Los ajustes guardados llegan con el resumen del chat (y cuando otro
  // dispositivo los cambia).
  useEffect(() => {
    if (!socket) return undefined;
    const onSnapshot = (snapshot) => { if (snapshot?.settings) setSettings(snapshot.settings); };
    const onSettings = (value) => { if (value) setSettings(value); };
    socket.on('chat_snapshot', onSnapshot);
    socket.on('chat_settings_update', onSettings);
    return () => {
      socket.off('chat_snapshot', onSnapshot);
      socket.off('chat_settings_update', onSettings);
    };
  }, [socket]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Cambia al momento en la vista previa; al servidor (y al overlay de OBS)
  // se manda un instante después, para no enviar uno por cada paso del
  // deslizador.
  const update = (patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => socket?.emit('update_chat_settings', next), 250);
      return next;
    });
  };

  const copyUrl = () => {
    if (!overlayUrl) return;
    navigator.clipboard?.writeText(overlayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const fadeIsPreset = FADE_OPTIONS.some((o) => o.value === settings.fadeSeconds);

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 font-sans flex-1">

      {/* Vista previa en vivo: el mismo overlay que ve OBS, con los ajustes
          de abajo aplicados al momento, horizontal o como en OBS vertical. */}
      <div className="w-full max-w-4xl flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="theme-label text-[10px]">Vista previa en vivo</p>
          <div className="flex gap-1" role="group" aria-label="Forma de la vista previa">
            {[['horizontal', 'Horizontal'], ['vertical', 'Vertical']].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={orientation === value} onClick={() => chooseOrientation(value)}
                className={`theme-btn-sm font-bold ${orientation === value ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <ScaledPreview size={orientation === 'vertical' ? CHAT_OVERLAY_SIZE_VERTICAL : CHAT_OVERLAY_SIZE}>
          <ChatOverlay socket={socket} viewerCount={viewerCount} customize={customization} previewSettings={settings} />
        </ScaledPreview>
        <p className="text-[10px] text-gray-500 text-center">Sin LIVE no llega nada: usa "Mensaje de prueba" para ver cómo se ve.</p>
      </div>

      <div className="theme-surface w-full max-w-4xl p-6 relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">CHAT</h1>
        </div>

        <HowItWorks storageKey="chat">
          <p>Tu chat de TikTok en un overlay para OBS, como el chat de TikTok: el primer mensaje sale <span className="font-bold text-white">arriba</span> y cada nuevo debajo del anterior. Cuando uno se desvanece, los demás suben; si ya no caben, los más viejos se deslizan hacia arriba para que el nuevo se vea completo.</p>
          <p>También muestra a quien te sigue, los regalos, quien comparte el LIVE y el mensaje anclado, con las insignias de cada usuario. El fondo, el color de los nombres y la fuente se cambian en <span className="font-bold text-white">Overlays → Personalizar</span>.</p>
        </HowItWorks>

        <div className="mb-5">
          <SectionLabel>Enlace para OBS</SectionLabel>
          {overlayUrl ? (
            <div className="flex gap-2">
              <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} className="theme-input flex-1 min-w-0 p-2.5 text-[11px] outline-none" />
              <button type="button" onClick={copyUrl} className="theme-btn-primary theme-btn-md font-bold flex-shrink-0">{copied ? 'Copiado' : 'Copiar'}</button>
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">Inicia sesión para ver tu enlace.</p>
          )}
          <p className="text-[10px] text-gray-500 mt-1">Horizontal: fuente de navegador de 960 × 480, como siempre. Para OBS vertical, usa una fuente vertical (por ejemplo, 540 × 960): el chat la ocupa completa. Ya tienes este overlay si usabas el de chat: el enlace es el mismo.</p>
        </div>

        <div className="mb-5">
          <SectionLabel>Tiempo antes de desvanecerse</SectionLabel>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {FADE_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => update({ fadeSeconds: o.value })}
                className={`theme-btn-md font-bold transition-all ${settings.fadeSeconds === o.value ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-gray-400">
            Otro tiempo:
            <input type="number" min="0" max="600" step="1" value={fadeIsPreset ? '' : settings.fadeSeconds}
              placeholder="segundos"
              onChange={(e) => update({ fadeSeconds: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })}
              className="theme-input w-24 p-2 text-xs outline-none" />
            <span className="text-gray-500">s (0 = nunca)</span>
          </label>
        </div>

        <div className="mb-5">
          <SectionLabel>Orden</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => update({ newestOnTop: false })}
              className={`theme-btn-md font-bold transition-all ${!settings.newestOnTop ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>Como TikTok</button>
            <button type="button" onClick={() => update({ newestOnTop: true })}
              className={`theme-btn-md font-bold transition-all ${settings.newestOnTop ? 'theme-btn-primary' : 'theme-btn-secondary'}`}>Lo nuevo arriba</button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4">
          <label className="block">
            <SectionLabel>Tamaño de letra: {settings.fontSize}px</SectionLabel>
            <input type="range" min="12" max="48" step="1" value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <SectionLabel>Máximo en pantalla: {settings.maxMessages}</SectionLabel>
            <input type="range" min="1" max="30" step="1" value={settings.maxMessages} onChange={(e) => update({ maxMessages: Number(e.target.value) })} className="w-full" />
          </label>
        </div>

        <div className="mb-5">
          <SectionLabel>Qué se ve</SectionLabel>
          <Toggle label="Seguidores nuevos" hint="“Usuario te siguió”" checked={settings.showFollows} onChange={(v) => update({ showFollows: v })} />
          <Toggle label="Regalos" hint="Con el ícono del regalo y la cantidad del combo" checked={settings.showGifts} onChange={(v) => update({ showGifts: v })} />
          <Toggle label="Compartidos" hint="“Usuario compartió el LIVE”" checked={settings.showShares} onChange={(v) => update({ showShares: v })} />
          <Toggle label="Mensaje anclado" hint="El que anclas tú o un moderador, fijo arriba" checked={settings.showPinned} onChange={(v) => update({ showPinned: v })} />
          <Toggle label="Fotos de perfil" checked={settings.showAvatars} onChange={(v) => update({ showAvatars: v })} />
          <Toggle label="Insignias" hint="Las de TikTok: club de fans, moderador, top gifter..." checked={settings.showBadges} onChange={(v) => update({ showBadges: v })} />
          <Toggle label="Contador de espectadores" checked={settings.showViewerCount} onChange={(v) => update({ showViewerCount: v })} />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => socket?.emit('chat_overlay_test')} className="theme-btn-secondary theme-btn-lg flex-1 font-bold tracking-wide transition-all">
            MENSAJE DE PRUEBA
          </button>
          <button type="button" onClick={() => socket?.emit('clear_chat_overlay')} className="theme-btn-warning theme-btn-lg font-bold tracking-wide transition-all">
            LIMPIAR
          </button>
        </div>
      </div>
    </div>
  );
}
