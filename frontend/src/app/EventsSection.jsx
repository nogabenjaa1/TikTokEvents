import { Fragment } from 'react';
import { lazyPanel } from '../lazyPanel';
import Login from '../Login';
import ScrollRow from '../ScrollRow';
import SystemHealth from '../SystemHealth';
import MobileOverlayPreview from './MobileOverlayPreview';
import { EVENT_TABS, EVENT_TAB_GROUP_STARTS } from './navigation';

const AdminPanel = lazyPanel(() => import('../AdminPanel'));
const Zubastinis = lazyPanel(() => import('../Zubastinis'));
const Elimination = lazyPanel(() => import('../Elimination'));
const Roulette = lazyPanel(() => import('../Roulette'));
const Versus = lazyPanel(() => import('../Versus'));
const Extensible = lazyPanel(() => import('../Extensible'));
const Spotify = lazyPanel(() => import('../Spotify'));
const Goal = lazyPanel(() => import('../Goal'));
const AlertsAdmin = lazyPanel(() => import('../AlertsAdmin'));

// La sección "TikTokEvents": la subnavegación y el panel de la pestaña elegida. Cada panel que necesita sesión
// muestra el login embebido si no la hay (`needsAccess`). El estado en vivo llega de App.jsx.
export default function EventsSection({
  eventsTab, onSelectTab, socketConnected, connectionStatus, ttsEnabled, ttsEngine, needsAccess, onLoggedIn, onGoMembership,
  socket, username, giftsList, prize, activeApp, overlayTheme, overlayCustomization,
  state, zubState, elimState, rouletteState, extensibleState, versusState, goalState,
  spotifyQueueState, spotifySettingsState, spotifyOAuthResult, onOAuthResultConsumed,
  panelOverlayDraft, onCustomizeChange, onApplyToAll,
  soundEnabled, onSoundEnabledChange, alertsOverlayConnected, monitorSink, onMonitorSinkChange,
}) {
  return (
    <>
      {/* Subsidebar de TikTokEvents: horizontal y scrolleable para que
          entre igual de bien en mobile que el rail principal. */}
      <div className="flex items-center w-full min-w-0 px-3 py-3 flex-shrink-0 border-b" style={{ borderColor: 'var(--surface-border-color)' }}>
      <ScrollRow label="Eventos de TikTok">
        {EVENT_TABS.map((t) => (
          <Fragment key={t.id}>
          {EVENT_TAB_GROUP_STARTS.includes(t.id) && <span className="w-px h-5 flex-shrink-0 mx-1 bg-current opacity-20" aria-hidden="true" />}
          <button
            type="button"
            aria-current={eventsTab === t.id ? 'page' : undefined}
            data-events-tab-active={eventsTab === t.id ? 'true' : undefined}
            onClick={() => onSelectTab(t.id)}
            className={[
              'theme-nav-btn h-9 px-4 rounded-full border flex items-center gap-2 transition-all duration-200 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
              eventsTab === t.id ? 'theme-nav-btn-active' : 'bg-transparent border-transparent',
            ].join(' ')}
          >
            <span className="text-base leading-none" aria-hidden="true">{t.icon}</span>
            <span className={[ 'text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', eventsTab === t.id ? 'theme-accent-text' : 'text-gray-500' ].join(' ')}>
              {t.label}
            </span>
          </button>
          </Fragment>
        ))}
      </ScrollRow>
        <SystemHealth compact socketConnected={socketConnected} connectionStatus={connectionStatus} ttsEnabled={ttsEnabled} ttsEngine={ttsEngine} />
      </div>

      {eventsTab === 'king' && (
        needsAccess('king') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Rey del Trono." />
        ) : (
          <>
            <AdminPanel
              state={state} socket={socket}
              username={username} connectionStatus={connectionStatus} giftsList={giftsList}
              prize={prize}
            />
            <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
          </>
        )
      )}
      {eventsTab === 'zub' && (
        needsAccess('zub') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Zubastinis." />
        ) : (
          <>
            <Zubastinis
              state={zubState} socket={socket}
              username={username} connectionStatus={connectionStatus}
              prize={prize}
            />
            <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
          </>
        )
      )}
      {eventsTab === 'elim' && (
        needsAccess('elim') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Eliminación." />
        ) : (
          <>
            <Elimination
              state={elimState} socket={socket}
              username={username} connectionStatus={connectionStatus} giftsList={giftsList}
              prize={prize}
            />
            <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
          </>
        )
      )}
      {eventsTab === 'roulette' && (
        needsAccess('roulette') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Ruleta." />
        ) : (
          <>
            <Roulette
              state={rouletteState} socket={socket}
              username={username} connectionStatus={connectionStatus} giftsList={giftsList}
              prize={prize}
            />
            <MobileOverlayPreview state={state} zubState={zubState} elimState={elimState} rouletteState={rouletteState} activeApp={activeApp} prize={prize} theme={overlayTheme} customization={overlayCustomization} />
          </>
        )
      )}
      {eventsTab === 'versus' && (
        needsAccess('versus') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Versus." />
        ) : (
          <Versus
            state={versusState} socket={socket}
            username={username} connectionStatus={connectionStatus} giftsList={giftsList}
          />
        )
      )}
      {eventsTab === 'extensible' && (
        needsAccess('extensible') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Modo Extensible." />
        ) : (
          <Extensible
            state={extensibleState} socket={socket}
            username={username} connectionStatus={connectionStatus}
          />
        )
      )}
      {eventsTab === 'goal' && (
        needsAccess('goal') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar el Objetivo." />
        ) : (
          <Goal state={goalState} socket={socket} username={username} connectionStatus={connectionStatus} />
        )
      )}
      {eventsTab === 'spotify' && (
        needsAccess('spotify') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Spotify." />
        ) : (
          <Spotify
            socket={socket} queueState={spotifyQueueState} settingsState={spotifySettingsState}
            oauthResult={spotifyOAuthResult} onOAuthResultConsumed={onOAuthResultConsumed}
            onWantsMembership={onGoMembership}
          />
        )
      )}
      {/* Pedido explicito: el panel de configuración de Alertas se
          muda de "Overlays" (que ahora solo se queda con la URL/
          ayuda de OBS, ver OverlayLink.jsx) a TikTokEvents, junto al
          resto de los módulos que sí edita el streamer. */}
      {eventsTab === 'alerts' && (
        needsAccess('alerts') ? (
          <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar Alertas." />
        ) : (
          <AlertsAdmin
            giftsList={giftsList} socket={socket}
            customization={panelOverlayDraft.alerts}
            onCustomizeChange={(entry) => onCustomizeChange('alerts', entry)}
            onApplyToAll={() => onApplyToAll('alerts')}
            monitor={{
              enabled: soundEnabled, onEnabledChange: onSoundEnabledChange, overlayConnected: alertsOverlayConnected,
              sinkId: monitorSink.id, sinkLabel: monitorSink.label, onSinkChange: onMonitorSinkChange,
            }}
          />
        )
      )}
      {/* TTS también requiere sesión — se muestra el login embebido en
          su lugar sin desmontar TtsChat (ver comentario de "visible"
          más abajo, fuera de esta sección para que no se desmonte al
          cambiar de pestaña). */}
      {eventsTab === 'tts' && needsAccess('tts') && (
        <Login embedded onLoggedIn={onLoggedIn} onWantsMembership={onGoMembership} notice="Necesitas una licencia o una prueba gratis para usar TTS." />
      )}
    </>
  );
}
