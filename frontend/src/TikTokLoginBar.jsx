
// Tarjeta de conexión a TikTok -- pedido explícito: antes era una barra
// flotante fija en la esquina superior derecha, visible en CUALQUIER
// pestaña de TikTokEvents (Rey del Trono, Zubastinis, etc.), y eso
// "estorbaba" al navegar entre ellas sin tener todavía una conexión hecha.
// Ahora vive SOLO en el Dashboard, embebida en su propia tarjeta "Conexión
// a TikTok" (ver Dashboard.jsx) -- ya no flota ni se desliza fuera de
// pantalla, es una tarjeta normal más del panel. La conexión en sí
// (username/connectionStatus, en App.jsx) sigue viva igual aunque esta
// tarjeta no esté montada -- desmontarla no la corta, el streamer solo deja
// de VER el control mientras navega por otra sección.
//
// connectionStatus: idle | checking | error | connecting | connected
//   connecting = el username existe pero todavía no se confirmó el live.
//   connected  = conexión live confirmada.
export default function TikTokLoginBar({ username, setUsername, connectionStatus, connectionError, disabled, onDisconnect }) {
  const live = connectionStatus === 'connected';
  const verifying = connectionStatus === 'connecting';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
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
      <div className="flex items-center gap-1.5">
        {/* El mismo punto se transforma según el estado (ver .tkc-status-dot):
            aro gris sin conexión, arco girando mientras busca o conecta y
            punto lleno con halo al confirmar el LIVE. */}
        <span
          className={`tkc-status-dot ${live ? 'text-green-400' : (verifying || connectionStatus === 'checking') ? 'text-yellow-400' : connectionStatus === 'error' ? 'text-red-400' : 'text-gray-500'}`}
          data-status={live ? 'success' : (verifying || connectionStatus === 'checking') ? 'loading' : 'idle'}
          aria-hidden="true"
        />
        <span key={connectionStatus} className={`tkc-msg-enter text-[10px] font-bold uppercase tracking-widest flex-1 ${live ? 'text-green-400' : verifying ? 'text-yellow-400' : 'text-gray-500'}`}>
          {live ? 'Conectado en vivo' : verifying ? 'Conectando en vivo...' : connectionStatus === 'checking' ? 'Buscando la cuenta...' : connectionStatus === 'error' ? 'Error de conexión' : 'Sin conexión en vivo'}
        </span>
      </div>
      {/* Desconexión explícita, a mano -- la conexión persiste sola entre
          recargas (ver App.jsx), así que hace falta una forma clara de
          cortarla cuando SÍ se quiere, en vez de solo "borrar el campo"
          (que sigue funcionando igual). Solo tiene sentido mientras hay
          algo conectado o intentándolo. */}
      {(live || verifying) && !disabled && (
        <button onClick={onDisconnect} className="theme-btn-secondary theme-btn-sm w-full font-black uppercase tracking-widest text-red-400 hover:text-red-300">
          ⏻ Desconectar
        </button>
      )}
      {connectionStatus === 'error' && connectionError && (
        <p className="text-[10px] leading-snug text-red-300 tkc-msg-enter" role="alert">{connectionError}</p>
      )}
    </div>
  );
}
