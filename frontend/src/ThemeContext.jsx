import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'tkc_theme';
const RECENTS_KEY = 'tkc_theme_recents';
const DEFAULT_THEME = { style: 'default', accent: 'purple' };
const MAX_RECENTS = 3;

export const THEME_STYLES = [
  { id: 'default', label: 'Clásico',      shortLabel: 'Clásico', hint: 'Glow nocturno' },
  { id: 'kawaii',  label: 'Kawaii',        shortLabel: 'Kawaii',  hint: 'Pastel, esponjoso' },
  { id: 'minimal', label: 'Minimalista',   shortLabel: 'Minimal', hint: 'Plano, sin cajas' },
  { id: 'cute',    label: 'Cute',          shortLabel: 'Cute',    hint: 'Dulce y redondeado' },
];

export const THEME_ACCENTS = [
  { id: 'purple', label: 'Morado', swatch: '#7C3AED' },
  { id: 'blue',   label: 'Azul',   swatch: '#3B82F6' },
  { id: 'pink',   label: 'Rosa',   swatch: '#EC4899' },
  { id: 'green',  label: 'Verde',  swatch: '#10B981' },
];

const styleById  = Object.fromEntries(THEME_STYLES.map(s => [s.id, s]));
const accentById = Object.fromEntries(THEME_ACCENTS.map(a => [a.id, a]));

// Nombre de "skin" tal como lo ve el streamer: material + acento como una
// sola unidad elegible (ver wireframes-selector-de-skin.html) en vez de dos
// pasos de formulario separados.
export function skinName({ style, accent }) {
  return `${styleById[style]?.shortLabel ?? style} ${accentById[accent]?.label ?? accent}`;
}

function sameSkin(a, b) {
  return !!a && !!b && a.style === b.style && a.accent === b.accent;
}

function isValidSkin(skin) {
  return !!skin && THEME_STYLES.some(s => s.id === skin.style) && THEME_ACCENTS.some(a => a.id === skin.accent);
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return isValidSkin(parsed) ? { style: parsed.style, accent: parsed.accent } : DEFAULT_THEME;
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
  // setStyle/setAccent de dos pasos. Guarda el skin saliente como "anterior"
  // (deshacer de un toque) y lo suma a "últimos usados".
  const setSkin = (style, accent) => {
    setTheme(t => {
      const next = { style, accent };
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
    setSkin(previous.style, previous.accent);
  };

  // Compat: algunos consumidores viejos podían llamar setStyle/setAccent por separado.
  const setStyle  = (style)  => setSkin(style, theme.accent);
  const setAccent = (accent) => setSkin(theme.style, accent);

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

// Envuelve cualquier pantalla en el sistema de temas (data-theme-style +
// data-accent, que las variables CSS de index.css leen). No usar esto
// alrededor de <Overlay>. `styleOverride`/`accentOverride` permiten previsualizar
// un skin sin tocar el tema real — los usa el probador en vivo del selector.
// `fitContent`: por defecto `.themed-app` fuerza min-height:100vh (piensa que
// es pantalla completa) — al previsualizar un skin adentro de otra pantalla
// (ej. el selector de tema) eso infla el contenedor a casi toda la altura de
// la ventana aunque adentro solo haya una tarjeta chica. `fitContent` lo
// desactiva para que el alto sea el del contenido real.
export function ThemedShell({ children, className = '', style, styleOverride, accentOverride, fitContent = false }) {
  const { style: currentStyle, accent } = useTheme();
  return (
    <div
      className={`themed-app ${className}`}
      style={fitContent ? { minHeight: 0, ...style } : style}
      data-theme-style={styleOverride ?? currentStyle}
      data-accent={accentOverride ?? accent}
    >
      {children}
    </div>
  );
}
