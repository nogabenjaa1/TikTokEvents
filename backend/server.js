require('dotenv').config({ quiet: true });

// Bug conocido de tiktok-live-connector (legacy.js, getTopViewerAttributes):
// al normalizar CUALQUIER WebcastRoomUserSeqMessage (estadísticas de
// viewers, las manda TikTok solo cada tanto mientras alguien está en vivo)
// hace `ranksList.map(...)` sin chequear que `ranksList` exista — en salas
// chicas/nuevas llega undefined y explota. Pasa DENTRO de un emit síncrono
// disparado por el propio WebSocket interno de la librería, así que no hay
// forma de envolverlo en un try/catch desde nuestro código (no es un
// listener nuestro el que revienta). Sin este handler, esa excepción no
// atrapada tira abajo TODO el proceso — afecta a todas las licencias
// conectadas en ese momento, no solo a la que recibió el mensaje. Nunca
// escuchamos el evento 'roomUser' ni usamos esos datos, así que perder ese
// mensaje puntual no afecta ningún juego — es estrictamente mejor que un
// reinicio completo del backend.
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION] El proceso siguió vivo — no se reinició. Detalle:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

// Redundante a propósito con el `postinstall` de package.json: en al menos
// un deploy de Render el parche de npm install no llegó a tomar efecto
// (se seguía viendo el crash de getTopViewerAttributes con el server ya
// arriba, señal de que node_modules venía de una caché de Render restaurada
// sin volver a correr el postinstall) — así que también se aplica acá,
// síncrono, ANTES de requerir tiktok-live-connector por primera vez. Es
// idempotente y no fatal (ver el script), así que correrlo dos veces por
// deploy no tiene costo real.
try {
    require('./scripts/patch-tiktok-live-connector.js');
} catch (err) {
    console.error('[patch-tiktok-live-connector] Falló al aplicar el parche en el arranque:', err.message);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
// Ver comentario equivalente en tenant.js: WebcastPushConnection vive en el
// subpath '/legacy' en esta versión de la librería, no en el paquete raíz.
const { WebcastPushConnection } = require('tiktok-live-connector/legacy');
// El catálogo de regalos (para el selector del panel) usa a propósito la
// versión 1.2.3 vieja de la librería, instalada aparte con un alias en
// package.json (tiktok-live-connector-v1) — su getAvailableGifts() pega un
// endpoint público de TikTok que NO necesita firma de Euler Stream, a
// diferencia de fetchAvailableGifts() en la v2, que sí y quedó bloqueada
// detrás de un plan pago (ver /api/setup/:username más abajo). La conexión
// LIVE de verdad sigue siendo la v2 de arriba, sin tocar.
const { WebcastPushConnection: WebcastPushConnectionV1 } = require('tiktok-live-connector-v1');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { MercadoPagoConfig, Preference, Payment, CardToken, WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');

const multer = require('multer');

const db = require('./db');
const auth = require('./auth');
const pricing = require('./pricing');
const spotify = require('./spotify');
const storage = require('./storage');
const Tenant = require('./tenant');

// Archivos de las Alertas de regalos (imagen/gif/video/audio) — en memoria,
// nunca tocan disco: van directo de la request a Supabase Storage (ver
// storage.js). 15MB alcanza de sobra para un clip corto de alerta; frenar
// acá evita cargar archivos gigantes enteros en RAM antes de subirlos.
const uploadAlertMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const ALERT_MEDIA_TYPES = {
    'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
    'image/gif': 'gif',
    'video/mp4': 'video', 'video/webm': 'video',
    'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/mp3': 'audio', 'audio/ogg': 'audio',
};

// Uno o varios orígenes separados por coma (p. ej. el dominio de Vercel +
// un dominio propio). Con un solo valor, cors/socket.io lo tratan igual
// que antes (string simple); con varios, se pasa el array.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const CORS_ORIGIN = CORS_ORIGINS.length === 1 ? CORS_ORIGINS[0] : CORS_ORIGINS;

// URL propia (no las de MercadoPago) para armar la preferencia de pago: a
// dónde vuelve el streamer después de pagar (el dominio de Vercel en
// producción). A dónde manda la notificación NO se define acá a propósito
// (ver el comentario en create-preference más abajo, en notification_url).
const FRONTEND_URL = (process.env.FRONTEND_URL || CORS_ORIGINS[0] || 'http://localhost:5173').replace(/\/$/, '');

// Se crea perezosamente (no al levantar el server) para que el resto de la
// app siga funcionando aunque todavía no se haya cargado MP_ACCESS_TOKEN —
// solo las rutas de pago fallan hasta que se configure.
function getMpClient() {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('Falta MP_ACCESS_TOKEN en las variables de entorno');
    return new MercadoPagoConfig({ accessToken });
}

const VALID_LICENSE_TYPES = ['day', 'week', 'month', 'annual', 'lifetime'];
// Nivel de Color Says — independiente de is_admin (ver comentario en
// db.js): 'admin' acá es un nivel más que se le puede vender a cualquier
// licencia paga (Modo Seguro en el juego de dados), nunca permisos reales
// de administración de la plataforma.
const VALID_DICE_TIERS = ['regular', 'pro', 'vip', 'admin'];

// Etiqueta que va en el medio de la key legible (alias-etiqueta-hash, ver
// auth.generateLabeledKey) cuando se compra ese plan.
const PLAN_KEY_LABELS = { month: 'monthly', annual: 'yearly', lifetime: 'lifetime' };

// No bloqueante a propósito (igual que MP_ACCESS_TOKEN): si todavía no se
// configuró SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, el resto de la
// plataforma sigue funcionando igual — solo fallan las rutas de Alertas.
storage.ensureBucket().catch((err) => console.error('[Storage] No se pudo verificar el bucket de alertas al arrancar:', err.message));

const app = express();
// Render (y cualquier host detrás de un proxy/balanceador) manda el IP real
// del cliente en X-Forwarded-For — sin esto, express-rate-limit no confía
// en ese header y tira ERR_ERL_UNEXPECTED_X_FORWARDED_FOR en cada request
// a una ruta con rate limit (login, free-trial, admin, pagos, etc.).
app.set('trust proxy', 1);
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

function getOrCreateTenant(licenseId, licenseType) {
    let tenant = tenants.get(licenseId);
    if (!tenant) {
        tenant = new Tenant(licenseId, io, licenseType);
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
// Estricto a propósito: es la única barrera contra scripts pidiendo
// pruebas gratis en cadena (la barrera real es el bloqueo por usuario de
// TikTok conectado, ver tenant.js, pero esto frena el ruido de red).
const freeTrialLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
// Más generoso que el resto: a este lo llama MercadoPago server-to-server,
// no un usuario individual — un rate limit por IP demasiado estricto acá
// terminaría bloqueando notificaciones legítimas de pagos de otros streamers.
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

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
            diceTier: row.dice_tier,
            diceWinBonusUnlocked: !!row.dice_win_bonus_unlocked,
        },
    });
});

// ==========================================
// PRUEBA GRATIS: 7 días de acceso completo, autoservicio, sin tarjeta.
// El alias es texto libre (no se pide ni se valida un usuario de TikTok
// acá) — el usuario de TikTok real recién se conoce y se bloquea cuando
// esta licencia se conecta por primera vez a un LIVE (ver
// db.claimTrialConnection y tenant.js). Se loguea de una: devuelve token
// + license igual que /api/auth/login, así queda con acceso completo sin
// tener que copiar/pegar la key generada.
// ==========================================
app.post('/api/free-trial', freeTrialLimiter, async (req, res) => {
    const { alias, cardToken } = req.body || {};
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
        return res.status(400).json({ success: false, error: 'Falta un alias' });
    }
    const cleanAlias = alias.trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanAlias) {
        return res.status(400).json({ success: false, error: 'Alias inválido — usa letras, números, "_" o "-"' });
    }

    // Vía alternativa al anuncio: en vez de mirar un video, verificar una
    // tarjeta real. A propósito NO se guarda ni se cobra nada — el único
    // objetivo es subir el costo de fabricar pruebas gratis en cadena con
    // datos inventados. El token es de un solo uso y ya viene de
    // MercadoPago (tokenizado en el navegador vía Secure Fields, ver
    // CardVerifyForm.jsx); acá solo se le pregunta a MercadoPago si ese
    // token es real y pasa el chequeo de Luhn antes de dejarlo pasar.
    if (cardToken !== undefined) {
        if (typeof cardToken !== 'string' || !cardToken.trim()) {
            return res.status(400).json({ success: false, error: 'Token de tarjeta inválido' });
        }
        try {
            const tokenInfo = await new CardToken(getMpClient()).get({ id: cardToken.trim() });
            if (!tokenInfo.luhn_validation || tokenInfo.status !== 'active') {
                return res.status(400).json({ success: false, error: 'La tarjeta no pasó la validación. Verifica los datos e intenta de nuevo.' });
            }
        } catch (err) {
            console.error('[MP] Error verificando card token para prueba gratis:', err.message);
            return res.status(400).json({ success: false, error: 'No se pudo verificar la tarjeta. Intenta de nuevo.' });
        }
    }

    const key = `${cleanAlias.toLowerCase()}-FREE7DAY-${crypto.randomBytes(9).toString('base64url')}`;
    const row = await db.insertLicense({
        id: crypto.randomUUID(),
        keyHash: auth.hashKey(key),
        keyPrefix: auth.keyPrefix(key),
        username: cleanAlias,
        licenseType: 'trial',
        isAdmin: false,
        createdAt: Date.now(),
        expiresAt: auth.computeExpiresAt('trial'),
        trialAlias: cleanAlias,
    });

    const sessionId = auth.generateSessionId();
    await db.setSession(row.id, sessionId);
    const token = auth.signSession(row, sessionId);
    res.json({
        success: true,
        key,
        token,
        license: {
            username: row.username,
            licenseType: row.license_type,
            isAdmin: false,
            expiresAt: row.expires_at,
            diceTier: row.dice_tier,
            diceWinBonusUnlocked: !!row.dice_win_bonus_unlocked,
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
app.get('/api/auth/verify', auth.requireAuth, generalLimiter, async (req, res) => {
    const row = req.license;
    // De un solo uso: si el webhook de MercadoPago rotó la key (compra de un
    // plan pago, ver /api/payments/webhook), acá es donde el frontend la ve
    // por primera y única vez — se borra de la DB apenas se lee.
    if (row.pending_key_reveal) await db.consumePendingKeyReveal(row.id);
    res.json({
        success: true,
        license: {
            username: row.username,
            licenseType: row.license_type,
            isAdmin: !!row.is_admin,
            expiresAt: row.expires_at,
            diceTier: row.dice_tier,
            diceWinBonusUnlocked: !!row.dice_win_bonus_unlocked,
        },
        newKey: row.pending_key_reveal || undefined,
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
        rouletteStarts: row.roulette_starts,
        lastActiveAt: row.last_active_at,
        multiDevice: !!row.multi_device,
        trialAlias: row.trial_alias,
        trialConnectedUsername: row.trial_connected_username,
        diceTier: row.dice_tier,
        diceWinBonusUnlocked: !!row.dice_win_bonus_unlocked,
    }));
    res.json({ success: true, licenses });
});

app.post('/api/licenses', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const { username, licenseType, diceTier } = req.body || {};

    if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ success: false, error: 'Falta el usuario' });
    }
    if (!VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: 'Tipo de licencia inválido' });
    }
    if (diceTier !== undefined && !VALID_DICE_TIERS.includes(diceTier)) {
        return res.status(400).json({ success: false, error: 'Nivel de Color Says inválido' });
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
        diceTier: diceTier || 'regular',
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

// Excepción manual al WIN BONUS de Color Says (pedido explícito: dejó de
// venderse/otorgarse automático por dice_tier — por default TODA licencia
// paga tira limpio, sin importar el nivel que compró). Un admin la prende
// acá para UNA licencia puntual; dice_tier='admin' sigue teniendo el bonus
// siempre, sin depender de este flag (ver Colorsays.jsx).
app.post('/api/licenses/:id/win-bonus', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const { enabled } = req.body || {};
    await db.setWinBonusUnlocked(row.id, !!enabled);
    res.json({ success: true });
});

// Cambia el tipo/duración de una licencia existente (ej. convertir una
// prueba gratis en una licencia paga sin generar una key nueva). Reusa
// auth.computeExpiresAt igual que la creación, calculando desde ahora.
app.post('/api/licenses/:id/extend', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const { licenseType, diceTier } = req.body || {};
    if (!VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: 'Tipo de licencia inválido' });
    }
    if (!VALID_DICE_TIERS.includes(diceTier)) {
        return res.status(400).json({ success: false, error: 'Nivel de Color Says inválido' });
    }
    await db.extendLicense(row.id, licenseType, auth.computeExpiresAt(licenseType), diceTier);
    res.json({ success: true });
});

// Borrado real de la DB — a diferencia de "revocar" (que solo marca la
// fila y la conserva). Solo se permite sobre licencias ya revocadas o
// expiradas: es una barrera para no borrar sin querer una licencia paga
// activa (si se quiere borrar una activa, primero hay que revocarla).
app.delete('/api/licenses/:id', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const stillActive = !row.revoked && (row.expires_at === null || row.expires_at > Date.now());
    if (stillActive) {
        return res.status(400).json({ success: false, error: 'Revoca la licencia antes de eliminarla' });
    }
    await db.deleteLicense(row.id);
    res.json({ success: true });
});

// ==========================================
// PRECIOS DE LICENCIAS (pedido explicito: "Modificacion manual de precios de
// licencias desde el panel de administracion") -- solo admin puede editar
// (auth.requireAdmin), el precio vigente se sirve por separado en
// GET /api/pricing (publico, ver la seccion de PAGOS mas abajo) para que la
// vitrina de compra y este panel lean siempre el mismo numero.
// ==========================================
app.post('/api/admin/pricing', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const { planType, amountCents } = req.body || {};
    if (!pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan inválido' });
    }
    if (!Number.isInteger(amountCents) || amountCents < pricing.MIN_PLAN_PRICE_CENTS) {
        return res.status(400).json({ success: false, error: `El precio mínimo es de ${(pricing.MIN_PLAN_PRICE_CENTS / 100).toFixed(2)} MXN` });
    }
    try {
        const { oldAmountCents } = await pricing.setPlanPriceCents(planType, amountCents, req.license.username);
        res.json({ success: true, planType, oldAmountCents, newAmountCents: amountCents });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/pricing/history', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const rows = await db.getPricingHistory();
    res.json({
        success: true,
        history: rows.map(r => ({
            id: r.id,
            planType: r.plan_type,
            oldAmountCents: r.old_amount_cents,
            newAmountCents: r.new_amount_cents,
            changedBy: r.changed_by,
            changedAt: r.changed_at,
        })),
    });
});

// ==========================================
// SPOTIFY: cada licencia conecta SU PROPIA cuenta por OAuth (Authorization
// Code Flow) para que !play en el chat le agregue canciones a SU cola —
// ver spotify.js para las restricciones reales (Premium + dispositivo
// activo) y tenant.js (processPlayCommand/requestSpotifySong) para el
// comando en sí.
// ==========================================

// Devuelve la URL de Spotify a la que el panel redirige (window.location.href
// del lado del cliente) — el `state` lleva la licencia firmada porque el
// callback de más abajo no tiene el header Authorization disponible (es
// Spotify quien redirige al navegador, no un fetch nuestro).
app.get('/api/spotify/connect', auth.requireAuth, generalLimiter, (req, res) => {
    try {
        const state = auth.signSpotifyState(req.license.id);
        res.json({ success: true, authUrl: spotify.getAuthUrl(state) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Spotify redirige ACÁ (no al frontend) después de que el streamer autoriza
// o rechaza — de un solo uso, sin sesión propia: todo lo que necesitamos
// (a qué licencia pertenece) viene firmado en `state`.
app.get('/api/spotify/callback', generalLimiter, async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code || !state) {
        return res.redirect(`${FRONTEND_URL}/?spotify=error`);
    }
    let licenseId;
    try {
        licenseId = auth.verifySpotifyState(state);
    } catch {
        return res.redirect(`${FRONTEND_URL}/?spotify=error`);
    }
    try {
        const tokens = await spotify.exchangeCodeForTokens(code);
        const me = await spotify.getMe(tokens.access_token);
        await db.upsertSpotifyAccount(licenseId, {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
            spotifyUserId: me.id,
            displayName: me.display_name || me.id,
        });
        res.redirect(`${FRONTEND_URL}/?spotify=connected`);
    } catch (err) {
        console.error('[Spotify] Error en el callback de OAuth:', err.message);
        res.redirect(`${FRONTEND_URL}/?spotify=error`);
    }
});

app.get('/api/spotify/status', auth.requireAuth, generalLimiter, async (req, res) => {
    const account = await db.getSpotifyAccount(req.license.id);
    res.json({ success: true, connected: !!account, displayName: account?.display_name || null });
});

app.post('/api/spotify/disconnect', auth.requireAuth, generalLimiter, async (req, res) => {
    await db.deleteSpotifyAccount(req.license.id);
    res.json({ success: true });
});

// ==========================================
// ALERTAS DE REGALOS: qué recurso (imagen/gif/video/audio) se reproduce en
// el overlay al llegar un regalo puntual — ver tenant.js (processGiftAlert)
// para el disparo en vivo y storage.js para dónde vive el archivo.
// ==========================================
// Mismas listas que ANIMATION_IN_OPTIONS/ANIMATION_OUT_OPTIONS en
// AlertsAdmin.jsx — 'none' significa "sin animación, aparece/desaparece
// de golpe"; 'bounce' es exclusivo de entrada (no tiene mucho sentido
// como salida, ver Overlay.jsx).
const ENTRANCE_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'bounce'];
const EXIT_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom'];

function serializeAlert(row) {
    return {
        id: row.id, giftName: row.gift_name, mediaUrl: row.media_url,
        mediaType: row.media_type, durationMs: row.duration_ms, position: row.position,
        entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
    };
}

app.get('/api/alerts', auth.requireAuth, generalLimiter, async (req, res) => {
    const alerts = await db.listAlertConfigs(req.license.id);
    res.json({ success: true, alerts: alerts.map(serializeAlert) });
});

// multipart/form-data: `media` es el archivo, `giftName`/`durationMs`/
// `position`/`entranceAnim`/`exitAnim` van como campos de texto normales
// del mismo form.
app.post('/api/alerts', auth.requireAuth, generalLimiter, uploadAlertMedia.single('media'), async (req, res) => {
    const { giftName, durationMs, position, entranceAnim, exitAnim } = req.body || {};
    if (!giftName || typeof giftName !== 'string' || !giftName.trim()) {
        return res.status(400).json({ success: false, error: 'Falta el nombre del regalo' });
    }
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Falta el archivo de la alerta' });
    }
    const mediaType = ALERT_MEDIA_TYPES[req.file.mimetype];
    if (!mediaType) {
        return res.status(400).json({ success: false, error: `Formato no soportado: ${req.file.mimetype}` });
    }
    const finalPosition = ['center', 'top', 'bottom', 'left', 'right'].includes(position) ? position : 'center';
    const finalDuration = Math.max(1000, Math.min(15000, Number(durationMs) || 5000));
    const finalEntranceAnim = ENTRANCE_ANIMS.includes(entranceAnim) ? entranceAnim : 'fade';
    const finalExitAnim = EXIT_ANIMS.includes(exitAnim) ? exitAnim : 'fade';

    try {
        // Si ya había una alerta para este regalo, borra su archivo viejo del
        // storage antes de subir el nuevo — sin esto quedarían archivos
        // huérfanos en el bucket cada vez que el streamer cambia una alerta.
        const existing = (await db.listAlertConfigs(req.license.id))
            .find((row) => row.gift_name.toLowerCase() === giftName.trim().toLowerCase());
        if (existing) await storage.deleteFile(existing.media_path);

        const id = crypto.randomUUID();
        const ext = (req.file.originalname.match(/\.[a-zA-Z0-9]+$/) || [''])[0];
        const mediaPath = `${req.license.id}/${id}${ext}`;
        const mediaUrl = await storage.uploadFile(mediaPath, req.file.buffer, req.file.mimetype);

        const row = await db.upsertAlertConfig({
            id, licenseId: req.license.id, giftName: giftName.trim(),
            mediaUrl, mediaPath, mediaType, durationMs: finalDuration, position: finalPosition,
            entranceAnim: finalEntranceAnim, exitAnim: finalExitAnim,
        });
        // Mantiene al día el cache en memoria que usa processGiftAlert —
        // sin esto, la alerta recién guardada no dispararía hasta el
        // próximo reinicio del server (o de este Tenant en memoria).
        getOrCreateTenant(req.license.id, req.license.license_type).setAlertConfig(row.gift_name, serializeAlert(row));
        res.json({ success: true, alert: serializeAlert(row) });
    } catch (err) {
        console.error('[Alertas] Error subiendo la alerta:', err.message);
        res.status(500).json({ success: false, error: 'No se pudo guardar la alerta — revisa que Supabase Storage esté configurado.' });
    }
});

app.delete('/api/alerts/:id', auth.requireAuth, generalLimiter, async (req, res) => {
    const row = await db.getAlertConfig(req.params.id);
    if (!row || row.license_id !== req.license.id) {
        return res.status(404).json({ success: false, error: 'Alerta no encontrada' });
    }
    await storage.deleteFile(row.media_path);
    await db.deleteAlertConfig(row.id, req.license.id);
    getOrCreateTenant(req.license.id, req.license.license_type).removeAlertConfig(row.gift_name);
    res.json({ success: true });
});

// ==========================================
// PAGOS: MercadoPago Checkout Pro — autoservicio total. El monto SIEMPRE se
// calcula acá desde pricing.js a partir de planType/diceTier; nunca se
// confía en un precio que mande el cliente.
// ==========================================

// Crea la preferencia de pago para la licencia del usuario logueado. Body:
// { planType?: 'month'|'annual'|'lifetime', diceTier?: 'pro'|'vip' } — al
// menos uno de los dos (compra de "solo addon" sin renovar el plan, o
// renovación de plan sin tocar el addon, son ambas válidas).
// Precios vigentes de los 3 planes (override del admin si existe, default
// de pricing.js si no) -- publica a proposito, sin auth: la vitrina de
// Membership.jsx la necesita ANTES de que exista una sesion (ver el
// comentario de "Anonymous purchase flow" en Membership.jsx).
app.get('/api/pricing', (req, res) => {
    res.json({ success: true, prices: pricing.getAllPlanPricesCents() });
});

app.post('/api/payments/create-preference', auth.requireAuth, paymentLimiter, async (req, res) => {
    const { planType, diceTier, email } = req.body || {};
    if (planType !== undefined && !pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan inválido' });
    }
    if (diceTier !== undefined && !pricing.isValidAddon(diceTier)) {
        return res.status(400).json({ success: false, error: 'Addon inválido' });
    }
    if (!planType && !diceTier) {
        return res.status(400).json({ success: false, error: 'Elige al menos un plan o un addon' });
    }
    // Pedido explícito de MercadoPago (mitiga el rechazo "por motivos de
    // seguridad" del motor antifraude en México): la preferencia SIEMPRE
    // debe llevar payer.email -- nunca se confía en que el front lo mande
    // bien formado, se revalida acá igual que planType/diceTier.
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'Ingresa un correo válido para continuar con el pago' });
    }

    const amountCents = pricing.computeAmountCents({ planType, diceTier });
    // external_reference es lo único en lo que el webhook confía para saber
    // qué licencia tocar y qué se compró — viene de req.license.id (la
    // licencia del token, no de nada que mande el body), así un cliente no
    // puede pedir una preferencia para la licencia de otro.
    const externalReference = `${req.license.id}:${planType || '-'}:${diceTier || '-'}`;
    const titleParts = [];
    if (planType) titleParts.push({ month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' }[planType]);
    if (diceTier) titleParts.push(diceTier.toUpperCase());

    try {
        const preference = new Preference(getMpClient());
        const result = await preference.create({
            body: {
                items: [{
                    id: externalReference,
                    title: `TikTokEvents - ${titleParts.join(' + ')}`,
                    quantity: 1,
                    currency_id: 'MXN',
                    unit_price: amountCents / 100,
                }],
                external_reference: externalReference,
                payer: { email: cleanEmail },
                back_urls: {
                    success: `${FRONTEND_URL}/?payment=success`,
                    pending: `${FRONTEND_URL}/?payment=pending`,
                    failure: `${FRONTEND_URL}/?payment=failure`,
                },
                auto_return: 'approved',
                // A propósito SIN notification_url acá: MercadoPago
                // documenta que la URL configurada al crear una preferencia
                // TIENE PRIORIDAD sobre la configurada en el dashboard
                // ("Tus integraciones" > Webhooks), y esa vía alternativa
                // no queda documentada con el mismo esquema de firma
                // (x-signature/HMAC) que sí aplica al método del dashboard
                // -- verificado en producción: una notificación de PRUEBA
                // disparada desde el dashboard SÍ validó bien contra
                // MP_WEBHOOK_SECRET, mientras que las de compras reales
                // (que sí pisaban esta URL acá) daban SignatureMismatch
                // siempre. Dejar que MP use la URL del dashboard para TODO
                // evita ese canal separado. Requiere que la URL configurada
                // ahí sea exactamente la URL de este backend + /api/payments/webhook.
            },
        });
        res.json({ success: true, checkoutUrl: result.init_point });
    } catch (err) {
        console.error('[MP] Error creando preferencia:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.' });
    }
});

// Notificación server-to-server de MercadoPago. Sin auth de sesión (MP no
// tiene el JWT de la app) — la validación es la firma HMAC del header
// x-signature contra MP_WEBHOOK_SECRET, documentada acá:
// https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
app.post('/api/payments/webhook', webhookLimiter, async (req, res) => {
    const secret = (process.env.MP_WEBHOOK_SECRET || '').trim();
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    const dataId = req.query['data.id'] || req.query['id'];

    if (!secret || !dataId) {
        return res.sendStatus(400);
    }

    // Validador OFICIAL del SDK (mercadopago >= 3.x lo trae de fábrica) en
    // vez del HMAC armado a mano que había acá antes -- mismo algoritmo
    // (verificado byte a byte contra la implementación manual), pero de
    // paso da un motivo puntual de rechazo (SignatureFailureReason) en vez
    // de un genérico "no coincide", que ayuda muchísimo a diagnosticar la
    // próxima vez que esto falle (secreto vencido vs. header ausente vs.
    // timestamp fuera de rango, etc.).
    try {
        WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret });
    } catch (err) {
        const reason = err instanceof InvalidWebhookSignatureError ? err.reason : err.message;
        console.error('[MP] Webhook con firma inválida — descartado', { reason, dataId, xRequestId, secretLength: secret.length });
        return res.sendStatus(401);
    }

    // Se responde 200 apenas la firma es válida: MercadoPago reintenta la
    // notificación si no contesta rápido, y lo que sigue (consultar el pago
    // real contra la API de MP + escribir en la DB) puede tardar un poco.
    res.sendStatus(200);

    if (req.query.type !== 'payment' && req.body?.type !== 'payment') return;

    try {
        const payment = new Payment(getMpClient());
        const paymentData = await payment.get({ id: dataId });
        if (paymentData.status !== 'approved') return;

        const [licenseId, planTypeRaw, diceTierRaw] = String(paymentData.external_reference || '').split(':');
        const planType = planTypeRaw && planTypeRaw !== '-' ? planTypeRaw : undefined;
        const diceTier = diceTierRaw && diceTierRaw !== '-' ? diceTierRaw : undefined;
        if (!licenseId || (!planType && !diceTier)) {
            console.error('[MP] Webhook con external_reference inválido:', paymentData.external_reference);
            return;
        }

        // El UNIQUE sobre mp_payment_id hace esto idempotente: si ya vimos
        // este pago (reintento de notificación), insertPaymentIfNew devuelve
        // false y no se vuelve a aplicar nada.
        const isNew = await db.insertPaymentIfNew({
            id: crypto.randomUUID(),
            licenseId,
            mpPaymentId: String(paymentData.id),
            planType: planType || null,
            diceTier: diceTier || null,
            amountCents: pricing.computeAmountCents({ planType, diceTier }),
            status: paymentData.status,
            createdAt: Date.now(),
        });
        if (!isNew) return;

        const license = await db.findById(licenseId);
        if (!license) {
            console.error('[MP] Webhook para una licencia inexistente:', licenseId);
            return;
        }

        const update = {};
        if (planType) {
            update.licenseType = planType;
            // Si venía de una prueba gratis con días sin usar, esos días se
            // suman arriba del plan nuevo en vez de perderse — pedido
            // explícito para que pasar de trial a pago no se sienta como
            // "perder lo que ya tenía". No aplica a lifetime (no vence).
            const remainingTrialMs = (license.license_type === 'trial' && license.expires_at && license.expires_at > Date.now())
                ? (license.expires_at - Date.now())
                : 0;
            const baseExpiresAt = auth.computeExpiresAt(planType);
            update.expiresAt = baseExpiresAt === null ? null : baseExpiresAt + remainingTrialMs;

            // Rota la key para que el prefijo refleje el plan nuevo
            // (alias-MONTHLY-hash, etc. — pedido explícito, ver
            // auth.generateLabeledKey). Mismo id/sesión: solo cambia la key
            // en sí, así que cualquier sesión ya abierta sigue funcionando,
            // pero la URL del overlay vieja (que lleva la key vieja
            // incrustada) deja de servir — pending_key_reveal es lo que le
            // permite al frontend mostrarle la key nueva la próxima vez que
            // llama a /api/auth/verify, para que la actualice en OBS.
            const newRawKey = auth.generateLabeledKey(license.username, PLAN_KEY_LABELS[planType] || planType.toLowerCase());
            update.keyHash = auth.hashKey(newRawKey);
            update.keyPrefix = auth.keyPrefix(newRawKey);
            update.pendingKeyReveal = newRawKey;
        }
        if (diceTier) {
            // Nunca degradar: si ya tenía VIP y compra PRO por error/de nuevo,
            // se queda con VIP.
            const currentRank = pricing.DICE_TIER_RANK[license.dice_tier] ?? 0;
            const newRank = pricing.DICE_TIER_RANK[diceTier] ?? 0;
            if (newRank > currentRank) update.diceTier = diceTier;
        }
        if (Object.keys(update).length > 0) {
            await db.applyPurchase(licenseId, update);
            console.log(`[MP] ✅ Pago aplicado — licencia ${licenseId}:`, update);
        }
    } catch (err) {
        console.error('[MP] Error procesando webhook:', err.message);
    }
});

// ==========================================
// API: CARGAR Y ORDENAR REGALOS (requiere cualquier licencia válida)
// ==========================================
app.get('/api/setup/:username', auth.requireAuth, async (req, res) => {
    try {
        const username = req.params.username;
        // v1 a propósito acá — ver comentario del import de arriba.
        const tempConn = new WebcastPushConnectionV1(username);
        const gifts = await tempConn.getAvailableGifts();
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
    const tenant = getOrCreateTenant(socket.licenseId, socket.licenseType);
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

// Fire-and-forget (mismo criterio que otros catch silenciosos de arranque
// en este archivo): si Supabase esta caido justo al arrancar, el proceso
// sigue con los precios default de PLAN_PRICES_CENTS en vez de no levantar
// -- el admin puede volver a guardar el precio despues para reintentar.
pricing.loadPriceOverrides().catch(err => console.error('[PRICING] No se pudieron cargar los overrides de precio al arrancar:', err.message));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 BACKEND READY ON PORT ${PORT}\n`);
});
