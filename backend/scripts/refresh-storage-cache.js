// Script de un solo uso: los archivos de alertas subidos antes del cambio de
// caché (ver UPLOAD_CACHE_CONTROL en storage.js) quedaron sin caché larga, y
// cada navegador los vuelve a descargar de Supabase en cada disparo de la
// alerta (egress). Este script los vuelve a subir con la caché de un año; la
// URL pública de cada archivo no cambia, así que las alertas siguen igual.
//
// Sin argumentos solo muestra cuántos archivos y cuántos MB tocaría (no
// cambia nada). Con --apply lo hace de verdad. Cada archivo se descarga una
// vez para volver a subirlo: eso cuenta como egress una sola vez (el total en
// MB que muestra la vista previa).
//
// Correr con: node scripts/refresh-storage-cache.js          (vista previa)
//             node scripts/refresh-storage-cache.js --apply  (aplicar)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const storage = require('../storage');

const apply = process.argv.includes('--apply');
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

async function main() {
    const { files, truncated } = await storage.listAllFiles({ budgetMs: 5 * 60 * 1000 });
    const pending = files.filter((file) => file.cacheControl !== storage.UPLOAD_CACHE_CONTROL);
    const totalBytes = pending.reduce((sum, file) => sum + file.size, 0);

    const byCache = {};
    for (const file of files) byCache[file.cacheControl || '(sin dato)'] = (byCache[file.cacheControl || '(sin dato)'] || 0) + 1;
    console.log(`Archivos en el bucket: ${files.length}${truncated ? ' (listado incompleto: se agotó el tiempo)' : ''}`);
    console.log('Caché actual:', byCache);
    console.log(`Por actualizar: ${pending.length} archivo(s), ${mb(totalBytes)} MB`);

    if (!apply) {
        console.log('\nVista previa: no se cambió nada. Para aplicarlo: node scripts/refresh-storage-cache.js --apply');
        return;
    }

    let done = 0;
    let failed = 0;
    for (const file of pending) {
        try {
            await storage.refreshCacheControl(file.path, file.mimetype);
            done++;
            console.log(`✅ ${file.path} (${mb(file.size)} MB)`);
        } catch (err) {
            failed++;
            console.error(`❌ ${file.path}: ${err.message}`);
        }
    }
    console.log(`\nListo: ${done} actualizado(s), ${failed} con error.`);
    if (failed) process.exitCode = 1;
}

main()
    .catch((err) => { console.error('Error actualizando la caché del almacenamiento:', err); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode || 0));
