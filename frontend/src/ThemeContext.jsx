import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'tkc_theme';
const RECENTS_KEY = 'tkc_theme_recents';
const DEFAULT_CUSTOM_COLOR = '#7C3AED';
const DEFAULT_THEME = { style: 'default', accent: 'purple', customColor: DEFAULT_CUSTOM_COLOR };
const MAX_RECENTS = 3;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Pedido explícito: se eliminan "Kawaii" y "Minimalista" de las opciones
// (quedan Clásico y Cute) y "Verde" de los acentos (quedan Morado/Azul/
// Rosa) — sus bloques de CSS por material/acento en index.css también se
// borraron, ya no hay ningún lugar que los use.
export const THEME_STYLES = [
  { id: 'default', label: 'Clásico', shortLabel: 'Clásico', hint: 'Glow nocturno' },
  { id: 'cute',    label: 'Cute',    shortLabel: 'Cute',    hint: 'Dulce y redondeado' },
];

export const THEME_ACCENTS = [
  { id: 'purple', label: 'Morado', swatch: '#7C3AED' },
  { id: 'blue',   label: 'Azul',   swatch: '#3B82F6' },
  { id: 'pink',   label: 'Rosa',   swatch: '#EC4899' },
];

const styleById  = Object.fromEntries(THEME_STYLES.map(s => [s.id, s]));
const accentById = Object.fromEntries(THEME_ACCENTS.map(a => [a.id, a]));

// Nombre de "skin" tal como lo ve el streamer: material + acento como una
// sola unidad elegible (ver wireframes-selector-de-skin.html) en vez de dos
// pasos de formulario separados.
export function skinName({ style, accent }) {
  const accentLabel = accent === 'custom' ? 'Personalizado' : (accentById[accent]?.label ?? accent);
  return `${styleById[style]?.shortLabel ?? style} ${accentLabel}`;
}

function sameSkin(a, b) {
  if (!a || !b || a.style !== b.style || a.accent !== b.accent) return false;
  // Dos skins "custom" son el mismo solo si además picaron el mismo color
  // — si no, un cambio de color no se aplicaría nunca (mismo style+accent).
  return a.accent === 'custom' ? a.customColor === b.customColor : true;
}

function isValidSkin(skin) {
  if (!skin || !THEME_STYLES.some(s => s.id === skin.style)) return false;
  if (skin.accent === 'custom') return HEX_COLOR_RE.test(skin.customColor || '');
  return THEME_ACCENTS.some(a => a.id === skin.accent);
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    if (!isValidSkin(parsed)) return DEFAULT_THEME;
    return { style: parsed.style, accent: parsed.accent, customColor: HEX_COLOR_RE.test(parsed.customColor || '') ? parsed.customColor : DEFAULT_CUSTOM_COLOR };
  } catch {
    return DEFAULT_THEME;
  }
}

function loadRecents(current) {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSkin).filter(s => !sameSkin(s, current)).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

const ThemeContext = createContext(null);

// Tema global (estilo + acento = "skin"), persistido en localStorage. Vive
// por encima de todo (incluso Login/Buy, antes de tener sesión) para que la
// elección se sienta consistente en toda la app — el ÚNICO lugar que
// deliberadamente NO lo usa es el Overlay de OBS (App.jsx no lo envuelve
// con <ThemedShell>), para no arriesgar la estabilidad de la captura.
export function ThemeProvider({ children }) {
  const [theme, setTheme]     = useState(loadTheme);
  const [previous, setPrevious] = useState(null); // último skin anterior, para "Volver al anterior" — no persiste entre sesiones
  const [recents, setRecents] = useState(() => loadRecents(loadTheme()));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  }, [recents]);

  // Elegí un skin completo (material + acento) de una — reemplaza al viejo
  // setStyle/setAccent de dos pasos. `customColor` solo importa cuando
  // `accent === 'custom'`; el resto del tiempo se sigue cargando el último
  // color elegido nada más para que, si vuelve a abrir el selector de
  // color personalizado, no arranque de nuevo en el valor por defecto.
  // Guarda el skin saliente como "anterior" (deshacer de un toque) y lo
  // suma a "últimos usados".
  const setSkin = (style, accent, customColor) => {
    setTheme(t => {
      const next = { style, accent, customColor: accent === 'custom' ? (customColor || t.customColor || DEFAULT_CUSTOM_COLOR) : t.customColor };
      if (sameSkin(t, next)) return t;
      setPrevious(t);
      // El skin saliente pasa a "últimos usados": se saca cualquier copia vieja
      // de sí mismo y del que se acaba de elegir (ya no es "reciente", es el actual).
      setRecents(r => [t, ...r.filter(s => !sameSkin(s, next) && !sameSkin(s, t))].slice(0, MAX_RECENTS));
      return next;
    });
  };

  // Alterna con el skin anterior — un toque para deshacer un cambio que no gustó.
  const revertToPrevious = () => {
    if (!previous) return;
    setSkin(previous.style, previous.accent, previous.customColor);
  };

  // Compat: algunos consumidores viejos podían llamar setStyle/setAccent por separado.
  const setStyle  = (style)  => setSkin(style, theme.accent, theme.customColor);
  const setAccent = (accent) => setSkin(theme.style, accent, theme.customColor);

  return (
    <ThemeContext.Provider value={{ ...theme, previous, recents, setSkin, setStyle, setAccent, revertToPrevious }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}

// El acento "Personalizado" no tiene su propio bloque `[data-accent="custom"]`
// con valores fijos como purple/blue/pink — el color lo elige el streamer,
// así que `--accent` se inyecta acá como variable CSS inline (gana
// automáticamente sobre cualquier regla de hoja de estilos, sin pelear con
// especificidad ni !important). `--accent-2`/`--accent-soft` SÍ tienen un
// único bloque fijo en index.css (`.themed-app[data-accent="custom"]`) que
// los deriva del `--accent` recién inyectado vía `oklch(from var(--accent)...)`
// — misma técnica que ya usa el resto del sistema de temas para el fondo de
// página, así que el resultado sigue el mismo criterio de contraste/tinte
// para cualquier color que el streamer elija, no solo los 3 preset.
// Devuelve `undefined` (no un objeto vacío) para los acentos preset, así se
// puede spread-ear tranquilo en un `style` sin agregar ruido.
export function accentStyleVars({ accent, customColor } = {}) {
  if (accent !== 'custom' || !customColor) return undefined;
  return { '--accent': customColor };
}

// Envuelve cualquier pantalla en el sistema de temas (data-theme-style +
// data-accent, que las variables CSS de index.css leen). No usar esto
// alrededor de <Overlay>. `styleOverride`/`accentOverride`/`customColorOverride`
// permiten previsualizar un skin sin tocar el tema real — los usa el
// probador en vivo del selector.
// `fitContent`: por defecto `.themed-app` fuerza min-height:100vh (piensa que
// es pantalla completa) — al previsualizar un skin adentro de otra pantalla
// (ej. el selector de tema) eso infla el contenedor a casi toda la altura de
// la ventana aunque adentro solo haya una tarjeta chica. `fitContent` lo
// desactiva para que el alto sea el del contenido real.
export function ThemedShell({ children, className = '', style, styleOverride, accentOverride, customColorOverride, fitContent = false }) {
  const { style: currentStyle, accent, customColor } = useTheme();
  const effectiveAccent = accentOverride ?? accent;
  const effectiveCustomColor = customColorOverride ?? customColor;
  return (
    <div
      className={`themed-app themed-panel ${className}`}
      style={{ ...(fitContent ? { minHeight: 0 } : null), ...accentStyleVars({ accent: effectiveAccent, customColor: effectiveCustomColor }), ...style }}
      data-theme-style={styleOverride ?? currentStyle}
      data-accent={effectiveAccent}
    >
      {children}
    </div>
  );
}
