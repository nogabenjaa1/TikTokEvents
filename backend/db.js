// ==========================================
// PERSISTENCIA DE LICENCIAS (SQLite / better-sqlite3)
// Un solo archivo, API síncrona, sin infraestructura externa.
// Este módulo solo sabe de guardar/leer filas: la generación de keys,
// el hashing y los JWT viven en auth.js.
// ==========================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'licenses.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    username TEXT NOT NULL,
    license_type TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_login_at INTEGER
  )
`);

// Migraciones aditivas simples: agrega columnas nuevas solo si todavía no
// existen, así una DB ya creada (como la de producción) no se rompe.
const existingColumns = db.prepare(`PRAGMA table_info(licenses)`).all().map(c => c.name);
for (const [name, ddlType] of [
    ['mp_payment_id', 'TEXT'],
    ['king_starts', 'INTEGER NOT NULL DEFAULT 0'],
    ['zub_starts', 'INTEGER NOT NULL DEFAULT 0'],
    ['elim_starts', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_active_at', 'INTEGER'],
    ['session_id', 'TEXT'],
    ['multi_device', 'INTEGER NOT NULL DEFAULT 0'],
]) {
    if (!existingColumns.includes(name)) db.exec(`ALTER TABLE licenses ADD COLUMN ${name} ${ddlType}`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_mp_payment ON licenses(mp_payment_id) WHERE mp_payment_id IS NOT NULL`);

function insertLicense({ id, keyHash, keyPrefix, username, licenseType, isAdmin, createdAt, expiresAt, mpPaymentId = null }) {
    db.prepare(`
        INSERT INTO licenses (id, key_hash, key_prefix, username, license_type, is_admin, revoked, created_at, expires_at, last_login_at, mp_payment_id)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)
    `).run(id, keyHash, keyPrefix, username, licenseType, isAdmin ? 1 : 0, createdAt, expiresAt, mpPaymentId);
    return findById(id);
}

function findByKeyHash(keyHash) {
    return db.prepare('SELECT * FROM licenses WHERE key_hash = ?').get(keyHash);
}

function findById(id) {
    return db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
}


function listAll() {
    return db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
}

function revoke(id) {
    db.prepare('UPDATE licenses SET revoked = 1 WHERE id = ?').run(id);
    return findById(id);
}

function touchLastLogin(id) {
    db.prepare('UPDATE licenses SET last_login_at = ? WHERE id = ?').run(Date.now(), id);
}

// Un solo dispositivo activo por licencia: cada login pisa el session_id
// anterior, así que el JWT de la sesión vieja deja de validar (ver
// auth.resolveFromToken). Cambiar de dispositivo funciona siempre; usar
// dos a la vez, no.
function setSession(id, sessionId) {
    db.prepare('UPDATE licenses SET session_id = ? WHERE id = ?').run(sessionId, id);
}

// Licencias "todopoderosas" (pensada para el owner, no para vender): se
// saltan por completo la restricción de un solo dispositivo — ver
// auth.checkTokenStatus y el login en server.js.
function setMultiDevice(id, enabled) {
    db.prepare('UPDATE licenses SET multi_device = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return findById(id);
}

const USAGE_FIELDS = ['king_starts', 'zub_starts', 'elim_starts'];

function incrementUsage(id, field) {
    if (!USAGE_FIELDS.includes(field)) throw new Error('Campo de uso inválido: ' + field);
    db.prepare(`UPDATE licenses SET ${field} = ${field} + 1, last_active_at = ? WHERE id = ?`).run(Date.now(), id);
}

module.exports = {
    insertLicense, findByKeyHash, findById, listAll, revoke, touchLastLogin, incrementUsage, setSession, setMultiDevice,
};
