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
// Tolerante a un error común: la pantalla "Data API" del dashboard de
// Supabase muestra la URL con /rest/v1/ al final (la que sirve para
// PostgREST) — pero Storage vive bajo /storage/v1/ del dominio PELADO del
// proyecto, así que si alguien pega esa URL completa acá, se la recortamos
// en vez de armar rutas rotas tipo ".co/rest/v1/storage/v1/...".
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'alert-media';

function assertConfigured() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Falta configurar SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en las variables de entorno');
    }
}

// El gateway de Supabase (Kong) exige EL HEADER `apikey` además de
// `Authorization: Bearer ...` — mandar solo uno de los dos responde 401
// "No apikey request header or url param was found" aunque el token sea
// válido (confirmado en producción: este era el bug real). Ambos headers
// llevan el MISMO valor (la service_role key).
function authHeaders(extra = {}) {
    return {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        ...extra,
    };
}

// Idempotente — se llama una vez al arrancar el server (ver server.js). Si
// el bucket ya existe, Supabase responde 400 con "already exists"; eso NO
// es un error real acá, así que se ignora en vez de tirar. `file_size_limit`
// a propósito NO se manda acá — Supabase espera bytes numéricos, no un
// string tipo "15MB" (mandar el formato equivocado hace fallar la creación
// del bucket entero) — el límite de 15MB ya lo aplica multer del lado de
// Express (ver server.js), así que este campo es redundante.
async function ensureBucket() {
    console.log('[Storage] SUPABASE_URL configurada:', !!SUPABASE_URL, '| SUPABASE_SERVICE_ROLE_KEY configurada:', !!SUPABASE_SERVICE_ROLE_KEY);
    assertConfigured();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    if (res.ok) {
        console.log(`[Storage] Bucket "${BUCKET}" listo.`);
        return;
    }
    const text = await res.text();
    if (res.status === 400 && /already exists/i.test(text)) {
        console.log(`[Storage] Bucket "${BUCKET}" ya existía — todo bien.`);
        return;
    }
    console.error(`[Storage] No se pudo crear/verificar el bucket "${BUCKET}" — status ${res.status}:`, text);
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
        headers: authHeaders({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }),
        body: buffer,
    });
    if (!res.ok) {
        const text = await res.text();
        console.error(`[Storage] Upload a "${path}" falló — status ${res.status}:`, text);
        throw new Error(`Supabase Storage upload falló (${res.status}): ${text}`);
    }
    console.log(`[Storage] Subido OK: ${path}`);
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
            headers: authHeaders(),
        });
    } catch (err) {
        console.error('[Storage] No se pudo borrar el archivo (no bloqueante):', err.message);
    }
}

function isConfigured() {
    return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// Lo que se acepta como carpeta (el id de una licencia): nada de rutas raras.
const SAFE_SEGMENT = /^[\w-]{1,64}$/;

// Lista el contenido de una "carpeta" del bucket, con paginación. En la API de
// Supabase las carpetas llegan como entradas sin id; los archivos traen id, fecha
// de creación y su tamaño en metadata.
async function listFolder(prefix) {
    assertConfigured();
    const entries = [];
    const limit = 100;
    for (let offset = 0; offset <= 100000; offset += limit) {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!res.ok) throw new Error(`Supabase Storage list falló (${res.status})`);
        const page = await res.json();
        if (!Array.isArray(page)) throw new Error('Respuesta inesperada al listar el almacenamiento');
        entries.push(...page);
        if (page.length < limit) break;
    }
    return entries;
}

function toFile(entry, path) {
    return { path, size: Number(entry.metadata?.size) || 0, createdAt: Date.parse(entry.created_at) || null };
}

// Todos los archivos del bucket: [{ path, size, createdAt }]. Recorre las carpetas
// (una por licencia) con poca concurrencia y con un tope de tiempo: si se agota
// devuelve lo que alcanzó y `truncated: true`.
async function listAllFiles({ budgetMs = 60000, concurrency = 4 } = {}) {
    const started = Date.now();
    const files = [];
    const folders = [];
    for (const entry of await listFolder('')) {
        if (entry.id) files.push(toFile(entry, entry.name));
        else if (SAFE_SEGMENT.test(entry.name)) folders.push(entry.name);
    }
    let truncated = false;
    let next = 0;
    async function worker() {
        while (next < folders.length) {
            if (Date.now() - started > budgetMs) { truncated = true; return; }
            const folder = folders[next++];
            for (const entry of await listFolder(folder)) {
                if (entry.id) files.push(toFile(entry, `${folder}/${entry.name}`));
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { files, truncated };
}

// A diferencia de deleteFile (que no avisa si falla), esta dice si se borró.
async function deleteFileStrict(path) {
    assertConfigured();
    try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: authHeaders() });
        return res.ok;
    } catch {
        return false;
    }
}

async function deleteFiles(paths) {
    let deleted = 0;
    let failed = 0;
    for (const path of paths) {
        if (await deleteFileStrict(path)) deleted++; else failed++;
    }
    return { deleted, failed };
}

// Borra todo lo que hay en la carpeta de una licencia (al eliminar la licencia).
async function deletePrefix(prefix) {
    if (typeof prefix !== 'string' || !SAFE_SEGMENT.test(prefix)) throw new Error('Carpeta no válida');
    const files = (await listFolder(prefix)).filter((entry) => entry.id).map((entry) => `${prefix}/${entry.name}`);
    return deleteFiles(files);
}

module.exports = { ensureBucket, uploadFile, deleteFile, isConfigured, listAllFiles, deleteFiles, deletePrefix };
