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

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const db = require('./db');
const auth = require('./auth');
const pricing = require('./pricing');
const Tenant = require('./tenant');

// Uno o varios orígenes separados por coma (p. ej. el dominio de Vercel +
// un dominio propio). Con un solo valor, cors/socket.io lo tratan igual
// que antes (string simple); con varios, se pasa el array.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const CORS_ORIGIN = CORS_ORIGINS.length === 1 ? CORS_ORIGINS[0] : CORS_ORIGINS;

// URLs propias (no las de MercadoPago) para armar la preferencia de pago:
// a dónde manda la notificación (BACKEND_URL) y a dónde vuelve el streamer
// después de pagar (FRONTEND_URL, el dominio de Vercel en producción).
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
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
    const { alias } = req.body || {};
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
        return res.status(400).json({ success: false, error: 'Falta un alias' });
    }
    const cleanAlias = alias.trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanAlias) {
        return res.status(400).json({ success: false, error: 'Alias inválido — usa letras, números, "_" o "-"' });
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
        lastActiveAt: row.last_active_at,
        multiDevice: !!row.multi_device,
        trialAlias: row.trial_alias,
        trialConnectedUsername: row.trial_connected_username,
        diceTier: row.dice_tier,
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
// PAGOS: MercadoPago Checkout Pro — autoservicio total. El monto SIEMPRE se
// calcula acá desde pricing.js a partir de planType/diceTier; nunca se
// confía en un precio que mande el cliente.
// ==========================================

// Crea la preferencia de pago para la licencia del usuario logueado. Body:
// { planType?: 'month'|'annual'|'lifetime', diceTier?: 'pro'|'vip' } — al
// menos uno de los dos (compra de "solo addon" sin renovar el plan, o
// renovación de plan sin tocar el addon, son ambas válidas).
app.post('/api/payments/create-preference', auth.requireAuth, paymentLimiter, async (req, res) => {
    const { planType, diceTier } = req.body || {};
    if (planType !== undefined && !pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan inválido' });
    }
    if (diceTier !== undefined && !pricing.isValidAddon(diceTier)) {
        return res.status(400).json({ success: false, error: 'Addon inválido' });
    }
    if (!planType && !diceTier) {
        return res.status(400).json({ success: false, error: 'Elige al menos un plan o un addon' });
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
                back_urls: {
                    success: `${FRONTEND_URL}/?payment=success`,
                    pending: `${FRONTEND_URL}/?payment=pending`,
                    failure: `${FRONTEND_URL}/?payment=failure`,
                },
                auto_return: 'approved',
                notification_url: `${BACKEND_URL}/api/payments/webhook`,
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
    const secret = process.env.MP_WEBHOOK_SECRET;
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    const dataId = req.query['data.id'] || req.query['id'];

    if (!secret || !xSignature || !xRequestId || !dataId) {
        return res.sendStatus(400);
    }

    const sigParts = String(xSignature).split(',').reduce((acc, part) => {
        const [key, value] = part.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
    }, {});
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${sigParts.ts};`;
    const expectedHash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    if (!sigParts.v1 || expectedHash !== sigParts.v1) {
        // Diagnóstico sin exponer el secreto completo: si el largo del
        // secreto configurado no es el esperado, casi siempre es un
        // espacio/salto de línea de más al pegarlo en Render. Comparar los
        // primeros caracteres de ambos hashes ayuda a distinguir "secreto
        // distinto por completo" de "manifest armado distinto" sin lograr
        // filtrar nada útil para un atacante (8 caracteres de un HMAC-SHA256
        // no sirven para reconstruir nada).
        console.error('[MP] Webhook con firma inválida — descartado', {
            secretLength: secret.length,
            manifest,
            expectedPrefix: expectedHash.slice(0, 8),
            receivedPrefix: String(sigParts.v1 || '').slice(0, 8),
        });
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 BACKEND READY ON PORT ${PORT}\n`);
});
