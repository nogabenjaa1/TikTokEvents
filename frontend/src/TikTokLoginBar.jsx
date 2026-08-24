import React from 'react';

// Barra de conexión TikTok, fija en la esquina superior derecha, compartida
// por todos los módulos (Rey del Trono, Zubastinis, Eliminación y cualquier
// futuro módulo que necesite escuchar regalos del mismo usuario en vivo).
//
// connectionStatus: idle | checking | error | connecting | connected
//   connecting = el username existe pero todavía no se confirmó el live.
//   connected  = conexión live confirmada.
export default function TikTokLoginBar({ username, setUsername, connectionStatus, disabled }) {
  const live = connectionStatus === 'connected';
  const verifying = connectionStatus === 'connecting';

  return (
    <div className="theme-surface fixed top-4 right-4 z-50 w-64 p-4">
      <div className="flex justify-between items-center mb-2">
        <label className="theme-label text-[10px] uppercase tracking-widest font-semibold">TikTok Username</label>
        {connectionStatus === 'checking' && <span className="text-[10px] text-yellow-400 animate-pulse">Buscando...</span>}
        {connectionStatus === 'error'     && <span className="text-[10px] text-red-400 font-bold">❌</span>}
        {(verifying || live)              && <span className="text-[10px] text-green-400 font-bold">✅</span>}
      </div>
      <input
        className={`theme-input w-full p-2.5 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        value={username}
        onChange={e => !disabled && setUsername(e.target.value)}
        placeholder="username"
        readOnly={disabled}
      />
      <div className="flex items-center gap-1.5 mt-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${live ? 'bg-green-400 animate-pulse' : verifying ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className={`text-[10px] font-bold uppercase tracking-widest ${live ? 'text-green-400' : verifying ? 'text-yellow-400' : 'text-gray-500'}`}>
          {live ? 'Conectado en vivo' : verifying ? 'Conectando en vivo...' : 'Sin conexión en vivo'}
        </span>
      </div>
    </div>
  );
}
