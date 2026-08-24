import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'tkc_theme';
const DEFAULT_THEME = { style: 'default', accent: 'purple' };

export const THEME_STYLES = [
  { id: 'default', label: 'Default',      hint: 'El look actual, sin cambios.' },
  { id: 'glass',   label: 'Glassmorfismo', hint: 'Paneles translúcidos con blur.' },
  { id: 'minimal', label: 'Minimalista',   hint: 'Plano, sin sombras ni bordes suaves.' },
  { id: 'clay',    label: 'Claymorfismo',  hint: 'Superficies "inflables" con sombra doble.' },
];

export const THEME_ACCENTS = [
  { id: 'purple', label: 'Morado', swatch: '#7C3AED' },
  { id: 'blue',   label: 'Azul',   swatch: '#3B82F6' },
  { id: 'pink',   label: 'Rosa',   swatch: '#EC4899' },
  { id: 'green',  label: 'Verde',  swatch: '#10B981' },
];

const ThemeContext = createContext(null);

function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return {
      style: THEME_STYLES.some(s => s.id === parsed.style) ? parsed.style : DEFAULT_THEME.style,
      accent: THEME_ACCENTS.some(a => a.id === parsed.accent) ? parsed.accent : DEFAULT_THEME.accent,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

// Tema global (estilo + acento), persistido en localStorage. Vive por
// encima de todo (incluso Login/Buy, antes de tener sesión) para que la
// elección se sienta consistente en toda la app — el ÚNICO lugar que
// deliberadamente NO lo usa es el Overlay de OBS (App.jsx no lo envuelve
// con <ThemedShell>), para no arriesgar la estabilidad de la captura.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  const setStyle  = (style)  => setTheme(t => ({ ...t, style }));
  const setAccent = (accent) => setTheme(t => ({ ...t, accent }));

  return (
    <ThemeContext.Provider value={{ ...theme, setStyle, setAccent }}>
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
// alrededor de <Overlay>.
export function ThemedShell({ children, className = '' }) {
  const { style, accent } = useTheme();
  return (
    <div className={`themed-app ${className}`} data-theme-style={style} data-accent={accent}>
      {children}
    </div>
  );
}
