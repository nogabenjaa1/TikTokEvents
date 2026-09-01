// Script de un solo uso: copia las licencias de la DB vieja en SQLite
// (backend/data/licenses.db) a Supabase/Postgres (DATABASE_URL en .env).
// No borra ni toca el archivo SQLite — es seguro correrlo más de una vez,
// las filas ya existentes se actualizan (ON CONFLICT) en vez de duplicarse.
//
// Uso:
//   npm install better-sqlite3 --no-save   (si ya no está instalado)
//   node migrate-to-supabase.js
//
// Correr desde backend/, con DATABASE_URL ya apuntando al proyecto de
// Supabase correcto.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const SQLITE_PATH = path.join(__dirname, 'data', 'licenses.db');

async function main() {
    if (!fs.existsSync(SQLITE_PATH)) {
        console.log(`No se encontró ${SQLITE_PATH} — nada para migrar.`);
        return;
    }
    if (!process.env.DATABASE_URL) {
        throw new Error('Falta DATABASE_URL en backend/.env (connection string de Supabase)');
    }

    let Database;
    try {
        Database = require('better-sqlite3');
    } catch {
        throw new Error('Falta better-sqlite3 — corre: npm install better-sqlite3 --no-save');
    }

    const sqlite = new Database(SQLITE_PATH, { readonly: true });
    const rows = sqlite.prepare('SELECT * FROM licenses').all();
    sqlite.close();

    console.log(`Encontradas ${rows.length} licencia(s) en SQLite. Migrando a Supabase...`);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    // Mismo esquema que backend/db.js — si esto corre antes de levantar el
    // backend una vez, crea la tabla igual.
    await pool.query(`
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
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_mp_payment
      ON licenses(mp_payment_id) WHERE mp_payment_id IS NOT NULL
    `);

    for (const row of rows) {
        await pool.query(`
            INSERT INTO licenses (
                id, key_hash, key_prefix, username, license_type, is_admin, revoked,
                created_at, expires_at, last_login_at, mp_payment_id,
                king_starts, zub_starts, elim_starts, last_active_at, session_id, multi_device
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (id) DO UPDATE SET
                key_hash = EXCLUDED.key_hash, key_prefix = EXCLUDED.key_prefix,
                username = EXCLUDED.username, license_type = EXCLUDED.license_type,
                is_admin = EXCLUDED.is_admin, revoked = EXCLUDED.revoked,
                created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
                last_login_at = EXCLUDED.last_login_at, mp_payment_id = EXCLUDED.mp_payment_id,
                king_starts = EXCLUDED.king_starts, zub_starts = EXCLUDED.zub_starts,
                elim_starts = EXCLUDED.elim_starts, last_active_at = EXCLUDED.last_active_at,
                session_id = EXCLUDED.session_id, multi_device = EXCLUDED.multi_device
        `, [
            row.id, row.key_hash, row.key_prefix, row.username, row.license_type,
            !!row.is_admin, !!row.revoked, row.created_at, row.expires_at, row.last_login_at,
            row.mp_payment_id ?? null, row.king_starts || 0, row.zub_starts || 0, row.elim_starts || 0,
            row.last_active_at ?? null, row.session_id ?? null, !!row.multi_device,
        ]);
        console.log(`  ✓ ${row.username} (${row.id})`);
    }

    await pool.end();
    console.log(`\n✅ Migración completa: ${rows.length} licencia(s) en Supabase.`);
}

main().catch(err => { console.error('❌ Error migrando:', err); process.exitCode = 1; });
