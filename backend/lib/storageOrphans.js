// Archivos "huérfanos" del almacenamiento de las alertas: están en el bucket de
// Supabase pero ninguna alerta ni ningún sonido de Objetivo los usa. Salen, por
// ejemplo, de una subida que terminó pero cuyo guardado en la base falló, o de
// una licencia eliminada (antes su carpeta se quedaba para siempre).
//
// Regla de seguridad por encima de todo: no se borra nada que se pueda estar
// usando. Solo se consideran huérfanos los archivos que NO figuran en la base y
// tienen más de 24 horas (una subida en curso sube el archivo un momento antes de
// guardarlo en la base, y no debe confundirse con un huérfano).

const HOUR_MS = 60 * 60 * 1000;
const MIN_ORPHAN_AGE_MS = 24 * HOUR_MS;

// Los archivos se guardan como "<id de la licencia>/<archivo>".
function licenseIdOfPath(path) {
    const index = String(path).indexOf('/');
    return index > 0 ? String(path).slice(0, index) : null;
}

// files: [{ path, size, createdAt }]; referenced: Set con las rutas que la base usa.
function findOrphans({ files, referenced, now = Date.now(), minAgeMs = MIN_ORPHAN_AGE_MS }) {
    const orphans = [];
    let totalBytes = 0;
    let orphanBytes = 0;
    for (const file of files) {
        const size = Number(file.size) || 0;
        totalBytes += size;
        if (referenced.has(file.path)) continue;
        // Sin fecha conocida no se arriesga: se trata como reciente.
        const age = Number.isFinite(file.createdAt) ? now - file.createdAt : 0;
        if (age < minAgeMs) continue;
        orphans.push({ path: file.path, size, createdAt: file.createdAt });
        orphanBytes += size;
    }
    return { orphans, totals: { files: files.length, bytes: totalBytes, orphans: orphans.length, orphanBytes } };
}

// Quiénes ocupan más espacio (para detectar abusos): [{ licenseId, files, bytes }].
function usageByLicense(files, limit = 10) {
    const byLicense = new Map();
    for (const file of files) {
        const id = licenseIdOfPath(file.path);
        if (!id) continue;
        const entry = byLicense.get(id) || { licenseId: id, files: 0, bytes: 0 };
        entry.files += 1;
        entry.bytes += Number(file.size) || 0;
        byLicense.set(id, entry);
    }
    return [...byLicense.values()].sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

module.exports = { findOrphans, usageByLicense, licenseIdOfPath, MIN_ORPHAN_AGE_MS };
