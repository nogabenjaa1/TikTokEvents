// Script de un solo uso: crea la licencia lifetime + admin de notbenjaa1
// si todavía no existe. Correr con: node seed-admin.js
// Path explícito (no relativo al cwd del que lo invoca): así funciona igual
// si se corre desde backend/ (node seed-admin.js) o desde la raíz del repo
// (node backend/seed-admin.js, como hace el script "start" de producción).
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const ADMIN_USERNAME = 'notbenjaa1';

async function main() {
    const rows = await db.listAll();
    const existing = rows.find(row => row.username === ADMIN_USERNAME && row.is_admin);
    if (existing) {
        console.log(`Ya existe una licencia admin para "${ADMIN_USERNAME}" (id: ${existing.id}).`);
        console.log('La key no se puede volver a mostrar (solo se ve una vez al crearla).');
        console.log('Si la perdiste, revocá esta licencia y corré este script de nuevo para generar una nueva.');
        return;
    }

    const key = auth.generateLicenseKey();
    const row = await db.insertLicense({
        id: crypto.randomUUID(),
        keyHash: auth.hashKey(key),
        keyPrefix: auth.keyPrefix(key),
        username: ADMIN_USERNAME,
        licenseType: 'lifetime',
        isAdmin: true,
        createdAt: Date.now(),
        expiresAt: auth.computeExpiresAt('lifetime'),
    });

    console.log('✅ Licencia admin creada para', ADMIN_USERNAME);
    console.log('   id:', row.id);
    console.log('   tipo: lifetime (admin)');
    console.log('');
    console.log('   KEY (guardala ahora, no se vuelve a mostrar):');
    console.log('   ' + key);
    console.log('');
}

main()
    .catch(err => { console.error('Error al seedear el admin:', err); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode || 0));
