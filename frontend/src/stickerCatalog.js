// Stickers del club de fans que el servidor ha visto en el chat de tu LIVE (ver
// backend/lib/stickerDirectoryCore.js). TikTok no da la lista de un creador, así que el
// catálogo se llena solo mientras estás en vivo: el servidor manda los que ya tenía guardados
// y avisa de cada nuevo con `sticker_seen`. Parte pura, para poder probarla sin el panel.

const ID_PATTERN = /^\d{1,25}$/;

// Un sticker recibido -> { id, imageUrl }, o null si no sirve. Solo imágenes por https.
export function cleanSticker(raw) {
  const id = String(raw?.id ?? '');
  if (!ID_PATTERN.test(id)) return null;
  const url = typeof raw?.imageUrl === 'string' && /^https:\/\//i.test(raw.imageUrl) ? raw.imageUrl : '';
  return { id, imageUrl: url };
}

// Agrega (o completa) un sticker en la lista. Devuelve la lista nueva, o LA MISMA si no
// cambió nada, para no repintar. Una imagen que llega distinta reemplaza a la anterior
// (las direcciones de TikTok pueden cambiar); si no trae imagen, no borra la que había.
export function addSeenSticker(list, raw) {
  const sticker = cleanSticker(raw);
  if (!sticker) return list;
  const index = list.findIndex((item) => item.id === sticker.id);
  if (index === -1) return [...list, sticker];
  if (!sticker.imageUrl || sticker.imageUrl === list[index].imageUrl) return list;
  const next = [...list];
  next[index] = sticker;
  return next;
}

// El sticker con ese id, o uno "sin imagen" si todavía no está en la lista (por ejemplo, la
// alerta se abrió antes de que el catálogo terminara de cargar): así nunca se pierde el id.
export function stickerForId(list, id) {
  if (!id) return null;
  return list.find((item) => item.id === String(id)) || { id: String(id), imageUrl: '' };
}

// Los stickers no tienen nombre (TikTok solo manda su número y su imagen): se distinguen por la
// imagen y por las últimas cifras de su número, que es lo que se ve en las listas.
export function stickerLabel(sticker) {
  const id = String(sticker?.id ?? '');
  return id ? `Sticker …${id.slice(-4)}` : 'Sticker';
}

// La clave con la que el servidor guarda la alerta de un sticker (misma regla que
// stickerAlertKey en backend/lib/stickerCatalog.js): sin id es la de "cualquier sticker".
export function stickerTriggerKey(id) {
  return id ? `sticker:${id}` : 'sticker';
}
