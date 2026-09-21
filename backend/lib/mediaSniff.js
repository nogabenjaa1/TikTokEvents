// Reconoce qué es de verdad un archivo por sus primeros bytes (su "firma"), en
// vez de creer el tipo que declara quien lo sube: ese dato lo manda el navegador
// y cualquiera puede mentir en él. Las alertas guardan el archivo con el tipo y
// la extensión que salen de aquí, así que lo que se publica siempre es lo que
// dice ser.

const ascii = (buffer, start, end) => buffer.toString('latin1', start, end);

const MP4_BOX_TYPES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot']);

// Devuelve { kind, group, mime, ext } o null si no es ninguno de los formatos
// permitidos. `group`: 'image' | 'gif' | 'video' | 'audio'.
function sniffMedia(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    if (buffer[0] === 0x89 && ascii(buffer, 1, 4) === 'PNG' && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
        return { kind: 'png', group: 'image', mime: 'image/png', ext: '.png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { kind: 'jpeg', group: 'image', mime: 'image/jpeg', ext: '.jpg' };
    }
    const head6 = ascii(buffer, 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') {
        return { kind: 'gif', group: 'gif', mime: 'image/gif', ext: '.gif' };
    }
    if (ascii(buffer, 0, 4) === 'RIFF') {
        const form = ascii(buffer, 8, 12);
        if (form === 'WEBP') return { kind: 'webp', group: 'image', mime: 'image/webp', ext: '.webp' };
        if (form === 'WAVE') return { kind: 'wav', group: 'audio', mime: 'audio/wav', ext: '.wav' };
        return null;
    }
    if (MP4_BOX_TYPES.has(ascii(buffer, 4, 8))) {
        return { kind: 'mp4', group: 'video', mime: 'video/mp4', ext: '.mp4' };
    }
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return { kind: 'webm', group: 'video', mime: 'video/webm', ext: '.webm' };
    }
    if (ascii(buffer, 0, 4) === 'OggS') {
        return { kind: 'ogg', group: 'audio', mime: 'audio/ogg', ext: '.ogg' };
    }
    // MP3: con etiqueta ID3, o directo con el sincronismo de un cuadro de audio
    // (once bits en 1 y una capa válida).
    if (ascii(buffer, 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0)) {
        return { kind: 'mp3', group: 'audio', mime: 'audio/mpeg', ext: '.mp3' };
    }
    return null;
}

module.exports = { sniffMedia };
