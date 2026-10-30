// Sincronización de un ajuste que vive en el servidor y también en este
// navegador (el tema y la personalización de overlays, ver App.jsx).
//
// Bug real (pérdida de datos): el panel arrancaba con lo que tuviera este
// navegador (o con los valores de fábrica si no tenía nada) y, al conectarse,
// lo mandaba al servidor antes de recibir lo guardado. El servidor lo
// guardaba en la base y se perdía la configuración real: desde un navegador
// nuevo se perdía todo, y desde uno con una copia vieja se perdía lo que se
// hubiera cambiado mientras tanto desde otro dispositivo.
//
// Regla: en cada conexión no se manda nada hasta recibir el estado del
// servidor (que lo envía siempre al conectar, ya cargado de la base: ver
// attachSocket en tenant.js). Al recibirlo:
// - si la persona no cambió nada desde la última vez que este navegador supo
//   qué tenía el servidor, se adopta lo del servidor ('adopt');
// - si sí cambió algo (antes de conectarse, o mientras no había conexión), se
//   conserva lo suyo y se manda ('keep-local').
// Después, hasta la próxima desconexión, los mensajes del servidor son ecos de
// lo que se mandó ('echo') y los maneja el código de siempre.
export function createSettingsSync({ initial, same }) {
  let synced = false;
  // Lo último que este navegador sabe que tiene el servidor. Al arrancar, lo
  // que se cargó de este navegador: si sigue igual al llegar el estado del
  // servidor, nadie lo tocó en esta pestaña.
  let serverKnown = initial;
  return {
    canSend: () => synced,
    sent(value) { serverKnown = value; },
    disconnected() { synced = false; },
    receive(serverValue, localValue) {
      if (synced) return 'echo';
      synced = true;
      if (same(localValue, serverKnown)) {
        serverKnown = serverValue;
        return 'adopt';
      }
      return 'keep-local';
    },
  };
}
