// Arranque de la base (db.js) con un `pg` simulado: qué pasa si falla la
// creación de licenses.event_settings. No prueba Postgres de verdad (eso hay
// que comprobarlo al desplegar, ver el PR): prueba la cadena de arranque.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadDbWith(failOn) {
  const queries = [];
  let columnMissing = false;
  class Pool {
    async query(text) {
      const sql = typeof text === 'string' ? text : text?.text || '';
      queries.push(sql.replace(/\s+/g, ' ').trim());
      if (failOn && failOn.test(sql)) { columnMissing = true; throw new Error('canceling statement due to lock timeout'); }
      // Como Postgres: sin la columna, usarla falla.
      if (columnMissing && /UPDATE licenses SET event_settings/.test(sql)) throw new Error('column "event_settings" of relation "licenses" does not exist');
      return { rows: [], rowCount: 0 };
    }
    on() { return this; }
  }
  const pgPath = require.resolve('pg');
  const dbPath = require.resolve('./db');
  const saved = { pg: require.cache[pgPath], db: require.cache[dbPath], url: process.env.DATABASE_URL };
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool, types: { setTypeParser() {} } } };
  delete require.cache[dbPath];
  process.env.DATABASE_URL = 'postgres://prueba';
  const db = require(path.join(__dirname, 'db.js'));
  const restore = () => {
    if (saved.pg) require.cache[pgPath] = saved.pg; else delete require.cache[pgPath];
    if (saved.db) require.cache[dbPath] = saved.db; else delete require.cache[dbPath];
    if (saved.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.url;
  };
  return { db, queries, restore };
}

const waitReady = (db) => db.findById('x').catch(() => {});

test('si no se puede crear event_settings, el arranque sigue y el resto del esquema se crea', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const { db, queries, restore } = loadDbWith(/event_settings JSONB/);
  try {
    await waitReady(db);
    assert.ok(queries.some((q) => /ADD COLUMN IF NOT EXISTS event_settings JSONB/.test(q)), 'se intentó');
    assert.ok(queries.some((q) => /ADD COLUMN IF NOT EXISTS tts_settings JSONB/.test(q)), 'lo que sigue en la cadena también corre');
    assert.ok(queries.some((q) => /SELECT \* FROM licenses WHERE id = \$1/.test(q)), 'las consultas normales funcionan (se puede iniciar sesión)');
    assert.ok(errors.some((e) => /licenses\.event_settings/.test(e)), 'el fallo queda en el registro');
    await assert.rejects(db.setEventSettings('lic', { king: {} }), /does not exist/, 'guardar ajustes falla de forma visible (y el panel lo avisa)');
  } finally {
    console.error = realError;
    restore();
  }
});

test('la columna se crea nula y sin valor por defecto (no toca las licencias existentes)', async () => {
  const { db, queries, restore } = loadDbWith(null);
  try {
    await waitReady(db);
    const stmt = queries.find((q) => /event_settings/.test(q) && /ALTER TABLE/.test(q));
    assert.equal(stmt, 'ALTER TABLE licenses ADD COLUMN IF NOT EXISTS event_settings JSONB');
  } finally {
    restore();
  }
});
