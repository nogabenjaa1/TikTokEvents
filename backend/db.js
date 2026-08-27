// ==========================================
// PERSISTENCIA DE LICENCIAS (Postgres / Supabase)
// Pool de conexión + API async. Este módulo solo sabe de guardar/leer
// filas: la generación de keys, el hashing y los JWT viven en auth.js.
//
// Antes esto era SQLite (better-sqlite3, un solo archivo local). Se migró
// a Supabase para que los datos sobrevivan a redeploys/reinicios del
// backend sin importar dónde corra (Railway, Render, Fly, un VPS, etc.) —
// ver backend/migrate-to-supabase.js para pasar los datos de una DB SQLite
// existente.
// ==========================================
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Falta DATABASE_URL en las variables de entorno (backend/.env) — connection string de Postgres de Supabase');
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});

// Se ejecuta una sola vez al cargar el módulo; toda función exportada espera
// esta promesa antes de tocar la tabla, así no hace falta un init() aparte
// que cada caller tenga que acordarse de llamar.
// Cada función exportada espera esta promesa antes de tocar la tabla (ver
// más abajo); el .catch() de acá abajo es solo para que un fallo al
// arrancar (Supabase caído, DATABASE_URL mal) no tumbe el proceso entero
// por un unhandled rejection — cada caller sigue viendo el error propio
// cuando le toque hacer `await ready`.
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    username TEXT NOT NULL,
    license_type TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    last_login_at BIGINT,
    mp_payment_id TEXT,
    king_starts INTEGER NOT NULL DEFAULT 0,
    zub_starts INTEGER NOT NULL DEFAULT 0,
    elim_starts INTEGER NOT NULL DEFAULT 0,
    last_active_at BIGINT,
    session_id TEXT,
    multi_device BOOLEAN NOT NULL DEFAULT FALSE
  )
`).then(() => pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_mp_payment
  ON licenses(mp_payment_id) WHERE mp_payment_id IS NOT NULL
`));
ready.catch(err => console.error('[DB] No se pudo inicializar el schema de licencias en Supabase:', err.message));

async function insertLicense({ id, keyHash, keyPrefix, username, licenseType, isAdmin, createdAt, expiresAt, mpPaymentId = null }) {
    await ready;
    await pool.query(`
        INSERT INTO licenses (id, key_hash, key_prefix, username, license_type, is_admin, revoked, created_at, expires_at, last_login_at, mp_payment_id)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, NULL, $9)
    `, [id, keyHash, keyPrefix, username, licenseType, !!isAdmin, createdAt, expiresAt, mpPaymentId]);
    return findById(id);
}

async function findByKeyHash(keyHash) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses WHERE key_hash = $1', [keyHash]);
    return rows[0];
}

async function findById(id) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses WHERE id = $1', [id]);
    return rows[0];
}

async function listAll() {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses ORDER BY created_at DESC');
    return rows;
}

async function revoke(id) {
    await ready;
    await pool.query('UPDATE licenses SET revoked = TRUE WHERE id = $1', [id]);
    return findById(id);
}

async function touchLastLogin(id) {
    await ready;
    await pool.query('UPDATE licenses SET last_login_at = $1 WHERE id = $2', [Date.now(), id]);
}

// Un solo dispositivo activo por licencia: cada login pisa el session_id
// anterior, así que el JWT de la sesión vieja deja de validar (ver
// auth.resolveFromToken). Cambiar de dispositivo funciona siempre; usar
// dos a la vez, no.
async function setSession(id, sessionId) {
    await ready;
    await pool.query('UPDATE licenses SET session_id = $1 WHERE id = $2', [sessionId, id]);
}

// Licencias "todopoderosas" (pensada para el owner, no para vender): se
// saltan por completo la restricción de un solo dispositivo — ver
// auth.checkTokenStatus y el login en server.js.
async function setMultiDevice(id, enabled) {
    await ready;
    await pool.query('UPDATE licenses SET multi_device = $1 WHERE id = $2', [!!enabled, id]);
    return findById(id);
}

const USAGE_FIELDS = ['king_starts', 'zub_starts', 'elim_starts'];

async function incrementUsage(id, field) {
    if (!USAGE_FIELDS.includes(field)) throw new Error('Campo de uso inválido: ' + field);
    await ready;
    await pool.query(`UPDATE licenses SET ${field} = ${field} + 1, last_active_at = $1 WHERE id = $2`, [Date.now(), id]);
}

module.exports = {
    insertLicense, findByKeyHash, findById, listAll, revoke, touchLastLogin, incrementUsage, setSession, setMultiDevice,
};
