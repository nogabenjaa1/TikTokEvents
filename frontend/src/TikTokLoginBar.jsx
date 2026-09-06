import React from 'react';

// Barra de conexión TikTok, compartida por todos los módulos (Rey del
// Trono, Zubastinis, Eliminación y cualquier futuro módulo que necesite
// escuchar regalos del mismo usuario en vivo). En desktop (md:) queda fija
// en la esquina superior derecha, como siempre; en mobile no hay espacio
// libre para flotar sobre el contenido, así que pasa a ser una barra
// normal arriba de todo (ver el flex-col del contenedor en App.jsx).
//
// connectionStatus: idle | checking | error | connecting | connected
//   connecting = el username existe pero todavía no se confirmó el live.
//   connected  = conexión live confirmada.
export default function TikTokLoginBar({ username, setUsername, connectionStatus, connectionError, disabled, onDisconnect }) {
  const live = connectionStatus === 'connected';
  const verifying = connectionStatus === 'connecting';

  return (
    <>
      <div
        className={[
          'theme-surface tkc-mobile-flush w-full md:fixed md:top-4 md:right-4 md:z-50 md:w-64 p-4 flex-shrink-0',
          // Pedido explícito: en desktop chocaba con el botón "Refrescar
          // overlays" de la pestaña Overlays (mismo rincón superior derecho,
          // ver OverlayLink.jsx) — se desliza fuera de la vista apenas la
          // conexión con TikTok queda confirmada (ya no hace falta mirarla,
          // ver el botón "Off" redondo de abajo para ese estado) y reaparece
          // solo si se corta. Solo en desktop (md:): en mobile es una barra
          // normal dentro del flujo, sin ese choque, así que se deja tal
          // cual (con su propio botón "Desconectar" siempre a mano ahí).
          // `pointer-events-none` mientras está oculta evita que el input
          // siga siendo clickeable fuera de la pantalla.
          'transition-all duration-500 ease-in-out',
          live ? 'md:opacity-0 md:pointer-events-none md:translate-x-[400px]' : 'md:opacity-100 md:translate-x-0',
        ].join(' ')}
      >
        <div className="flex justify-between items-center mb-2">
          <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">Usuario de TikTok</label>
          {connectionStatus === 'checking' && <span className="text-[10px] text-yellow-400 animate-pulse">Buscando...</span>}
          {connectionStatus === 'error'     && <span className="text-[10px] text-red-400 font-bold">❌</span>}
          {(verifying || live)              && <span className="text-[10px] text-green-400 font-bold">✅</span>}
        </div>
        <input
          className={`theme-input w-full p-2.5 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          value={username}
          onChange={e => !disabled && setUsername(e.target.value)}
          placeholder="usuario de TikTok"
          readOnly={disabled}
        />
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${live ? 'bg-green-400 animate-pulse' : verifying ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-[10px] font-bold uppercase tracking-widest flex-1 ${live ? 'text-green-400' : verifying ? 'text-yellow-400' : 'text-gray-500'}`}>
            {live ? 'Conectado en vivo' : verifying ? 'Conectando en vivo...' : connectionStatus === 'error' ? 'Error de conexión' : 'Sin conexión en vivo'}
          </span>
          {/* Desconexión explícita, a mano — pedido explícito: la conexión
              ahora persiste sola entre recargas (ver App.jsx), así que hace
              falta una forma clara de cortarla cuando SÍ se quiere, en vez
              de solo "borrar el campo" (que sigue funcionando igual, esto
              es lo mismo con un botón más obvio). Solo tiene sentido
              mientras hay algo conectado o intentándolo. */}
          {(live || verifying) && !disabled && (
            <button onClick={onDisconnect} className="text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 flex-shrink-0">
              Desconectar
            </button>
          )}
        </div>
        {connectionStatus === 'error' && connectionError && (
          <p className="mt-2 text-[10px] leading-snug text-red-300" role="alert">{connectionError}</p>
        )}
      </div>

      {/* Botón "Off": lo único que queda visible en desktop una vez
          conectado (la barra completa de arriba se deslizó fuera) — pedido
          explícito: nada de píldora con texto, solo un botón rojo chico
          para desconectar. Redondo y mínimo (36px) a propósito: por más
          angosta que se hiciera una píldora con texto, seguía cayendo en
          el mismo rincón superior derecho que "Refrescar overlays" en
          ciertos anchos de pantalla — ver OverlayLink.jsx, que además
          movió ese botón fuera de esta franja superior para sacarse el
          choque de encima desde el otro lado también. El username va en
          el `title` (tooltip nativo al pasar el mouse), no visible todo el
          tiempo. */}
      <button
        onClick={disabled ? undefined : onDisconnect}
        disabled={disabled}
        title={disabled ? `Conectado a @${username}` : `Conectado a @${username} — clic para desconectar`}
        className={[
          'hidden md:flex fixed top-4 right-4 z-50 w-9 h-9 rounded-full items-center justify-center',
          'bg-red-600 hover:bg-red-500 text-white text-xs font-black shadow-lg shadow-red-950/50',
          'transition-all duration-500 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed',
          live ? 'opacity-100 translate-x-0' : 'opacity-0 pointer-events-none translate-x-[130%]',
        ].join(' ')}
      >
        ⏻
      </button>
    </>
  );
}
