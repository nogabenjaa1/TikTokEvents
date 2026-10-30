// Medidas reales de cada overlay y fondos de referencia de la vista previa.
// Aparte de OverlayPreviewBox.jsx para que ese archivo solo exporte
// componentes (lo pide el refresco en caliente de Vite).
import { CHAT_OVERLAY_SIZE } from './chatOverlayModel';

// Tamaño real (sin escalar) de cada overlay — mismos valores que sus
// propios w-[...]/h-[...] en Overlay.jsx/DiceOverlay.jsx, ya estandarizados
// (pedido explícito): 380x700 para todos los verticales (el chat ahora es
// horizontal, 960x480), 960x260 para los
// dos horizontales (Colores y Extensible ya compartían esa medida entre
// sí — se mantiene, cambiarla implicaría rediseñar su layout interno, que
// está pensado para una franja ancha y baja tipo "barra de subathon", no
// para una proporción más cuadrada). Se usan para escalar la vista previa
// a un tamaño que entre en el modal sin dejar espacio en blanco de más ni
// recortar nada.
export const NATURAL_SIZE = {
  games: { w: 380, h: 700 },
  colors: { w: 960, h: 260 },
  extensible: { w: 960, h: 260 },
  taptap: { w: 380, h: 700 },
  gifter: { w: 380, h: 700 },
  musicqueue: { w: 380, h: 700 },
  goal: { w: 960, h: 260 },
  chat: CHAT_OVERLAY_SIZE,
  ticker: { w: 960, h: 200 },
  versus: { w: 900, h: 420 },
};

// Fondo de referencia detrás de la vista previa: el overlay se compone sobre
// la escena real de OBS, que puede ser oscura o clara. Con "Transparente" el
// resultado depende por completo de lo que haya detrás, así que se puede ver
// sobre los tres casos típicos. La cuadrícula es la convención de "aquí no hay
// fondo" de los editores de imagen.
export const PREVIEW_BACKDROPS = {
  dark: { label: 'Oscuro', style: { background: '#0A0614' } },
  light: { label: 'Claro', style: { background: '#F1EEF6' } },
  checker: { label: 'Cuadrícula', style: { background: 'repeating-conic-gradient(#C9C3D6 0% 25%, #F4F2F8 0% 50%) 50% / 16px 16px' } },
};

