// localStorage puede lanzar una excepción: modo privado de algunos navegadores,
// almacenamiento bloqueado por el navegador o por la app que embebe la página
// (el navegador de OBS o de un programa de directos), o espacio lleno. Guardar
// algo nunca debe romper la pantalla: estos ayudantes devuelven un valor en vez
// de lanzar.

export function readStorage(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
