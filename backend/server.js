require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const auth = require('./auth');
const Tenant = require('./tenant');

// Uno o varios orígenes separados por coma (p. ej. el dominio de Vercel +
// un dominio propio). Con un solo valor, cors/socket.io lo tratan igual
// que antes (string simple); con varios, se pasa el array.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const CORS_ORIGIN = CORS_ORIGINS.length === 1 ? CORS_ORIGINS[0] : CORS_ORIGINS;

const VALID_LICENSE_TYPES = ['day', 'week', 'month', 'lifetime'];

const app = express();
app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// ==========================================
// MULTI-TENANCY: un Tenant (estado + conexión TikTok propios) por licencia
// activa. Se crea la primera vez que un socket de esa licencia se conecta.
// ==========================================
const tenants = new Map(); // licenseId -> Tenant

function getOrCreateTenant(licenseId) {
    let tenant = tenants.get(licenseId);
    if (!tenant) {
        tenant = new Tenant(licenseId, io);
        tenants.set(licenseId, tenant);
    }
    return tenant;
}

// ==========================================
// RATE LIMITING
// ==========================================
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

// Un solo dispositivo activo por licencia: al loguearse, se desconectan de
// inmediato los sockets del PANEL DE CONTROL (auth vía JWT) que hubiera
// abiertos con una sesión anterior de esa misma licencia. El overlay
// (auth.authMethod === 'key') nunca se toca — corre en paralelo a propósito.
async function kickOtherDevices(licenseId, newSessionId) {
    const sockets = await io.in(licenseId).fetchSockets();
    for (const socket of sockets) {
        if (socket.authMethod === 'jwt' && socket.sessionId !== newSessionId) {
            socket.emit('session_replaced');
            socket.disconnect(true);
        }
    }
}

// ==========================================
// AUTH: LOGIN (con la license key, sin username/password separado)
// ==========================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Falta la clave de licencia' });
    }

    const row = await auth.resolveFromRawKey(key.trim());
    if (!row) {
        return res.status(401).json({ success: false, error: 'Licencia inválida, revocada o expirada' });
    }

    const sessionId = auth.generateSessionId();
    await db.setSession(row.id, sessionId);
    await db.touchLastLogin(row.id);
    // Las licencias "todopoderosas" (multi_device) nunca expulsan otros
    // dispositivos — están pensadas para el owner, que puede tener el panel
    // abierto en varias PCs a la vez sin cortarse entre sí.
    if (!row.multi_device) await kickOtherDevices(row.id, sessionId);

    const token = auth.signSession(row, sessionId);
    res.json({
        success: true,
        token,
        license: {
            username: row.username,
            licenseType: row.license_type,
            isAdmin: !!row.is_admin,
            expiresAt: row.expires_at,
        },
    });
});

// Logout explícito: mata la sesión server-side de inmediato (no hace falta
// esperar a que otro dispositivo se loguee para invalidar este token).
app.post('/api/auth/logout', auth.requireAuth, async (req, res) => {
    await db.setSession(req.license.id, null);
    res.json({ success: true });
});

// Re-chequeo liviano de un token ya emitido: lo usa la app de escritorio
// (que corre el juego 100% local) para confirmar cada tanto que la key
// sigue viva contra este servidor — revocada, expirada, o reemplazada por
// otro dispositivo se detectan acá sin necesitar ninguna otra infraestructura.
app.get('/api/auth/verify', auth.requireAuth, generalLimiter, (req, res) => {
    const row = req.license;
    res.json({
        success: true,
        license: {
            username: row.username,
            licenseType: row.license_type,
            isAdmin: !!row.is_admin,
            expiresAt: row.expires_at,
        },
    });
});



// ==========================================
// ADMINISTRACIÓN DE LICENCIAS (solo notbenjaa1 / cualquier licencia isAdmin)
// ==========================================
app.get('/api/licenses', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const rows = await db.listAll();
    const licenses = rows.map(row => ({
        id: row.id,
        keyPrefix: row.key_prefix,
        username: row.username,
        licenseType: row.license_type,
        isAdmin: !!row.is_admin,
        revoked: !!row.revoked,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastLoginAt: row.last_login_at,
        kingStarts: row.king_starts,
        zubStarts: row.zub_starts,
        elimStarts: row.elim_starts,
        lastActiveAt: row.last_active_at,
        multiDevice: !!row.multi_device,
    }));
    res.json({ success: true, licenses });
});

app.post('/api/licenses', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const { username, licenseType } = req.body || {};

    if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ success: false, error: 'Falta el usuario' });
    }
    if (!VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: 'Tipo de licencia inválido' });
    }

    const key = auth.generateLicenseKey();
    const row = await db.insertLicense({
        id: crypto.randomUUID(),
        keyHash: auth.hashKey(key),
        keyPrefix: auth.keyPrefix(key),
        username: username.trim(),
        licenseType,
        isAdmin: false,
        createdAt: Date.now(),
        expiresAt: auth.computeExpiresAt(licenseType),
    });

    // La key en claro se devuelve UNA sola vez: a partir de acá solo vive hasheada.
    res.json({
        success: true,
        key,
        license: {
            id: row.id, username: row.username, licenseType: row.license_type,
            createdAt: row.created_at, expiresAt: row.expires_at,
        },
    });
});

app.post('/api/licenses/:id/revoke', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    await db.revoke(row.id);
    res.json({ success: true });
});

// Licencias "todopoderosas": se saltan la restricción de un solo
// dispositivo por completo. Pensado para el owner, no para vender —
// úsalo con cuidado, cualquiera con esa key puede usarla desde donde quiera.
app.post('/api/licenses/:id/multi-device', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const { enabled } = req.body || {};
    await db.setMultiDevice(row.id, !!enabled);
    res.json({ success: true });
});

// ==========================================
// API: CARGAR Y ORDENAR REGALOS (requiere cualquier licencia válida)
// ==========================================
app.get('/api/setup/:username', auth.requireAuth, async (req, res) => {
    try {
        const username = req.params.username;
        const tempConn = new WebcastPushConnection(username);
        const gifts = await tempConn.fetchAvailableGifts();
        const validGifts = gifts
            .filter(g => g.name && g.image?.url_list?.[0])
            .map(g => ({
                id: g.id, name: g.name, coins: g.diamond_count, icon: g.image.url_list[0]
            }))
            .sort((a, b) => a.coins - b.coins);
        res.json({ success: true, gifts: validGifts });
    } catch (error) {
        res.json({ success: false });
    }
});

// ==========================================
// SOCKET.IO: autenticación en el handshake + aislamiento por room
// ==========================================
io.use(auth.socketAuthMiddleware);

io.on('connection', (socket) => {
    socket.join(socket.licenseId);
    const tenant = getOrCreateTenant(socket.licenseId);
    tenant.attachSocket(socket);
});

// Solo existe backend/public/index.html cuando el frontend se buildeó y
// copió ahí (modo "todo junto", ver scripts/copy-frontend-build.js). Si el
// frontend se despliega aparte (p. ej. Vercel), esa carpeta no existe acá
// y no hay nada que servir — devolver un 404 simple en vez de intentar un
// sendFile que rompe con ENOENT.
const FRONTEND_INDEX = path.join(__dirname, 'public', 'index.html');
app.use((req, res) => {
    if (fs.existsSync(FRONTEND_INDEX)) return res.sendFile(FRONTEND_INDEX);
    res.status(404).json({ success: false, error: 'No encontrado. Este backend solo expone la API; el frontend se sirve por separado.' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 BACKEND READY ON PORT ${PORT}\n`);
});
