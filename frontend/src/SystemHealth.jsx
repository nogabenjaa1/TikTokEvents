
// Indicador de salud del sistema (mejora de estabilidad): en un vistazo, si
// el panel está hablando con el servidor, si hay un LIVE conectado y si el
// motor de voz anda. Sirve para saber POR QUÉ algo no está leyendo/sonando
// sin tener que adivinar. `compact` = solo los puntos (barra de eventos);
// completo = filas con texto y botones de acción (Dashboard).
//
// estados: 'ok' | 'warn' | 'bad' | 'off'
const DOT = {
  ok: 'bg-green-400',
  warn: 'bg-yellow-400 animate-pulse',
  bad: 'bg-red-500 animate-pulse',
  off: 'bg-gray-500',
};

function buildItems({ socketConnected, connectionStatus, ttsEnabled, ttsEngine }) {
  const server = socketConnected
    ? { state: 'ok', text: 'Conectado al servidor' }
    : { state: 'bad', text: 'Sin conexión con el servidor — reconectando...' };

  let live;
  if (connectionStatus === 'connected') live = { state: 'ok', text: 'LIVE de TikTok conectado' };
  else if (connectionStatus === 'connecting' || connectionStatus === 'checking') live = { state: 'warn', text: 'Conectando con tu LIVE...' };
  else if (connectionStatus === 'error') live = { state: 'bad', text: 'No se pudo conectar con tu LIVE' };
  else live = { state: 'off', text: 'Sin LIVE conectado' };

  let voice;
  if (!ttsEnabled) voice = { state: 'off', text: 'Voz (TTS) apagada' };
  else if (ttsEngine === 'recovered') voice = { state: 'warn', text: 'La voz se trabó y se recuperó sola' };
  else if (ttsEngine === 'speaking') voice = { state: 'ok', text: 'Voz leyendo un mensaje' };
  else voice = { state: 'ok', text: 'Voz lista y escuchando el chat' };

  return [
    { id: 'server', label: 'Servidor', ...server },
    { id: 'live', label: 'TikTok LIVE', ...live },
    { id: 'voice', label: 'Voz', ...voice },
  ];
}

export default function SystemHealth({
  socketConnected, connectionStatus, ttsEnabled, ttsEngine,
  onResetVoice, onReconnectTikTok, compact = false,
}) {
  const items = buildItems({ socketConnected, connectionStatus, ttsEnabled, ttsEngine });

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-shrink-0 pl-3 ml-auto" role="group" aria-label="Estado del sistema">
        {items.map((item) => (
          <span key={item.id} className="flex items-center gap-1.5" title={`${item.label}: ${item.text}`}>
            <span className={`w-2 h-2 rounded-full ${DOT[item.state]}`} aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hidden lg:inline">{item.label}</span>
            <span className="sr-only">{`${item.label}: ${item.text}`}</span>
          </span>
        ))}
      </div>
    );
  }

  const canReconnect = connectionStatus === 'connected' || connectionStatus === 'connecting' || connectionStatus === 'error';

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Estado del sistema">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[item.state]}`} aria-hidden="true" />
          <span className="text-[11px] text-gray-400 leading-snug"><span className="font-bold text-white">{item.label}:</span> {item.text}</span>
        </div>
      ))}
      {(ttsEnabled || canReconnect) && (
        <div className="flex gap-2 mt-1 flex-wrap">
          {canReconnect && onReconnectTikTok && (
            <button type="button" onClick={onReconnectTikTok} className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest" title="Vuelve a conectar con tu LIVE sin perder rankings ni partidas">
              🔄 Reconectar TikTok
            </button>
          )}
          {ttsEnabled && onResetVoice && (
            <button type="button" onClick={onResetVoice} className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest" title="Reinicia el motor de voz si dejó de leer">
              🔊 Reiniciar voz
            </button>
          )}
        </div>
      )}
    </div>
  );
}
