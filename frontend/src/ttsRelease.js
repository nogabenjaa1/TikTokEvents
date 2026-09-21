// Avisa al servidor cuando el TTS terminó con un mensaje del chat.
//
// Si un comentario trae un sticker con alerta, el servidor la deja esperando a que la voz termine
// de leerlo (`holdsAlert` en el mensaje). El TTS corre aquí, en el navegador, así que el servidor no
// puede saber cuándo acaba: tiene que avisarlo el panel. Se avisa SIEMPRE que el mensaje deja de
// estar pendiente, sea por lo que sea (se leyó, falló el motor, venció en la cola, se vació la
// cola, o ni siquiera se iba a leer), para que la alerta nunca se quede esperando de más.
//
// `emit` manda un evento por el socket. Cada mensaje se avisa una sola vez.

const MAX_REMEMBERED = 200;

export function createTtsRelease(emit) {
  const told = new Set();
  return function release(message) {
    if (!message?.holdsAlert || message.id === undefined || message.id === null) return false;
    const id = String(message.id);
    if (!id || told.has(id)) return false;
    told.add(id);
    if (told.size > MAX_REMEMBERED) told.delete(told.values().next().value);
    emit('tts_message_done', id);
    return true;
  };
}
