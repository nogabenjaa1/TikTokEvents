import { bordersOffStyle, getUsernameOverride, resolveBackgroundStyle } from '../overlayCustomization';

// SPOTIFY: cola de canciones pedidas por chat (!play) — mismo criterio que
// Top Tap-Tap/Top Gifter (sin panel/fondo propio, alto fijo de 700px
// anclado arriba en vez de centrado, para no reubicarse en la pantalla al
// sumar una canción). El backend ya limita a las últimas 8 (ver
// SPOTIFY_QUEUE_DISPLAY_SIZE).
// `playing` (marcado por el polling de tenant.js contra la cola REAL de
// Spotify, ver pollSpotifyQueue) resalta cuál está sonando ahora mismo —
// las demás son lo que sigue. La lista se actualiza sola cuando el backend
// detecta que Spotify avanzó (canción terminada o saltada con !skip): esa
// entrada desaparece de acá sin que el overlay tenga que hacer nada además
// de escuchar el socket, ya viene filtrada desde tenant.js.
// Fila individual de canción — compartida entre "now playing" y las
// próximas pedidas por chat, a propósito (pedido explícito: mismo estilo y
// formato para las dos, solo se distinguen por el borde/glow verde + la
// insignia "Sonando" de la que está sonando ahora).
function SpotifySongRow({ song, playing, customize, rowBg, nameOverride }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2 border ${playing ? 'shadow-[0_0_15px_rgba(34,197,94,0.35)]' : ''}`}
      style={playing ? { borderColor: '#22c55e', ...rowBg } : { borderColor: 'var(--surface-border-color)', ...rowBg }}
    >
      {song.albumArt
        ? <img src={song.albumArt} className="w-9 h-9 rounded object-cover flex-shrink-0" />
        : <span className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0 text-sm" style={{ background: 'var(--surface-bg-alt)', ...bordersOffStyle(customize) }}>🎵</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white truncate">{song.title}</p>
        <p className="text-[10px] text-gray-400 truncate">
          {song.artist}
          {/* requestedBy puede venir null: el streamer la puso a mano, sin
              pedido de por medio (pedido explícito: "now playing" debe
              funcionar aunque nadie haya usado !play) — en ese caso no hay
              "pedido por @..." que mostrar. */}
          {song.requestedBy && <> · pedido por <span className={nameOverride.className} style={nameOverride.cssVars}>@{song.requestedBy}</span></>}
        </p>
      </div>
      {playing && (
        <span className="text-[9px] font-black uppercase tracking-widest text-green-400 flex items-center gap-1 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Sonando
        </span>
      )}
    </div>
  );
}

// Pedido explícito: el overlay nunca debe quedar vacío — antes solo
// mostraba algo si había pedidos por !play en curso, así que en cuanto se
// reproducían todos quedaba en blanco. Ahora `state.nowPlaying` (ver
// pollSpotifyQueue en tenant.js) refleja lo que suena AHORA en Spotify de
// verdad, lo haya pedido alguien por chat o no; `state.queue` son las
// próximas pedidas por chat, mostradas debajo con su propio separador.
export function SpotifyQueueOverlay({ state, customize }) {
  const nowPlaying = (state && state.nowPlaying) || null;
  const queue = (state && state.queue) || [];
  // Mismo fix que Top Tap-Tap/Top Gifter: la fila (única superficie visible
  // acá, sin marco propio) usa la personalización de fondo elegida en vez
  // de un `var(--surface-bg-alt)` fijo — la canción "Sonando" solo se
  // distingue por el borde/glow verde, no por un fondo distinto.
  const rowBg = resolveBackgroundStyle(customize, 'var(--surface-bg-alt)');
  const nameOverride = getUsernameOverride(customize);
  return (
    <div className="w-[380px] h-[700px] p-5 flex flex-col gap-3 font-sans">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black text-center flex-shrink-0">🎵 Playlist</p>

      {nowPlaying ? (
        <SpotifySongRow song={nowPlaying} playing customize={customize} rowBg={rowBg} nameOverride={nameOverride} />
      ) : (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2 border" style={{ borderColor: 'var(--surface-border-color)', ...rowBg }}>
          <span className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0 text-sm" style={{ background: 'var(--surface-bg-alt)', ...bordersOffStyle(customize) }}>🎵</span>
          <p className="text-xs italic text-gray-500">Esperando canción...</p>
        </div>
      )}

      {queue.length > 0 && (
        <>
          <p className="text-[9px] uppercase tracking-widest text-gray-500 font-bold flex-shrink-0">Siguientes:</p>
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
            {queue.map((song) => (
              <SpotifySongRow key={song.id} song={song} playing={false} customize={customize} rowBg={rowBg} nameOverride={nameOverride} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
