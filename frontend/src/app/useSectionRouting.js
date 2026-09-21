import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SECTION_PATHS, EVENT_TAB_PATHS, sectionFromPath, sectionTitle } from './navigation';

// Mantiene sincronizados la sección/pestaña del panel y la barra de direcciones (más el título de la pestaña del
// navegador). `sidebarMode`/`eventsTab` siguen siendo el estado de siempre en App.jsx; esto solo habla con el router.
export default function useSectionRouting({ overlayMode, sidebarMode, setSidebarMode, eventsTab, setEventsTab }) {
  const location = useLocation();
  const navigate = useNavigate();

  // ── URLs reales para cada sección (pedido explícito) ──
  // sidebarMode/eventsTab siguen siendo el estado de siempre (todo el
  // render de más abajo sigue leyendo esas dos variables tal cual, sin
  // tocar ningún `setSidebarMode(...)`/`setEventsTab(...)` existente) --
  // estos dos efectos son los ÚNICOS que hablan con el router, en las dos
  // direcciones:
  //  1) estado -> URL: cada vez que cambian, empuja el pathname
  //     correspondiente (si no es ya ese) para que la barra de direcciones
  //     siempre refleje dónde está el streamer.
  //  2) URL -> estado: si el pathname cambia por afuera (atrás/adelante del
  //     navegador, un enlace externo), corrige sidebarMode/eventsTab para
  //     que coincidan.
  // Nunca se pisan en bucle: si ya coinciden, cada lado no hace nada (React
  // ya evita el re-render si el estado nuevo es idéntico al viejo). Se
  // corta temprano en modo overlay -- esa URL (?overlay=true&screen=...) es
  // la que ya está pegada en OBS de streamers reales, no se toca para nada.
  useEffect(() => {
    if (overlayMode) return;
    const targetPath = sidebarMode === 'events'
      ? `/${SECTION_PATHS.events}/${EVENT_TAB_PATHS[eventsTab] || EVENT_TAB_PATHS.king}`
      : `/${SECTION_PATHS[sidebarMode] || SECTION_PATHS.dashboard}`;
    if (location.pathname !== targetPath) navigate(targetPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayMode, sidebarMode, eventsTab]);

  // Bug real reportado ("conectar Spotify me manda al Dashboard y me apaga
  // el TTS"): la excepción de cameFromSpotifyOAuth de más arriba deja el
  // ESTADO inicial bien (events/spotify), pero el efecto de "estado -> URL"
  // de arriba todavía no alcanzó a actualizar `location.pathname` (el
  // navigate() de React Router recién se refleja en un re-render
  // posterior) cuando ESTE efecto corre en la misma tanda -- lee el
  // pathname viejo ("/"), lo traduce a 'dashboard' (la ruta desconocida
  // cae ahí, ver sectionFromPath) y pisa el estado recién puesto antes de
  // que el navigate() de arriba llegue a corregir la URL.
  // La condición de acá abajo salta ese instante puntual -- a propósito
  // compara `location.pathname` CON `location.search` (los dos de
  // useLocation, arriba), nunca mezclado con `window.location` directo:
  // `navigate()` llama a history.pushState de forma SÍNCRONA, así que
  // `window.location` ya refleja la URL nueva un instante antes de que
  // React vuelva a renderizar con el `location` de React Router
  // actualizado -- comparar uno ya corregido contra el otro todavía viejo
  // hacía que la condición nunca se cumpliera de verdad (bug real
  // encontrado armando este mismo fix). Atrás/adelante del navegador y
  // cualquier otra navegación real siguen andando normal -- esa
  // combinación puntual de pathname+query nunca vuelve a darse después de
  // la corrección.
  useEffect(() => {
    if (overlayMode) return;
    if (location.pathname === '/' && location.search.includes('spotify=')) return;
    const { section, tab } = sectionFromPath(location.pathname);
    setSidebarMode(section);
    if (section === 'events' && tab) setEventsTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayMode, location.pathname]);

  // La subnavegación de eventos se desplaza en pantallas angostas: al
  // cambiar de pestaña (o llegar por un enlace directo) la activa se centra
  // para que nunca quede escondida fuera de la vista.
  useEffect(() => {
    if (overlayMode || sidebarMode !== 'events') return;
    document.querySelector('[data-events-tab-active="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [overlayMode, sidebarMode, eventsTab]);

  // Título de la pestaña del navegador (pedido explícito: que siempre sea
  // visible en qué sección está, no un "TikTokEvents" fijo sin importar
  // dónde navegue).
  useEffect(() => {
    if (overlayMode) return;
    document.title = sectionTitle(sidebarMode, eventsTab);
  }, [overlayMode, sidebarMode, eventsTab]);
}
