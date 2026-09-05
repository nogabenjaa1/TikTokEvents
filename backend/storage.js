// Storage de media para las Alertas de regalos (imagen/gif/video/audio que
// se reproducen en el overlay al llegar un regalo específico) — vía la API
// REST de Supabase Storage, con fetch crudo en vez de instalar el SDK
// completo (@supabase/supabase-js), mismo criterio que spotify.js. Usa el
// MISMO proyecto de Supabase que ya aloja la base de datos (ver
// DATABASE_URL en db.js), así que solo hacen falta dos variables más:
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (Project Settings -> API).
//
// Por qué no Render: el filesystem del backend se borra en cada redeploy
// (y Render Free ni siquiera tiene disco persistente) — cualquier archivo
// subido ahí desaparecería en el próximo deploy.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'alert-media';

function assertConfigured() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Falta configurar SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en las variables de entorno');
    }
}

// Idempotente — se llama una vez al arrancar el server (ver server.js). Si
// el bucket ya existe, Supabase responde 400 con "already exists"; eso NO
// es un error real acá, así que se ignora en vez de tirar.
async function ensureBucket() {
    assertConfigured();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: '15MB' }),
    });
    if (res.ok) return;
    const text = await res.text();
    if (res.status === 400 && /already exists/i.test(text)) return;
    console.error(`[Storage] No se pudo crear/verificar el bucket "${BUCKET}":`, text);
}

// `path` incluye la licencia como prefijo (ver server.js) para que dos
// streamers nunca puedan pisarse archivos entre sí. Devuelve la URL
// pública directa — el bucket es público (`public: true` arriba) porque
// estos archivos los tiene que poder cargar el overlay de OBS sin ningún
// tipo de auth de por medio.
async function uploadFile(path, buffer, contentType) {
    assertConfigured();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': contentType || 'application/octet-stream',
            'x-upsert': 'true',
        },
        body: buffer,
    });
    if (!res.ok) throw new Error(`Supabase Storage upload falló (${res.status}): ${await res.text()}`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Best-effort: si falla (archivo ya borrado a mano, etc.) no bloquea el
// borrado de la fila en la base — un archivo huérfano en el bucket no
// rompe nada, solo ocupa espacio.
async function deleteFile(path) {
    assertConfigured();
    try {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        });
    } catch (err) {
        console.error('[Storage] No se pudo borrar el archivo (no bloqueante):', err.message);
    }
}

module.exports = { ensureBucket, uploadFile, deleteFile };
