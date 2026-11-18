import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { readStorage, writeStorage } from './safeStorage';
import { normalizeTheme, sameTheme, accentHex, accentTokens, DEFAULT_CUSTOM_COLOR } from './themeModel';

// Tema del panel: un solo diseño (el tema maestro) más el color de acento que
// elige el streamer. Ver themeModel.js.
const STORAGE_KEY = 'tkc_theme';
// Apariencia (claro / oscuro / automático según el sistema): preferencia de
// ESTE navegador que solo afecta al panel. El overlay de OBS no la lee, así que
// lo que ve la audiencia no cambia.
const MODE_KEY = 'tkc_theme_mode';
export const THEME_MODES = [
  { id: 'dark',  label: 'Oscuro',     hint: 'La cabina de siempre, ideal junto a OBS' },
  { id: 'light', label: 'Claro',      hint: 'Para salas muy iluminadas' },
  { id: 'auto',  label: 'Automático', hint: 'Sigue el modo de tu sistema' },
];
// Oscuro de fábrica: el panel se usa al lado de OBS y de la vista del directo,
// casi siempre de noche o con la luz de la sala baja. Quien ya eligió una
// apariencia antes la conserva (se lee de MODE_KEY).
const DEFAULT_MODE = 'dark';
// "Últimos usados" y el material del selector anterior: ya no existen. Se borra
// la clave para no dejar datos huérfanos en el navegador.
const LEGACY_RECENTS_KEY = 'tkc_theme_recents';

function loadMode() {
  const saved = readStorage(MODE_KEY);
  return THEME_MODES.some(m => m.id === saved) ? saved : DEFAULT_MODE;
}

function loadTheme() {
  try {
    return normalizeTheme(JSON.parse(readStorage(STORAGE_KEY) || 'null'));
  } catch {
    return normalizeTheme(null);
  }
}

// ¿El sistema está en modo oscuro? Se re-evalúa solo cuando el sistema cambia
// (por ejemplo, el cambio automático de tarde/noche de Windows y macOS).
function useSystemDark() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const onChange = (event) => setDark(event.matches);
    setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark;
}

const ThemeContext = createContext(null);

// Vive por encima de todo (incluso Login, antes de tener sesión). El overlay de
// OBS no lo usa: su tema le llega por socket (ver App.jsx).
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(loadTheme);
  const [mode, setModeState] = useState(loadMode);
  const systemDark = useSystemDark();
  const resolvedMode = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;

  const setMode = (next) => {
    if (!THEME_MODES.some(m => m.id === next)) return;
    setModeState(next);
    writeStorage(MODE_KEY, next);
  };

  useEffect(() => {
    // Se guarda ya normalizado: quien tenía Cute queda migrado en este navegador.
    writeStorage(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    try { localStorage.removeItem(LEGACY_RECENTS_KEY); } catch { /* sin almacenamiento: nada que borrar */ }
  }, []);

  // Elige el acento. `customColor` solo cuenta con accent === 'custom'; con un
  // acento de fábrica se conserva el último color propio para que el selector
  // no arranque de cero si vuelve a Personalizado.
  const setAccent = (accent, customColor) => {
    setTheme(t => {
      const next = normalizeTheme({ accent, customColor: accent === 'custom' ? (customColor || t.customColor || DEFAULT_CUSTOM_COLOR) : t.customColor });
      return sameTheme(t, next) ? t : next;
    });
  };

  return (
    <ThemeContext.Provider value={{ ...theme, setAccent, mode, resolvedMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}

// Acento "Personalizado" de los overlays de OBS y sus vistas previas: su
// `--accent` se inyecta inline (los de fábrica tienen su bloque en index.css).
// Devuelve `undefined` con un acento de fábrica para poder hacer spread en un
// `style` sin ruido. El panel no lo usa: ThemedShell pone sus propias variables.
export function accentStyleVars({ accent, customColor } = {}) {
  if (accent !== 'custom' || !customColor) return undefined;
  return { '--accent': customColor };
}

// Envuelve una pantalla del panel en el tema maestro. Las variables del acento
// (relleno, hover, presionado, texto encima y acento como texto) se calculan
// aquí para la apariencia activa, dentro de los límites de themeModel.js: con
// cualquier color, el botón principal y los textos de acento se leen.
// `accentOverride`/`customColorOverride`: vista previa sin tocar el tema real.
// `fitContent`: sin el alto mínimo de pantalla completa.
export function ThemedShell({ children, className = '', style, accentOverride, customColorOverride, fitContent = false }) {
  const { accent, customColor, resolvedMode } = useTheme();
  const hex = accentHex({ accent: accentOverride ?? accent, customColor: customColorOverride ?? customColor });
  const accentVars = useMemo(() => accentTokens(hex, resolvedMode).vars, [hex, resolvedMode]);
  return (
    <div
      className={`themed-app themed-panel ${className}`}
      style={{ ...(fitContent ? { minHeight: 0 } : null), ...accentVars, ...style }}
      data-theme-style="master"
      data-mode={resolvedMode}
    >
      {children}
    </div>
  );
}
