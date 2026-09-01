// ==========================================
// AUTENTICACIÓN: keys de licencia, hashing, JWT, y los middlewares
// que las validan (tanto para rutas HTTP como para sockets de Socket.io).
// ==========================================
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const KEY_HASH_SECRET = process.env.KEY_HASH_SECRET;

if (!JWT_SECRET || !KEY_HASH_SECRET) {
    throw new Error('Faltan JWT_SECRET y/o KEY_HASH_SECRET en las variables de entorno (backend/.env)');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATIONS_MS = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS, annual: 365 * DAY_MS, lifetime: null, trial: 7 * DAY_MS };
const LIFETIME_JWT_EXPIRY = '365d'; // las licencias lifetime igual reautentican una vez al año

// La key es el único "password": alta entropía (192 bits), codificada en
// base64url para que se pueda meter tal cual en la URL del overlay.
function generateLicenseKey() {
    return crypto.randomBytes(24).toString('base64url');
}

// La key ya tiene entropía criptográfica propia, así que alcanza con un HMAC
// (más simple y liviano que bcrypt, que está pensado para passwords humanas).
function hashKey(key) {
    return crypto.createHmac('sha256', KEY_HASH_SECRET).update(key).digest('hex');
}

function keyPrefix(key) {
    return key.slice(0, 8);
}

// Mismo formato "legible" que ya usaba la prueba gratis (alias-FREE7DAY-hash,
// ver server.js): alias-ETIQUETA-hash. Se usa al rotar la key de una
// licencia que pasa de prueba/nivel anterior a un plan pago (ver
// /api/payments/webhook) — el alias y la etiqueta son cosméticos, la
// entropía real vive en el sufijo aleatorio de 72 bits.
function sanitizeAlias(alias) {
    return String(alias || '').trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
}

function generateLabeledKey(alias, label) {
    return `${alias.toLowerCase()}-${label}-${crypto.randomBytes(9).toString('base64url')}`;
}

function computeExpiresAt(licenseType, fromMs = Date.now()) {
    const delta = DURATIONS_MS[licenseType];
    return delta === null || delta === undefined ? null : fromMs + delta;
}

function isLicenseValid(row) {
    if (!row || row.revoked) return false;
    if (row.expires_at !== null && row.expires_at <= Date.now()) return false;
    return true;
}

// Un solo dispositivo activo por licencia: cada JWT lleva un sessionId (sid)
// generado en el login, y solo es válido mientras coincida con el
// session_id guardado en la DB — que cualquier login posterior, desde
// cualquier dispositivo, pisa. Cambiar de dispositivo funciona siempre;
// usar dos en simultáneo, no: el segundo login invalida al primero de inmediato.
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function signSession(row, sessionId) {
    const payload = { sub: row.id, sid: sessionId, username: row.username, isAdmin: !!row.is_admin, licenseType: row.license_type };
    const expiresIn = row.expires_at === null
        ? LIFETIME_JWT_EXPIRY
        : Math.max(60, Math.floor((row.expires_at - Date.now()) / 1000)); // al menos 60s para evitar tokens ya vencidos
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifySession(token) {
    return jwt.verify(token, JWT_SECRET); // lanza si es inválido/expiró
}

// Re-valida contra la DB (no solo la firma del JWT): cubre licencia
// revocada/expirada Y sesión reemplazada por otro dispositivo. `reason`
// permite distinguir "te desconectaron de otro lado" de "licencia inválida"
// en el mensaje que ve el usuario. Deja pasar las excepciones de jwt.verify
// (token roto/vencido) tal como antes — los callers ya las atrapan.
async function checkTokenStatus(token) {
    const decoded = verifySession(token);
    const row = await db.findById(decoded.sub);
    if (!isLicenseValid(row)) return { row: null, sessionId: null, reason: 'invalid' };
    // Comparación directa (no un "if row.session_id existe"): así un logout
    // explícito (que deja session_id en null) también mata cualquier token
    // viejo, en vez de dejarlo pasar por "no hay restricción todavía".
    // Excepción: licencias "todopoderosas" (multi_device) no tienen esta
    // restricción en absoluto — cualquier token emitido para ellas sigue
    // sirviendo, se usen simultáneamente en la cantidad de dispositivos que sea.
    if (!row.multi_device && decoded.sid !== row.session_id) return { row: null, sessionId: null, reason: 'session_replaced' };
    return { row, sessionId: decoded.sid, reason: null };
}

async function resolveFromToken(token) {
    return (await checkTokenStatus(token)).row;
}

async function resolveFromRawKey(key) {
    const row = await db.findByKeyHash(hashKey(key));
    if (!isLicenseValid(row)) return null;
    return row;
}

// ── Middleware HTTP (Express) ──────────────────────────────
async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: 'No autenticado' });

    try {
        const { row, reason } = await checkTokenStatus(token);
        if (!row) {
            // "session_replaced" cubre tanto un logout propio como que la
            // licencia se usó desde otro dispositivo — no sabemos cuál sin
            // guardar más historial, así que el mensaje queda neutral.
            const message = reason === 'session_replaced'
                ? 'Tu sesión ya no es válida. Iniciá sesión de nuevo.'
                : 'Licencia inválida, revocada o expirada';
            return res.status(401).json({ success: false, error: message });
        }
        req.license = row;
        req.isAdmin = !!row.is_admin;
        next();
    } catch {
        res.status(401).json({ success: false, error: 'Token inválido' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.isAdmin) return res.status(403).json({ success: false, error: 'Requiere licencia de administrador' });
    next();
}

// ── Middleware Socket.io ───────────────────────────────────
// Acepta DOS formas de autenticar en el handshake:
//   auth.token       -> JWT de una sesión ya logueada (ventana de control),
//                       sujeto a la restricción de un solo dispositivo.
//   auth.licenseKey  -> key cruda (usada por el overlay embebido en OBS,
//                       que no puede loguearse interactivamente). El overlay
//                       queda a propósito EXENTO de la restricción de
//                       dispositivo único: corre en paralelo al panel de
//                       control por diseño, no es "otro dispositivo humano".
async function socketAuthMiddleware(socket, next) {
    const { token, licenseKey } = socket.handshake.auth || {};

    try {
        let row = null;
        if (token) {
            const status = await checkTokenStatus(token);
            row = status.row;
            socket.sessionId = status.sessionId;
            socket.authMethod = 'jwt';
        } else if (licenseKey) {
            row = await resolveFromRawKey(licenseKey);
            socket.authMethod = 'key';
        }

        if (!row) return next(new Error('unauthorized'));

        socket.licenseId = row.id;
        socket.isAdmin = !!row.is_admin;
        socket.licenseUsername = row.username;
        socket.licenseType = row.license_type;
        next();
    } catch {
        next(new Error('unauthorized'));
    }
}

module.exports = {
    generateLicenseKey, hashKey, keyPrefix, computeExpiresAt, isLicenseValid, sanitizeAlias, generateLabeledKey,
    generateSessionId, signSession, verifySession, checkTokenStatus, resolveFromToken, resolveFromRawKey,
    requireAuth, requireAdmin, socketAuthMiddleware,
};
