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
import { sameValue } from './eventSettingsSync.js';

// Qué hacer con la personalización de overlays que manda el servidor
// (`incoming`) cuando no es el primer mensaje de la conexión ('adopt') ni hay
// que conservar lo de aquí ('keep-local'). El servidor la reenvía también a
// quien la mandó: si el panel ponía ese eco como un objeto nuevo aunque fuera
// igual, eso disparaba otro envío, cuyo eco disparaba otro... con el panel
// abierto salían unos 3 por segundo sin parar, a todos los overlays de OBS y a
// la base. Se compara por contenido (sin importar el orden de las claves), así
// ni un eco ni un valor equivalente con las claves en otro orden reemplazan lo
// que se ve. `adopt`: tomarlo como lo que tiene el servidor (lo usan los
// overlays de OBS para pintarse). `replaceShown`: cambiar lo que se ve en el panel.
export function overlayEchoPlan({ decision, incoming, shown, lastSent, sending }) {
  const replaceShown = !sameValue(incoming, shown);
  if (decision === 'adopt') return { adopt: true, replaceShown };
  // Un cambio de aquí está por salir, o lo que se ve ya no es lo último que se
  // mandó: el eco es viejo, no se toca nada (lo nuevo sale enseguida).
  if (sending || (lastSent && !sameValue(lastSent, shown))) return { adopt: false, replaceShown: false };
  return { adopt: true, replaceShown };
}

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
    // Sesión nueva (otro inicio de sesión, otra cuenta): lo que se cambió antes
    // NO es un cambio de esta cuenta. Sin esto, un tema elegido en la pantalla
    // de inicio de sesión (que también es el aspecto de los overlays de OBS de
    // la cuenta) se guardaba al entrar, y cerrar sesión, cambiar el tema y
    // entrar con otra cuenta pisaba el de esa otra cuenta. Lo que se ve al
    // iniciar sesión pasa a ser el punto de partida y se adopta lo guardado.
    rebase(value) { synced = false; serverKnown = value; },
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
