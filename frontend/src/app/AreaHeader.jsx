import ScrollRow from '../ScrollRow';
import SystemHealth from '../SystemHealth';
import { NAV_AREAS, AREA_TABS, TAB_LABELS } from './navigation';
import { EventStatusDot } from './EventStatusBadge';

// Encabezado de un área de Directo (Juegos, Alertas y chat, Metas y tiempo):
// el nombre del área, sus pestañas (con el punto de estado de cada evento) y
// el estado del servidor, TikTok y la voz. Antes había una sola barra de 11
// pestañas para tres tipos de cosas distintas, sin título.
export default function AreaHeader({ area, activeTab, onSelectTab, eventStatuses = {}, socketConnected, connectionStatus, ttsEnabled, ttsEngine }) {
  const info = NAV_AREAS.find((a) => a.id === area);
  const tabs = AREA_TABS[area] || [];
  return (
    <div className="tkc-area-head">
      <h1 className="tkc-area-title">{info?.label}</h1>
      <SystemHealth compact socketConnected={socketConnected} connectionStatus={connectionStatus} ttsEnabled={ttsEnabled} ttsEngine={ttsEngine} />
      <div className="tkc-area-tabs">
        <ScrollRow label={info?.label} activeKey={activeTab} indicatorClassName="tkc-tab-indicator">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={activeTab === id ? 'page' : undefined}
              data-events-tab-active={activeTab === id ? 'true' : undefined}
              onClick={() => onSelectTab(id)}
              className="theme-nav-btn tkc-nav-item tkc-tab"
            >
              <span className="tkc-tab-label">{TAB_LABELS[id]}</span>
              <EventStatusDot status={eventStatuses[id]} />
            </button>
          ))}
        </ScrollRow>
      </div>
    </div>
  );
}
