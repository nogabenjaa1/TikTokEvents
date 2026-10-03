// Campo trampa contra bots: una persona no lo ve ni llega a él con el
// teclado; un script que rellena todos los campos de un formulario sí lo
// llena, y el servidor rechaza el envío (ver isBotSubmission en server.js).
// Fuera de la pantalla en vez de display:none, porque algunos bots se saltan
// los campos ocultos. El nombre es uno que los bots suelen querer llenar.
export default function HoneypotField() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
      <label>
        Sitio web
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}
