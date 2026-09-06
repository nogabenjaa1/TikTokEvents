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
export const OVERLAY_CUSTOMIZE_IDS = ['games', 'colors', 'taptap', 'gifter', 'extensible', 'musicqueue'];

export const OVERLAY_CUSTOMIZE_LABELS = {
  games: 'Overlay de juegos (Rey del Trono / Zubastinis / Eliminación / Ruleta)',
  colors: 'Overlay de Colores',
  taptap: 'Top Tap-Tap',
  gifter: 'Top Gifter',
  extensible: 'Modo Extensible',
  musicqueue: 'Cola de Spotify',
};

// Tamaños de fuente disponibles para texto/nombre de usuario — multiplicador
// aplicado con `transform: scale()` (ver getUsernameOverride) en vez de un
// `font-size` fijo: cada overlay ya usa un tamaño de base distinto para su
// username (King: text-2xl, Top Tap-Tap: text-sm, etc.), así que escalar el
// tamaño YA renderizado es la única forma de tener un control único que
// funcione igual en los 6 overlays sin tener que hardcodear el tamaño base
// de cada uno acá.
export const FONT_SCALES = { normal: 1, large: 1.1, xlarge: 1.2 };

function defaultEntry() {
  return {
    background: { type: 'solid', from: '#7C3AED', to: '#3B82F6' },
    usernameColor: { type: 'default', color: '#000000', from: '#7C3AED', to: '#3B82F6', fontSize: 'normal' },
  };
}

export function defaultOverlayCustomizationMap() {
  return Object.fromEntries(OVERLAY_CUSTOMIZE_IDS.map((id) => [id, defaultEntry()]));
}

function isValidEntry(e) {
  return !!e && !!e.background && ['transparent', 'solid', 'gradient', 'rainbow'].includes(e.background.type)
    && !!e.usernameColor && ['default', 'theme', 'custom', 'gradient', 'rainbow'].includes(e.usernameColor.type);
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

// Degradado usado tanto para el fondo "arcoíris" en texto (ver
// getUsernameOverride) como para la muestra dentro del selector del modal.
export const RAINBOW_GRADIENT = 'linear-gradient(90deg,#ff3b3b,#ff9f1c,#ffe135,#3ddc84,#3b82f6,#a855f7,#ff3b3b)';

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
function rainbowBackgroundStyle() {
  return {
    backgroundImage: RAINBOW_GRADIENT,
    backgroundSize: '400% 100%',
    animation: 'tkc-rainbow-move 8s linear infinite',
  };
}

export function resolveBackgroundStyle(entry, fallbackVar = 'var(--surface-bg)') {
  const bg = entry?.background;
  if (!bg || bg.type === 'solid') return { background: fallbackVar };
  if (bg.type === 'transparent') return { background: 'transparent' };
  if (bg.type === 'gradient') return { background: `linear-gradient(135deg, ${bg.from || '#7C3AED'}, ${bg.to || '#3B82F6'})` };
  if (bg.type === 'rainbow') return rainbowBackgroundStyle();
  return { background: fallbackVar };
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
export function getUsernameOverride(entry) {
  const uc = entry?.usernameColor || {};
  const scale = FONT_SCALES[uc.fontSize] ?? 1;
  // `transform: scale()` (no `font-size`) porque cada overlay ya parte de
  // un tamaño de base distinto (ver comentario de FONT_SCALES) — escalar
  // el tamaño YA renderizado funciona igual sin importar cuál sea esa
  // base. `transform-origin: center` para que crezca parejo hacia los dos
  // lados en vez de invadir solo al vecino de la derecha en una fila.
  const scaleStyle = scale !== 1 ? { display: 'inline-block', transform: `scale(${scale})`, transformOrigin: 'center' } : {};

  if (!uc.type || uc.type === 'default') return { className: 'tkc-username-custom', cssVars: { '--tkc-username-color': '#000000', ...scaleStyle } };
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
  if (!uc || uc.type === 'default') return '#000000';
  if (uc.type === 'theme') return 'var(--accent-soft)';
  if (uc.type === 'rainbow') return 'url(#tkc-rainbow-grad)';
  if (uc.type === 'gradient') return 'url(#tkc-custom-grad)';
  return uc.color || fallback;
}
