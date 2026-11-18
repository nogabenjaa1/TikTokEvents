// Modelo del tema: UN solo diseño (el "tema maestro") y un color de acento que
// elige el streamer. Antes había dos materiales (Clásico y Cute) que cambiaban
// fondo, bordes, radios y sombras; ahora todo eso es fijo y el acento solo
// pinta lo que depende de él (botón principal, selección, navegación activa).
//
// Sin React ni DOM: lo usan ThemeContext.jsx, App.jsx y sus pruebas.

export const DEFAULT_CUSTOM_COLOR = '#7C3AED';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Los ids viajan al servidor (set_theme) y los valida lib/tenantSanitizers.js:
// no se pueden agregar ids nuevos sin tocar el backend. Cualquier otro color
// entra como 'custom'.
export const ACCENT_PRESETS = [
  { id: 'purple', label: 'Morado', hex: '#7C3AED' },
  { id: 'blue',   label: 'Azul',   hex: '#3B82F6' },
  { id: 'pink',   label: 'Rosa',   hex: '#EC4899' },
];
const presetById = Object.fromEntries(ACCENT_PRESETS.map(p => [p.id, p]));

// `style` ya no lo elige nadie: se sigue mandando 'default' porque es el
// formato que el servidor guarda y reenvía al overlay de OBS (que conserva su
// aspecto de siempre). Quien tenía Cute guardado (en este navegador o en la
// base) pasa aquí al tema maestro, con su acento y su color intactos.
export const THEME_STYLE = 'default';
export const DEFAULT_THEME = { style: THEME_STYLE, accent: 'purple', customColor: DEFAULT_CUSTOM_COLOR };

export function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

// Normaliza cualquier tema guardado o recibido (de localStorage, del servidor,
// de una versión vieja del panel) al formato actual. Nunca lanza.
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_THEME };
  const customColor = isHexColor(raw.customColor) ? raw.customColor : DEFAULT_CUSTOM_COLOR;
  let accent = raw.accent;
  if (accent === 'custom') {
    if (!isHexColor(raw.customColor)) accent = DEFAULT_THEME.accent;
  } else if (!presetById[accent]) {
    accent = DEFAULT_THEME.accent;
  }
  return { style: THEME_STYLE, accent, customColor };
}

export function sameTheme(a, b) {
  if (!a || !b || a.accent !== b.accent) return false;
  return a.accent === 'custom' ? a.customColor === b.customColor : true;
}

export function accentHex({ accent, customColor } = {}) {
  if (accent === 'custom' && isHexColor(customColor)) return customColor;
  return presetById[accent]?.hex ?? DEFAULT_CUSTOM_COLOR;
}

export function accentLabel({ accent } = {}) {
  return accent === 'custom' ? 'Personalizado' : (presetById[accent]?.label ?? 'Morado');
}

// ── Color ──────────────────────────────────────────────────────────────
// OKLCH a mano (unas líneas, sin dependencia): permite medir y corregir la
// luminosidad de un color cualquiera manteniendo su matiz.

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; }

export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H };
}

function oklchToLinear({ l: L, c: C, h: H }) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every(v => v >= -0.0005 && v <= 1.0005);

// Convierte a hex bajando el croma hasta que el color existe en pantalla
// (sRGB), en vez de recortar cada canal: así no cambia de matiz.
export function oklchToHex(color) {
  let { c } = color;
  let rgb = oklchToLinear({ ...color, c });
  for (let i = 0; i < 40 && !inGamut(rgb); i += 1) {
    c *= 0.94;
    rgb = oklchToLinear({ ...color, c });
  }
  return '#' + rgb
    .map(v => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0'))
    .join('');
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Fondos fijos del tema maestro (los mismos de index.css), para medir el
// contraste del acento como texto. Si cambian allá, cambian aquí.
export const PAGE_BG = { dark: '#0f0e13', light: '#f7f7f9' };
const INK_ON_LIGHT_ACCENT = '#16131d';

// Límites del acento por apariencia. Un color personalizado puede ser casi
// blanco, casi negro o gris: sin estos límites el botón principal desaparece
// contra el fondo o su texto deja de leerse. Se respeta el matiz siempre; la
// luminosidad y el croma se llevan al rango donde el acento funciona como
// acento. Los tres de fábrica ya caen dentro (no cambian).
const RANGES = {
  dark:  { fill: [0.53, 0.88], text: 0.82 },
  light: { fill: [0.46, 0.62], text: 0.5 },
};
const MIN_CHROMA = 0.09;
const MAX_CHROMA = 0.26;

// Variables CSS del acento para el panel (ThemedShell). Devuelve también si
// hubo que ajustar el color, para avisarlo en la pantalla de Tema.
export function accentTokens(hex, mode = 'dark') {
  const base = isHexColor(hex) ? hex : DEFAULT_CUSTOM_COLOR;
  const range = RANGES[mode] ?? RANGES.dark;
  const src = hexToOklch(base);
  const c = clamp(src.c, MIN_CHROMA, MAX_CHROMA);
  const l = clamp(src.l, range.fill[0], range.fill[1]);
  const fill = oklchToHex({ l, c, h: src.h });
  const hover = oklchToHex({ l: l + (mode === 'dark' ? 0.05 : -0.05), c, h: src.h });
  const active = oklchToHex({ l: l + (mode === 'dark' ? -0.04 : -0.09), c, h: src.h });
  // Texto sobre el botón: el de mayor contraste entre blanco y tinta oscura.
  const onAccent = contrastRatio(fill, '#ffffff') >= contrastRatio(fill, INK_ON_LIGHT_ACCENT) ? '#ffffff' : INK_ON_LIGHT_ACCENT;
  // El acento como texto (enlaces, etiqueta activa) sobre el fondo de página:
  // se aclara u oscurece hasta 4.5:1 como mínimo.
  const page = PAGE_BG[mode] ?? PAGE_BG.dark;
  let textL = range.text;
  let text = oklchToHex({ l: textL, c: Math.min(c, 0.17), h: src.h });
  for (let i = 0; i < 20 && contrastRatio(text, page) < 4.5; i += 1) {
    textL += mode === 'dark' ? 0.02 : -0.02;
    text = oklchToHex({ l: textL, c: Math.min(c, 0.17), h: src.h });
  }
  const adjusted = Math.abs(src.l - l) > 0.015 || Math.abs(src.c - c) > 0.015;
  return {
    adjusted,
    vars: {
      '--accent': fill,
      '--accent-hover': hover,
      '--accent-active': active,
      '--on-accent': onAccent,
      '--accent-text': text,
    },
  };
}
