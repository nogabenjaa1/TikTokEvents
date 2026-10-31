// Personalización de fondo + color de nombre de usuario por overlay —
// mismo criterio que ThemeContext.jsx (persistido en localStorage del
// dispositivo del streamer, y emitido por socket como `set_overlay_customization`
// para que el overlay de OBS, que corre en OTRO navegador, lo replique en vivo
// — ver App.jsx/tenant.js). Espejo de las validaciones de
// backend/tenant.js (sanitizeOverlayCustomization).
const STORAGE_KEY = 'tkc_overlay_customization';

// Un id por cada tarjeta de OverlayLink.jsx (la granularidad "por overlay"
// que pidió el streamer) — Rey del Trono/Zubastinis/Eliminación/Ruleta
// comparten una sola URL/fuente de OBS, así que comparten una sola
// personalización ("games").
export const OVERLAY_CUSTOMIZE_IDS = ['games', 'colors', 'taptap', 'gifter', 'extensible', 'musicqueue', 'alerts', 'goal', 'chat', 'ticker', 'versus'];

export const OVERLAY_CUSTOMIZE_LABELS = {
  games: 'Overlay de juegos (Rey del Trono / Zubastinis / Eliminación / Ruleta)',
  colors: 'Overlay de Colores',
  taptap: 'Top Tap-Tap',
  gifter: 'Top Gifter',
  extensible: 'Modo Extensible',
  musicqueue: 'Cola de Spotify',
  // Pedido explicito: el texto opcional de las Alertas usa esta MISMA
  // personalizacion (color/degradado/arcoíris + tamaño) que el resto de
  // los overlays -- "background" no aplica acá (una alerta nunca tiene
  // fondo propio, siempre transparente), solo se usa `usernameColor` (ver
  // getUsernameOverride) para el texto. Ver AlertsAdmin.jsx.
  alerts: 'Alertas',
  goal: 'Objetivo (meta de regalos/seguidores)',
  chat: 'Chat en vivo + espectadores',
  ticker: 'Tira de regalos con alerta',
  versus: 'Versus (héroes vs. villanos)',
};

// Tamaños de fuente disponibles para texto/nombre de usuario — multiplicador
// aplicado con `transform: scale()` (ver getUsernameOverride) en vez de un
// `font-size` fijo: cada overlay ya usa un tamaño de base distinto para su
// username (King: text-2xl, Top Tap-Tap: text-sm, etc.), así que escalar el
// tamaño YA renderizado es la única forma de tener un control único que
// funcione igual en los 6 overlays sin tener que hardcodear el tamaño base
// de cada uno acá.
export const FONT_SCALES = { normal: 1, large: 1.1, xlarge: 1.2 };

// Animación de entrada de cada mensaje nuevo en el overlay de Chat (pedido
// explícito) — mismos 5 presets y mismas clases CSS que ya usan las Alertas
// (`.tkc-alert-anim-in-*`, ver index.css): son transiciones genéricas de
// opacidad/transform, sin nada específico de alertas en su definición, así
// que reusarlas tal cual evita duplicar el mismo CSS. Campo OPCIONAL en el
// `entry` genérico (igual que `background`/`usernameColor`) -- solo lo lee
// el overlay de Chat, el resto lo ignora sin problema.
export const VALID_MESSAGE_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'bounce'];
export const MESSAGE_ANIMATION_LABELS = {
  none: 'Ninguna', fade: 'Fundido', 'slide-up': 'Desde abajo', 'slide-down': 'Desde arriba', zoom: 'Zoom', bounce: 'Rebote',
};

function defaultEntry() {
  return {
    background: { type: 'solid', from: '#7C3AED', to: '#3B82F6' },
    usernameColor: { type: 'default', color: '#000000', from: '#7C3AED', to: '#3B82F6', fontSize: 'normal' },
    messageAnimation: 'fade',
    // Volumen general (pedido explícito) -- solo lo usa el overlay de
    // Alertas (audio propio + audio del video + el aviso que escucha el
    // propio streamer en su panel, ver AlertSoundListener), el resto lo
    // ignora sin problema. 1 = volumen normal del archivo, 0 = mudo.
    volume: 1,
    // Bordes/marcos visibles del overlay (pedido explícito, switch por
    // overlay): el marco exterior y los separadores entre filas. Encendido
    // por defecto -- así nadie ve un cambio hasta que lo apaga a propósito.
    borders: true,
    // Textos fijos del overlay y fuente: ver getLabelOverride/overlayRootProps.
    labelText: { type: 'default', color: '#FFFFFF', from: '#7C3AED', to: '#3B82F6', fontSize: 'normal' },
    font: 'sora',
  };
}

export function defaultOverlayCustomizationMap() {
  return Object.fromEntries(OVERLAY_CUSTOMIZE_IDS.map((id) => [id, defaultEntry()]));
}

// ── Estilos listos (presets) ────────────────────────────────────────────
// Pedido explícito: que un overlay se vea bien con una sola elección en vez
// de ajustar fondo, bordes, dos colores de texto y la fuente por separado.
// Un estilo NO es un campo nuevo: escribe los mismos campos de siempre (el
// backend los valida igual, ver sanitizeOverlayCustomization), así que no
// hay nada que migrar y cualquier ajuste posterior se conserva tal cual. Qué
// estilo está puesto se deduce comparando (ver matchOverlayPreset): si se
// cambió algo, el panel lo muestra como "Personalizado".
// Los campos que forman el aspecto de un overlay. `volume` (Alertas) y
// `messageAnimation` (Chat) quedan fuera a propósito: son de un solo overlay
// y un estilo o "Aplicar a todos" no deben pisarlos.
export const VISUAL_KEYS = ['background', 'borders', 'usernameColor', 'labelText', 'font'];

const text = (type, color, fontSize = 'normal') => ({ type, color, from: '#7C3AED', to: '#3B82F6', fontSize });

export const OVERLAY_STYLE_PRESETS = [
  {
    id: 'classic', label: 'Clásico', hint: 'Los colores de tu tema',
    values: {
      background: { type: 'solid', from: '#7C3AED', to: '#3B82F6' }, borders: true,
      usernameColor: text('default', '#000000'), labelText: text('default', '#FFFFFF'), font: 'sora',
    },
  },
  {
    id: 'floating', label: 'Sobre tu escena', hint: 'Sin fondo, texto blanco con sombra',
    values: {
      background: { type: 'transparent', from: '#7C3AED', to: '#3B82F6' }, borders: false,
      usernameColor: text('custom', '#FFFFFF'), labelText: text('custom', '#FFFFFF'), font: 'poppins',
    },
  },
  {
    id: 'neon', label: 'Neón', hint: 'Fondo nocturno, rosa y cian',
    values: {
      background: { type: 'gradient', from: '#14082E', to: '#3B0A63' }, borders: true,
      usernameColor: text('custom', '#F472D0'), labelText: text('custom', '#5EEAF5'), font: 'oswald',
    },
  },
  {
    id: 'arcade', label: 'Arcade', hint: 'Azul profundo, amarillo y títulos arcoíris',
    values: {
      background: { type: 'gradient', from: '#071A4A', to: '#1D3FB0' }, borders: true,
      usernameColor: text('custom', '#FDE047', 'large'), labelText: text('rainbow', '#FFFFFF', 'large'), font: 'bebas',
    },
  },
  {
    id: 'party', label: 'Fiesta', hint: 'Fondo arcoíris en movimiento',
    values: {
      background: { type: 'rainbow', from: '#7C3AED', to: '#3B82F6' }, borders: false,
      usernameColor: text('custom', '#1A1033'), labelText: text('custom', '#1A1033'), font: 'nunito',
    },
  },
];

export function applyOverlayPreset(entry, presetId) {
  const preset = OVERLAY_STYLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return entry;
  return { ...entry, ...structuredClone(preset.values) };
}

// Qué estilo coincide con lo que hay guardado (o null: "Personalizado"). Solo
// se comparan los datos que se ven: los colores de un degradado no cuentan
// si el fondo no es un degradado, ni el color propio si no es "Un color".
function visualSignature(entry) {
  const bg = entry?.background || {};
  const textSig = (t = {}) => [t.type || 'default', t.type === 'custom' ? String(t.color || '').toLowerCase() : '',
    t.type === 'gradient' ? `${t.from}>${t.to}`.toLowerCase() : '', t.fontSize || 'normal'].join('|');
  return [
    bg.type || 'solid', bg.type === 'gradient' ? `${bg.from}>${bg.to}`.toLowerCase() : '',
    bordersEnabled(entry) ? 'b' : 'nb', textSig(entry?.usernameColor), textSig(entry?.labelText), entry?.font || 'sora',
  ].join('#');
}
export function matchOverlayPreset(entry) {
  const sig = visualSignature(entry);
  return OVERLAY_STYLE_PRESETS.find((p) => visualSignature(p.values) === sig)?.id || null;
}

// "Restablecer": el aspecto de fábrica de este overlay, sin tocar el volumen
// de las Alertas (que se ajusta en otra pantalla).
export function resetOverlayVisual(entry) {
  const base = defaultEntry();
  const out = { ...entry };
  for (const key of VISUAL_KEYS) out[key] = base[key];
  out.messageAnimation = base.messageAnimation;
  return out;
}

// "Aplicar a todos": copia solo el aspecto. Antes copiaba el objeto entero, y
// llevar los cambios de cualquier overlay a todos reseteaba el volumen de las
// Alertas y la animación de entrada del Chat.
export function copyOverlayVisual(from, to) {
  const out = { ...to };
  for (const key of VISUAL_KEYS) out[key] = structuredClone(from?.[key] ?? defaultEntry()[key]);
  return out;
}

function isValidEntry(e) {
  return !!e && !!e.background && ['transparent', 'solid', 'gradient', 'rainbow'].includes(e.background.type)
    && !!e.usernameColor && ['default', 'theme', 'custom', 'gradient', 'rainbow'].includes(e.usernameColor.type)
    && (e.messageAnimation === undefined || VALID_MESSAGE_ANIMATIONS.includes(e.messageAnimation))
    && (e.volume === undefined || (typeof e.volume === 'number' && e.volume >= 0 && e.volume <= 1))
    && (e.borders === undefined || typeof e.borders === 'boolean')
    && (e.labelText === undefined || (!!e.labelText && VALID_LABEL_COLOR_TYPES.includes(e.labelText.type)))
    && (e.font === undefined || typeof e.font === 'string');
}

export function loadOverlayCustomization() {
  const base = defaultOverlayCustomizationMap();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    OVERLAY_CUSTOMIZE_IDS.forEach((id) => {
      if (isValidEntry(parsed?.[id])) base[id] = parsed[id];
    });
  } catch {
    // localStorage corrupto/bloqueado -> se sigue con los defaults.
  }
  return base;
}

export function saveOverlayCustomization(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Modo privado / storage lleno: la personalización sigue funcionando en
    // esta sesión (vive en el state de React), solo no sobrevive a un reload.
  }
}

// Colores del arcoíris (fondo, texto, la ruleta en SVG y la muestra del
// selector). Antes eran 6 tonos con un azul y un violeta oscuros (#3b82f6,
// #a855f7, luminancia 0.22 contra 0.75 del amarillo): en la mitad fría del
// ciclo el efecto se apagaba. Estos 8 van de 0.31 a 0.72, y el degradado
// cierra en el tono con que empieza para que el bucle no tenga salto.
// Mismos valores que en index.css y RouletteOverlay.jsx.
export const RAINBOW_STOPS = ['#FF6363', '#FFA23A', '#FFD93D', '#4CE38A', '#2EDCF2', '#6FB1FF', '#B08CFF', '#FF7AC6'];
export const RAINBOW_GRADIENT = `linear-gradient(90deg,${[...RAINBOW_STOPS, RAINBOW_STOPS[0]].join(',')})`;

// ── Tinta automática según el fondo ─────────────────────────────────────
// Los temas pastel fuerzan el texto a una tinta oscura (y el nombre
// "Original" es negro): con un degradado oscuro el overlay quedaba ilegible y
// había que corregir a mano cada color de texto. Ahora, si el degradado
// elegido es oscuro, el overlay pasa solo a tinta clara. Un fondo del tema,
// transparente o arcoíris (claro) conserva la tinta de siempre.
function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const DARK_INK_LUMINANCE = hexLuminance('#2E2136');
const LIGHT_INK = '#F8F5FF';
const LIGHT_INK_LUMINANCE = hexLuminance(LIGHT_INK);

// true si el fondo pide tinta clara: la que mejor contrasta con el más
// desfavorable de los dos colores del degradado.
export function backgroundNeedsLightInk(entry) {
  const bg = entry?.background;
  if (bg?.type !== 'gradient') return false;
  const stops = [hexLuminance(bg.from), hexLuminance(bg.to)].filter((l) => l !== null);
  if (!stops.length) return false;
  const worst = (ink) => Math.min(...stops.map((l) => contrast(l, ink)));
  return worst(LIGHT_INK_LUMINANCE) > worst(DARK_INK_LUMINANCE);
}

// Variables que pasan a tinta clara lo que va encima de un fondo: el texto
// que el tema remapea (--ink-*), el nombre "Original" y los textos de acento
// (--tkc-accent-ink-l, ver index.css). Van en el elemento que lleva el fondo
// (ver resolveBackgroundStyle), así que todo lo de adentro las hereda.
function lightInkVars() {
  // `color` también: lo que no lleva clase de color hereda el del tema, que
  // ya viene calculado oscuro desde más arriba.
  // `--tkc-rainbow-stroke`: el trazo oscuro del texto arcoíris no hace falta sobre un fondo oscuro.
  return { color: LIGHT_INK, '--ink-default': LIGHT_INK, '--ink-cute': LIGHT_INK, '--ink': LIGHT_INK, '--tkc-name-default': LIGHT_INK, '--tkc-accent-ink-l': 0.86, '--tkc-rainbow-stroke': '0px transparent' };
}

// Fondo de un overlay (marco completo en King/Zub/Elim/Ruleta/Colores/
// Extensible, o cada fila individual en Top Tap-Tap/Top Gifter/Cola de
// Spotify — ver comentario en Overlay.jsx sobre por qué esos tres no tienen
// marco propio). `fallbackVar` es el color que ya usaba ese elemento ANTES
// de que existiera esta personalización (`--surface-bg` para marcos,
// `--surface-bg-alt` para filas) — con `type: 'solid'` (el default) el
// resultado es IDÉNTICO al de antes, cero regresión visual hasta que el
// streamer entra al modal y cambia algo.
// `type: 'rainbow'`: degradado arcoíris EN MOVIMIENTO (no un color fijo) —
// mismo truco que getUsernameOverride (background-size ampliado +
// animación de background-position), pero acá SÍ se puede usar `background`
// como objeto de estilo inline normal (sin necesitar una clase con
// !important): a diferencia del color de texto, nada más le pisa el fondo
// de estos overlays, así que no hay ningún !important de tema con el que
// competir. `backgroundImage` (no el shorthand `background`) para no
// arrastrar el mismo error que tenía `.tkc-username-rainbow` (ver
// comentario en index.css) si en algún momento se agrega otro campo de
// `background-*` acá al lado.
// Rendimiento: el arcoíris en movimiento lo dibuja una capa aparte que se
// desliza (ver [style*="--tkc-rainbow-bg"] en index.css), no un
// background-position animado, que repintaba el recuadro entero en cada
// cuadro y trababa los overlays en OBS. El color de base es el del propio
// arcoíris, para el primer cuadro antes de que la capa se componga.
function rainbowBackgroundStyle() {
  return { background: RAINBOW_STOPS[2], '--tkc-rainbow-bg': '1' };
}

// Bordes on/off (pedido explícito). `borders` es opcional en el entry: si
// falta (datos viejos) cuenta como encendido, igual que el default.
export function bordersEnabled(entry) {
  return entry?.borders !== false;
}

// Con los bordes apagados el color pasa a transparente (no se quita el
// grosor) para que nada se corra de lugar, y se anula la sombra/brillo del
// marco -- de otra forma seguiría dibujando un contorno aunque sea difuso.
// Va DENTRO de resolveBackgroundStyle porque todos los marcos y filas que ya
// usaban la personalización pasan por ahí (ver Overlay.jsx/DiceOverlay.jsx).
export function bordersOffStyle(entry) {
  return bordersEnabled(entry) ? {} : { borderColor: 'transparent', boxShadow: 'none' };
}

// Para los elementos que ponen su borde con un `border` inline propio
// (después del fondo) en vez de heredar el del tema.
export function rowBorder(entry) {
  return bordersEnabled(entry) ? '1px solid var(--surface-border-color)' : '1px solid transparent';
}

function backgroundOnlyStyle(entry, fallbackVar) {
  const bg = entry?.background;
  if (!bg || bg.type === 'solid') return { background: fallbackVar };
  if (bg.type === 'transparent') return { background: 'transparent' };
  if (bg.type === 'gradient') return { background: `linear-gradient(135deg, ${bg.from || '#7C3AED'}, ${bg.to || '#3B82F6'})` };
  if (bg.type === 'rainbow') return rainbowBackgroundStyle();
  return { background: fallbackVar };
}

// Con un degradado oscuro, el MISMO elemento que lleva el fondo (el marco
// del overlay, o cada fila en los rankings, el chat y la cola de Spotify)
// pasa a tinta clara: así cambia lo que está encima del degradado y no un
// título que queda fuera de las filas, directo sobre la escena de OBS.
export function resolveBackgroundStyle(entry, fallbackVar = 'var(--surface-bg)') {
  return { ...backgroundOnlyStyle(entry, fallbackVar), ...bordersOffStyle(entry), ...(backgroundNeedsLightInk(entry) ? lightInkVars() : {}) };
}

// Color del texto de un username en HTML normal (no SVG, ver
// getUsernameFill para eso). OJO: NO alcanza con un `style` inline para el
// COLOR — index.css tiene reglas `!important` por tema que fuerzan el color
// de .text-white/.text-gray-* (para que se vean bien en skins claros como
// Minimalista), y esas SIEMPRE le ganan a un `color` inline sin !important
// sin importar la especificidad. Por eso el color/degradado/arcoíris se
// resuelve con una CLASE (con su propio !important, ver
// `.tkc-username-*` al final de index.css) — `cssVars` (pese al nombre,
// legado de cuando solo llevaba variables CSS) es el objeto de estilo
// inline que el caller mezcla en su `style`: además de las variables que
// cada clase consume, ahí también va el `transform: scale()` del tamaño de
// fuente (ESE sí puede ir inline sin pelear con ningún !important, nada más
// lo toca).
// `{ className: '', cssVars: {} }` (el default con tamaño "normal") no
// cambia ningún look existente — el caller simplemente no agrega nada.
// `{ scale: false }`: no aplica el tamaño con transform (que NO ocupa espacio
// real y hace que el texto se encime con lo de al lado). Lo usan las Alertas,
// que aplican el tamaño con un font-size de verdad para que el diseño se
// adapte (ver AlertVisual en Overlay.jsx).
export function getUsernameOverride(entry, { scale: applyScale = true } = {}) {
  const uc = entry?.usernameColor || {};
  const scale = applyScale ? (FONT_SCALES[uc.fontSize] ?? 1) : 1;
  // `transform: scale()` (no `font-size`) porque cada overlay ya parte de
  // un tamaño de base distinto (ver comentario de FONT_SCALES) — escalar
  // el tamaño YA renderizado funciona igual sin importar cuál sea esa
  // base. `transform-origin: center` para que crezca parejo hacia los dos
  // lados en vez de invadir solo al vecino de la derecha en una fila.
  const scaleStyle = scale !== 1 ? { display: 'inline-block', transform: `scale(${scale})`, transformOrigin: 'center' } : {};

  // "Original" sigue siendo negro; solo cambia a claro dentro de un overlay
  // con fondo oscuro (ver lightInkVars).
  if (!uc.type || uc.type === 'default') return { className: 'tkc-username-custom', cssVars: { '--tkc-username-color': 'var(--tkc-name-default, #000000)', ...scaleStyle } };
  if (uc.type === 'theme') return { className: 'tkc-username-theme', cssVars: scaleStyle };
  if (uc.type === 'rainbow') return { className: 'tkc-username-rainbow', cssVars: scaleStyle };
  if (uc.type === 'gradient') {
    return {
      className: 'tkc-username-gradient',
      cssVars: { '--tkc-username-from': uc.from || '#7C3AED', '--tkc-username-to': uc.to || '#3B82F6', ...scaleStyle },
    };
  }
  return { className: 'tkc-username-custom', cssVars: { '--tkc-username-color': uc.color || '#FFFFFF', ...scaleStyle } };
}

// Equivalente a getUsernameOverride pero para <text> de SVG (la ruleta dibuja
// los usernames con `fill`, no `color`) — el arcoíris y el degradado
// personalizado ahí son ESTÁTICOS (ids fijos "tkc-rainbow-grad"/
// "tkc-custom-grad", definidos una sola vez en RouletteWheel, este último
// alimentado con los colores reales vía sus <stop>) en vez de animados:
// animar los stops de un <linearGradient> en SVG puro pide <animate>
// aparte, y el efecto ya se nota bien sin eso. El escalado de tamaño NO
// aplica acá — la ruleta ya ajusta su propio fontSize por sección (ver
// RouletteWheel), agrandar más encima rompería el acomodo del texto
// dentro de cada porción.
export function getUsernameFill(entry, fallback) {
  const uc = entry?.usernameColor;
  if (!uc || uc.type === 'default') return 'var(--tkc-name-default, #000000)';
  if (uc.type === 'theme') return 'var(--accent-soft)';
  if (uc.type === 'rainbow') return 'url(#tkc-rainbow-grad)';
  if (uc.type === 'gradient') return 'url(#tkc-custom-grad)';
  return uc.color || fallback;
}

// ── Textos fijos y fuente (pedido explícito) ────────────────────────────
// Los textos que trae cada overlay (títulos como "REY DEL TRONO", "TIEMPO",
// "STEAL SPOT WITH:", la acción de cada regalo en Versus, el título de
// ColorSays...) no se podían cambiar: solo los nombres de usuario tenían
// color y tamaño. `labelText` les da lo mismo, por separado, y `font`
// cambia la fuente de TODO el overlay. Los dos son opcionales en el entry:
// sin ellos (datos guardados antes), el overlay se ve exactamente igual.
export const VALID_LABEL_COLOR_TYPES = ['default', 'theme', 'custom', 'gradient', 'rainbow'];
// Multiplicador real del tamaño (con `zoom`, que sí ocupa espacio: el texto
// más grande empuja a lo de al lado en vez de encimarse, a diferencia del
// `transform: scale()` de los nombres).
export const LABEL_SCALES = { small: 0.85, normal: 1, large: 1.2, xlarge: 1.4 };
export const LABEL_SCALE_LABELS = { small: 'Chico', normal: 'Normal', large: 'Grande', xlarge: 'Extra grande' };

// Fuentes del overlay. Las de Google se descargan solo si alguien las elige
// (ver ensureOverlayFont): un overlay con la fuente de siempre no pide nada.
export const OVERLAY_FONTS = {
  sora: { label: 'Sora (la de siempre)', family: null },
  poppins: { label: 'Poppins', family: "'Poppins', ui-sans-serif, sans-serif", google: 'Poppins:wght@400;600;700;800;900' },
  nunito: { label: 'Nunito (redondeada)', family: "'Nunito', ui-sans-serif, sans-serif", google: 'Nunito:wght@400;700;800;900' },
  oswald: { label: 'Oswald (angosta)', family: "'Oswald', ui-sans-serif, sans-serif", google: 'Oswald:wght@400;500;600;700' },
  bebas: { label: 'Bebas Neue (titular)', family: "'Bebas Neue', 'Oswald', ui-sans-serif, sans-serif", google: 'Bebas+Neue' },
  system: { label: 'Del sistema', family: 'ui-sans-serif, system-ui, sans-serif' },
};
export const VALID_OVERLAY_FONTS = Object.keys(OVERLAY_FONTS);

const loadedFonts = new Set();
export function ensureOverlayFont(fontId) {
  const font = OVERLAY_FONTS[fontId];
  if (!font?.google || loadedFonts.has(fontId) || typeof document === 'undefined') return;
  loadedFonts.add(fontId);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

// Lo que va en el elemento RAÍZ de cada overlay: la fuente elegida y la
// marca de fondo transparente. Con "Transparente", TODOS los fondos de
// adentro (cajas, píldoras de monedas, avisos, dados vacíos, carátulas)
// pasan a transparentes también -- ver `.tkc-ovl-fill` en index.css. Bug
// real: en ColorDice el marco se volvía transparente pero los dados seguían
// con el color del tema.
export function overlayRootProps(entry, style = {}) {
  const font = OVERLAY_FONTS[entry?.font];
  if (font?.google) ensureOverlayFont(entry.font);
  return {
    'data-ovl-bg': entry?.background?.type || 'solid',
    style: font?.family ? { ...style, fontFamily: font.family, '--font-sans': font.family } : style,
  };
}

// Color y tamaño de un texto fijo. `{ className, style }` para mezclar en el
// elemento. 'default' no agrega color: el texto conserva el suyo de siempre.
export function getLabelOverride(entry) {
  const lt = entry?.labelText || {};
  const scale = LABEL_SCALES[lt.fontSize] ?? 1;
  const style = scale !== 1 ? { zoom: scale } : {};
  if (!lt.type || lt.type === 'default') return { className: '', style };
  if (lt.type === 'theme') return { className: 'tkc-username-theme', style };
  if (lt.type === 'rainbow') return { className: 'tkc-username-rainbow', style };
  if (lt.type === 'gradient') {
    return { className: 'tkc-username-gradient', style: { ...style, '--tkc-username-from': lt.from || '#7C3AED', '--tkc-username-to': lt.to || '#3B82F6' } };
  }
  // Contorno para cuando este texto va directo sobre la escena (ver
  // .tkc-over-scene en index.css): el tono contrario al del texto, para que
  // se lea sobre una escena clara u oscura; el halo de color solo en textos
  // claros, que es donde se ve como neón.
  const light = (hexLuminance(lt.color || '#FFFFFF') ?? 1) > 0.3;
  return {
    className: 'tkc-username-custom',
    style: {
      ...style,
      '--tkc-username-color': lt.color || '#FFFFFF',
      '--tkc-scene-outline': light ? 'rgb(10 6 20 / 0.9)' : 'rgb(255 255 255 / 0.9)',
      '--tkc-scene-glow': light ? 'color-mix(in srgb, currentColor 55%, transparent)' : 'rgb(255 255 255 / 0.55)',
    },
  };
}

// Atajo para un texto fijo: <p {...labelProps(customize, 'text-xs font-black')}>.
export function labelProps(entry, className = '', style = {}) {
  const o = getLabelOverride(entry);
  return { className: `${className} ${o.className}`.trim(), style: { ...style, ...o.style } };
}

// Solo el tamaño de un texto fijo, sin tocar su color: para avisos de estado
// (snipe, pausado, eliminado) cuyo color comunica algo y no debe cambiar.
export function labelScaleStyle(entry, style = {}) {
  const scale = LABEL_SCALES[entry?.labelText?.fontSize] ?? 1;
  return scale !== 1 ? { ...style, zoom: scale } : style;
}

// Títulos que antes seguían el color del nombre de usuario (Extensible,
// ColorSays, Versus): mientras "Textos fijos" esté en Predeterminado lo
// siguen haciendo, para no cambiarle el look a quien ya los había
// personalizado así; al elegir un color de texto fijo, manda ese.
export function titleProps(entry, className = '', style = {}) {
  const lt = entry?.labelText;
  if (!lt?.type || lt.type === 'default') {
    const name = getUsernameOverride(entry, { scale: false });
    return { className: `${className} ${name.className}`.trim(), style: { ...style, ...name.cssVars, ...labelScaleStyle(entry) } };
  }
  return labelProps(entry, className, style);
}
