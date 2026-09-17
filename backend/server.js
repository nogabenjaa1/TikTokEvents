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
const helmet = require('helmet');

const { MercadoPagoConfig, WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');
const Stripe = require('stripe');

const multer = require('multer');

const db = require('./db');
const auth = require('./auth');
const pricing = require('./pricing');
const spotify = require('./spotify');
const storage = require('./storage');
const Tenant = require('./tenant');
const downloader = require('./downloader');

// Archivos de las Alertas de regalos (imagen/gif/video/audio) — en memoria,
// nunca tocan disco: van directo de la request a Supabase Storage (ver
// storage.js). 15MB alcanza de sobra para un clip corto de alerta; frenar
// acá evita cargar archivos gigantes enteros en RAM antes de subirlos.
// Pedido explicito: visual (imagen/gif/video) y audio son dos campos
// independientes del mismo form -- `.fields()` en vez de `.single()`
// porque ahora puede venir uno, el otro, o los dos juntos.
const uploadAlertMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
    .fields([{ name: 'visual', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);
const ALERT_VISUAL_TYPES = {
    'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
    'image/gif': 'gif',
    'video/mp4': 'video', 'video/webm': 'video',
};
const ALERT_AUDIO_TYPES = {
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

// URL propia (no las de MercadoPago) -- la usan los redirects de Spotify
// para volver al dominio correcto (Vercel en producción) despues de
// conectar/desconectar una cuenta.
const FRONTEND_URL = (process.env.FRONTEND_URL || CORS_ORIGINS[0] || 'http://localhost:5173').replace(/\/$/, '');

// Se crea perezosamente (no al levantar el server) para que el resto de la
// app siga funcionando aunque todavía no se haya cargado MP_ACCESS_TOKEN —
// solo las rutas de pago fallan hasta que se configure.
// Interruptor MP_TEST_MODE (pedido explícito, para probar compras con
// las tarjetas de prueba de MP sin arriesgar el Access Token real): en vez
// de pisar MP_ACCESS_TOKEN con el de prueba en Render (fácil de olvidar
// devolver, y ahí sí se dejaría de cobrar en producción sin que nadie se
// dé cuenta), esto solo cambia CUÁL variable se lee -- MP_ACCESS_TOKEN de
// producción queda intacto todo el tiempo, listo para volver apagando el
// flag.
function getMpAccessToken() {
    const testMode = process.env.MP_TEST_MODE === 'true';
    const envVar = testMode ? 'MP_ACCESS_TOKEN_TEST' : 'MP_ACCESS_TOKEN';
    const accessToken = process.env[envVar];
    if (!accessToken) throw new Error(`Falta ${envVar} en las variables de entorno`);
    return accessToken;
}

function getMpClient() {
    return new MercadoPagoConfig({ accessToken: getMpAccessToken() });
}

// Mismo criterio perezoso que getMpClient: no revienta el arranque del
// server si todavia no se configuro STRIPE_SECRET_KEY -- solo fallan las
// rutas de pago con Stripe hasta que se agregue. A diferencia de MP, la
// propia llave de Stripe ya indica si es de prueba o en vivo por su
// prefijo (sk_test_/sk_live_), asi que no hace falta un flag aparte tipo
// MP_TEST_MODE.
function getStripeClient() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error('Falta STRIPE_SECRET_KEY en las variables de entorno');
    return new Stripe(secretKey);
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
// Formato de email valido para el cobro directo (charge).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El Card Payment Brick a veces devuelve un payment_method_id mas
// especifico que la marca generica (ej. "debmaster" para debito
// Mastercard de ciertos bancos/fintechs como Nubank) aunque el logo
// mostrado sea el generico -- bug real encontrado en produccion: la
// Orders API (a diferencia de la vieja Payments API) solo acepta
// amex/master/visa en payment_method.id, y rechaza cualquier otra cosa
// con "value must be one of amex, master, visa". Se normaliza por
// substring en vez de una lista fija de valores conocidos, para cubrir
// variantes que no hemos visto todavia sin tener que ir agregandolas a
// mano cada vez que aparece una nueva.
// Bug de seguridad real encontrado y corregido: los logs de
// /api/payments/charge (tanto el de exito como el de error) mandaban el
// JSON crudo de la respuesta de MercadoPago tal cual a Render, que
// incluye transactions.payments[].payment_method.token -- el token de
// tarjeta tokenizado (de un solo uso, pero igual un dato sensible que no
// deberia quedar en texto plano en logs). Se redacta antes de loguear.
function redactOrderTokens(orderResult) {
    try {
        const clone = JSON.parse(JSON.stringify(orderResult));
        clone?.transactions?.payments?.forEach((p) => {
            if (p?.payment_method?.token) p.payment_method.token = '[REDACTADO]';
        });
        return clone;
    } catch {
        return orderResult;
    }
}
function normalizeCardBrand(paymentMethodId) {
    const raw = String(paymentMethodId || '').toLowerCase();
    if (raw.includes('amex')) return 'amex';
    if (raw.includes('master')) return 'master';
    if (raw.includes('visa')) return 'visa';
    return paymentMethodId;
}

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
// Cabeceras de seguridad estandar (X-Frame-Options, X-Content-Type-
// Options, Strict-Transport-Security, Referrer-Policy, quita X-Powered-
// By, etc.) -- pedido explicito de una revision de seguridad del sitio.
// A proposito SIN Content-Security-Policy ni Cross-Origin-Embedder-
// Policy: el sitio carga Google AdSense, Adsterra y el SDK de
// MercadoPago (que a su vez carga reCAPTCHA) desde muchisimos dominios
// de terceros -- una CSP mal armada podria romper en silencio los
// anuncios (ingresos) o el cobro con tarjeta (lo mas critico del sitio,
// recien estabilizado) sin que se note hasta que alguien reporte el
// problema. Si se quiere una CSP real, hay que armarla con tiempo y
// probar cada integracion de terceros a mano, no activarla a ciegas.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// Stripe firma su webhook sobre los bytes CRUDOS del body -- tiene que
// consumirse asi, antes del express.json() general de la linea de abajo,
// o stripe.webhooks.constructEvent() no puede validar la firma contra un
// objeto ya parseado. body-parser marca el request como ya parseado
// (req._body) apenas esto corre, asi que el express.json() de mas abajo
// no lo vuelve a tocar para esta ruta puntual -- el handler real de esta
// ruta vive mas abajo, junto a los demas endpoints de pago.
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
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
// Mas generoso: el frontend hace polling corto de esto mientras el
// comprador completa el challenge 3DS en su banco (ver
// /api/payments/orders/:orderId/status).
const paymentStatusLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
// Más generoso que el resto: a este lo llama MercadoPago server-to-server,
// no un usuario individual — un rate limit por IP demasiado estricto acá
// terminaría bloqueando notificaciones legítimas de pagos de otros streamers.
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
// Reporte de errores de tarjeta que Stripe.js resuelve DIRECTO en el
// navegador (confirmSetup/confirmPayment) -- sin auth a propósito (la
// verificación de tarjeta de la prueba gratis pasa pre-login), asi que
// este limite es lo unico que frena el ruido/abuso.
const stripeClientErrorLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
// Downloader: /info y /start son acciones puntuales (parecido a
// paymentLimiter) -- pesadas para el server (yt-dlp + ffmpeg), asi que
// mas estrictas. /status en cambio se poll-ea cada ~1s DESDE EL MISMO
// job mientras dura una descarga (puede tardar minutos) -- necesita un
// limite mucho mas generoso o un solo job largo lo agotaria solo.
const downloaderActionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const downloaderStatusLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });

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

// Crea el SetupIntent que CardVerifyForm.jsx confirma con el Payment
// Element de Stripe -- pre-login a propósito (todavía no existe ninguna
// licencia/sesión en este punto, es lo que este mismo flujo está por
// crear). Sin auth.requireAuth, pero sí con freeTrialLimiter (mismo
// presupuesto que /api/free-trial, ver el comentario ahí abajo: las dos
// rutas son dos pasos de un mismo flujo). "Setup" (no "Payment") porque
// nunca se cobra nada -- el objetivo es solo que Stripe autentique que la
// tarjeta es real (puede pedir 3DS), no capturar un monto.
app.post('/api/free-trial/setup-intent', freeTrialLimiter, async (req, res) => {
    try {
        const stripe = getStripeClient();
        // usage: 'on_session' (no el default 'off_session') -- 'off_session'
        // le hace mostrar al streamer un texto de consentimiento tipo
        // "permites que BenjaApis cargue tu tarjeta en el futuro", que acá
        // sería engañoso: esta tarjeta NUNCA se cobra, ni ahora ni después.
        const intent = await stripe.setupIntents.create({ payment_method_types: ['card'], usage: 'on_session' });
        res.json({ success: true, clientSecret: intent.client_secret });
    } catch (err) {
        console.error('[Stripe] Error creando SetupIntent para prueba gratis:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo iniciar la verificación de tarjeta. Intenta de nuevo en un momento.' });
    }
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
    const { alias, setupIntentId } = req.body || {};
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
        return res.status(400).json({ success: false, error: 'Falta un alias' });
    }
    const cleanAlias = alias.trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanAlias) {
        return res.status(400).json({ success: false, error: 'Alias inválido — usa letras, números, "_" o "-"' });
    }

    // Vía alternativa al anuncio: en vez de mirar un video, verificar una
    // tarjeta real con Stripe. A propósito NO se cobra nada -- el
    // SetupIntent autentica la tarjeta (puede pedir 3DS, mucho más fuerte
    // que un simple chequeo de Luhn) sin capturar ningún monto. Pedido
    // explícito: a diferencia de la verificación vieja de MercadoPago (que
    // no comparaba nada entre pruebas), acá SÍ se guarda el fingerprint
    // estable de la tarjeta (trial_card_fingerprint, UNIQUE parcial en
    // licenses, ver db.js) para que la misma tarjeta física no pueda
    // reclamar una segunda prueba gratis con otro alias.
    let trialCardFingerprint = null;
    if (setupIntentId !== undefined) {
        if (typeof setupIntentId !== 'string' || !setupIntentId.trim()) {
            return res.status(400).json({ success: false, error: 'Verificación de tarjeta inválida' });
        }
        try {
            const stripe = getStripeClient();
            const intent = await stripe.setupIntents.retrieve(setupIntentId.trim(), { expand: ['payment_method'] });
            if (intent.status !== 'succeeded') {
                return res.status(400).json({ success: false, error: 'La tarjeta no pasó la verificación de seguridad. Verifica los datos e intenta de nuevo.' });
            }
            trialCardFingerprint = intent.payment_method?.card?.fingerprint || null;
        } catch (err) {
            console.error('[Stripe] Error verificando SetupIntent para prueba gratis:', err.message);
            return res.status(400).json({ success: false, error: 'No se pudo verificar la tarjeta. Intenta de nuevo.' });
        }
    }

    const key = `${cleanAlias.toLowerCase()}-FREE7DAY-${crypto.randomBytes(9).toString('base64url')}`;
    let row;
    try {
        row = await db.insertLicense({
            id: crypto.randomUUID(),
            keyHash: auth.hashKey(key),
            keyPrefix: auth.keyPrefix(key),
            username: cleanAlias,
            licenseType: 'trial',
            isAdmin: false,
            createdAt: Date.now(),
            expiresAt: auth.computeExpiresAt('trial'),
            trialAlias: cleanAlias,
            trialCardFingerprint,
        });
    } catch (err) {
        // El UNIQUE parcial de trial_card_fingerprint es quien de verdad
        // impide dos pruebas con la misma tarjeta -- acá solo se traduce
        // ese rechazo a un mensaje claro (mismo patrón que
        // idx_licenses_trial_connected en tenant.js).
        if (err.code === '23505' && err.constraint === 'idx_licenses_trial_card_fingerprint') {
            return res.status(400).json({ success: false, error: 'Esta tarjeta ya se usó para una prueba gratis.' });
        }
        throw err;
    }

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
// fila y la conserva). Pedido explicito: que "Eliminar" sea un solo paso
// para el admin (antes exigia revocar aparte primero) -- si la licencia
// todavia esta activa, la revoca acá mismo antes de borrarla, en vez de
// devolver un error pidiendo que se revoque a mano.
app.delete('/api/licenses/:id', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    if (row.is_admin) return res.status(400).json({ success: false, error: 'No se puede eliminar una licencia admin' });
    if (!row.revoked) await db.revoke(row.id);
    await db.deleteLicense(row.id);
    res.json({ success: true });
});

// Eliminacion en bloque (pedido explicito: evitar revocar+eliminar
// licencia por licencia una por una). Mismo criterio que el borrado
// individual de arriba (auto-revoca si hace falta, nunca toca admins) --
// un solo request en vez de N, así el adminLimiter no se agota con listas
// grandes. Sigue de largo con las demás si una puntual falla, en vez de
// abortar todo el lote.
app.post('/api/licenses/bulk-delete', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.filter(id => typeof id === 'string' && id))] : [];
    if (ids.length === 0) return res.status(400).json({ success: false, error: 'No se seleccionó ninguna licencia' });

    let deleted = 0;
    const skipped = [];
    for (const id of ids) {
        try {
            const row = await db.findById(id);
            if (!row) { skipped.push(id); continue; }
            if (row.is_admin) { skipped.push(id); continue; }
            if (!row.revoked) await db.revoke(row.id);
            await db.deleteLicense(row.id);
            deleted++;
        } catch (err) {
            console.error('[licenses] Error eliminando en bloque', id, err.message);
            skipped.push(id);
        }
    }
    res.json({ success: true, deleted, skipped: skipped.length });
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
// ALERTAS: qué se reproduce en el overlay al llegar un disparador puntual
// -- un regalo especifico, seguimiento, o sticker personalizado del club
// de fans (los dos ultimos son pedido explicito: "aplica lo de los
// seguimientos tambien para las alertas normales") -- ver tenant.js
// (processAlertTrigger) para el disparo en vivo y storage.js para dónde
// viven los archivos. Visual (imagen/gif/video, con mute opcional) y
// audio son DOS recursos independientes y opcionales, mas un texto
// tambien opcional -- pedido explicito: cualquier combinacion vale
// (imagen sola, audio solo, video mudo + audio aparte, solo texto, etc.)
// mientras venga al menos uno de los tres.
// ==========================================
// Disparadores que no son un regalo puntual -- gift_name guarda esta
// misma clave fija para esos casos (ver el comentario de la tabla en
// db.js). 'gift' usa el nombre real del regalo elegido en el panel.
const NON_GIFT_TRIGGER_TYPES = ['follow', 'sticker'];
// 'gift_global' (pedido explícito: "alertas globales" además de las
// específicas de siempre) no tiene un regalo fijo -- se dispara con
// cualquier regalo SIN alerta específica propia que alcance el mínimo de
// monedas configurado (`minCoins`, ver más abajo y findGlobalAlertForCoins
// en tenant.js). A diferencia de 'follow'/'sticker' (una sola alerta
// posible, clave fija), puede haber VARIAS alertas 'gift_global' -- una
// por cada mínimo distinto que el streamer quiera -- así que no entra en
// NON_GIFT_TRIGGER_TYPES (esa lista asume una clave fija por tipo).
const VALID_TRIGGER_TYPES = ['gift', 'gift_global', ...NON_GIFT_TRIGGER_TYPES];
// Mismas etiquetas que TRIGGER_LABELS en AlertsAdmin.jsx — solo para el
// mensaje de conflicto de disparador de abajo.
const TRIGGER_LABEL_ES = { follow: 'Seguimiento', sticker: 'Sticker de club de fans', gift_global: 'Alerta general' };
const MIN_COINS_CAP = 999999;
// Mismas listas que ANIMATION_IN_OPTIONS/ANIMATION_OUT_OPTIONS en
// AlertsAdmin.jsx — 'none' significa "sin animación, aparece/desaparece
// de golpe"; 'bounce' es exclusivo de entrada (no tiene mucho sentido
// como salida, ver Overlay.jsx).
const ENTRANCE_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'bounce'];
const EXIT_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom'];

const TEXT_POSITIONS = ['above', 'below', 'beside'];

function serializeAlert(row) {
    return {
        id: row.id, giftName: row.gift_name,
        visualUrl: row.visual_url, visualType: row.visual_type, visualMuted: !!row.visual_muted,
        audioUrl: row.audio_url,
        text: row.alert_text || '', textPosition: row.text_position || 'below',
        durationMs: row.duration_ms, position: row.position,
        entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
        triggerType: row.trigger_type || 'gift',
        minCoins: row.min_coins != null ? Number(row.min_coins) : null,
    };
}

app.get('/api/alerts', auth.requireAuth, generalLimiter, async (req, res) => {
    const alerts = await db.listAlertConfigs(req.license.id);
    res.json({ success: true, alerts: alerts.map(serializeAlert) });
});

// multipart/form-data: `visual`/`audio` son los dos archivos (cada uno
// opcional, ver uploadAlertMedia arriba); el resto va como campos de texto
// normales del mismo form. Pedido explicito: visual/audio/texto son TRES
// recursos independientes, cualquier combinacion vale (solo imagen, solo
// audio, solo texto, video mudo + audio aparte, etc.) mientras venga al
// menos uno de los tres.
// Edicion sin re-subir archivo: si el form no trae un archivo nuevo para
// visual/audio, se mantiene el que ya tenía guardado -- `clearVisual`/
// `clearAudio` (booleanos de texto) son la forma explícita de borrar un
// recurso sin tener que borrar la alerta entera.
// `alertId` (opcional): pedido explicito -- al editar, TODO se puede
// cambiar, incluido a qué disparador (regalo/evento) está asignada. Sin
// esto, cambiar el disparador durante una edición dejaba la fila VIEJA
// huérfana en la DB (el upsert solo choca por license_id+gift_name, así
// que una clave nueva simplemente insertaba una fila aparte) -- con
// `alertId` se ubica la fila real que se está editando por id, y si el
// disparador cambió, se borra la fila vieja después de resolver qué
// recurso se lleva a la nueva.
app.post('/api/alerts', auth.requireAuth, generalLimiter, uploadAlertMedia, async (req, res) => {
    const { giftName, durationMs, position, entranceAnim, exitAnim, text, alertId } = req.body || {};
    const triggerType = VALID_TRIGGER_TYPES.includes(req.body?.triggerType) ? req.body.triggerType : 'gift';
    // Para 'gift' la clave es el nombre real elegido en el panel; 'follow'/
    // 'sticker' usan su propio nombre fijo (nunca chocan con un regalo real
    // de TikTok, que jamas se llamaria literal "follow"); 'gift_global' usa
    // el mínimo de monedas (puede haber varias, una por cada mínimo
    // distinto, a diferencia de los otros dos que solo admiten una).
    let triggerKey;
    let minCoins = null;
    if (triggerType === 'gift') {
        if (!giftName || typeof giftName !== 'string' || !giftName.trim()) {
            return res.status(400).json({ success: false, error: 'Falta el nombre del regalo' });
        }
        triggerKey = giftName.trim();
    } else if (triggerType === 'gift_global') {
        minCoins = Math.trunc(Number(req.body?.minCoins));
        if (!Number.isFinite(minCoins) || minCoins < 1 || minCoins > MIN_COINS_CAP) {
            return res.status(400).json({ success: false, error: `El mínimo de monedas debe ser un número entre 1 y ${MIN_COINS_CAP}` });
        }
        triggerKey = `global:${minCoins}`;
    } else {
        triggerKey = triggerType;
    }

    const visualFile = req.files?.visual?.[0];
    const audioFile = req.files?.audio?.[0];
    let visualFileType;
    if (visualFile) {
        visualFileType = ALERT_VISUAL_TYPES[visualFile.mimetype];
        if (!visualFileType) {
            return res.status(400).json({ success: false, error: `Formato de imagen/video no soportado: ${visualFile.mimetype}` });
        }
    }
    if (audioFile && !ALERT_AUDIO_TYPES[audioFile.mimetype]) {
        return res.status(400).json({ success: false, error: `Formato de audio no soportado: ${audioFile.mimetype}` });
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 200) : '';
    const finalTextPosition = TEXT_POSITIONS.includes(req.body?.textPosition) ? req.body.textPosition : 'below';
    const visualMuted = req.body?.visualMuted === 'true';
    const clearVisual = req.body?.clearVisual === 'true';
    const clearAudio = req.body?.clearAudio === 'true';
    const finalPosition = ['center', 'top', 'bottom', 'left', 'right'].includes(position) ? position : 'center';
    const finalDuration = Math.max(1000, Math.min(15000, Number(durationMs) || 5000));
    const finalEntranceAnim = ENTRANCE_ANIMS.includes(entranceAnim) ? entranceAnim : 'fade';
    const finalExitAnim = EXIT_ANIMS.includes(exitAnim) ? exitAnim : 'fade';

    try {
        // La fila que se está EDITANDO (si vino alertId y es de esta
        // licencia) vs. la fila que ya ocupa el disparador DESTINO (puede
        // ser la misma, otra distinta, o ninguna).
        const editingRow = alertId ? await db.getAlertConfig(alertId) : null;
        const isEditing = !!editingRow && editingRow.license_id === req.license.id;
        const occupyingRow = (await db.listAlertConfigs(req.license.id))
            .find((row) => row.gift_name.toLowerCase() === triggerKey.toLowerCase());

        // Si el disparador destino ya lo usa OTRA alerta (no la que se está
        // editando), no se pisa en silencio -- el streamer tiene que
        // resolverlo a mano primero (borrar esa otra, o elegir otro
        // disparador).
        if (occupyingRow && (!isEditing || occupyingRow.id !== editingRow.id)) {
            const conflictLabel = triggerType === 'gift' ? triggerKey
                : triggerType === 'gift_global' ? `general de ${minCoins} monedas`
                : TRIGGER_LABEL_ES[triggerType] || triggerKey;
            const conflictNoun = triggerType === 'gift_global' ? 'mínimo' : 'disparador';
            return res.status(409).json({ success: false, error: `Ya existe una alerta para "${conflictLabel}" — bórrala primero o elige otro ${conflictNoun}.` });
        }

        // De qué fila se heredan los recursos no tocados: la que se está
        // editando (por id) si la hay, si no la que ya ocupaba ESTE mismo
        // disparador (guardar de nuevo sobre la misma clave sin pasar por
        // "Editar" también cuenta como reemplazo, mismo criterio de
        // siempre).
        const existing = isEditing ? editingRow : occupyingRow;

        // Resuelve cada recurso por separado: archivo nuevo > (si se pidió
        // borrar) nada > lo que ya tenía la alerta > nada.
        let visualUrl = existing?.visual_url || null;
        let visualPath = existing?.visual_path || null;
        let finalVisualType = existing?.visual_type || null;
        if (visualFile) {
            if (existing?.visual_path) await storage.deleteFile(existing.visual_path);
            const visualId = crypto.randomUUID();
            const ext = (visualFile.originalname.match(/\.[a-zA-Z0-9]+$/) || [''])[0];
            visualPath = `${req.license.id}/${visualId}${ext}`;
            visualUrl = await storage.uploadFile(visualPath, visualFile.buffer, visualFile.mimetype);
            finalVisualType = visualFileType;
        } else if (clearVisual) {
            if (existing?.visual_path) await storage.deleteFile(existing.visual_path);
            visualUrl = null; visualPath = null; finalVisualType = null;
        }

        let audioUrl = existing?.audio_url || null;
        let audioPath = existing?.audio_path || null;
        if (audioFile) {
            if (existing?.audio_path) await storage.deleteFile(existing.audio_path);
            const audioId = crypto.randomUUID();
            const ext = (audioFile.originalname.match(/\.[a-zA-Z0-9]+$/) || [''])[0];
            audioPath = `${req.license.id}/${audioId}${ext}`;
            audioUrl = await storage.uploadFile(audioPath, audioFile.buffer, audioFile.mimetype);
        } else if (clearAudio) {
            if (existing?.audio_path) await storage.deleteFile(existing.audio_path);
            audioUrl = null; audioPath = null;
        }

        if (!visualUrl && !audioUrl && !cleanText) {
            return res.status(400).json({ success: false, error: 'Agrega al menos un recurso visual, un audio o un texto' });
        }

        // El disparador cambió a mitad de una edición -- la fila vieja (con
        // su clave anterior) no la va a pisar el upsert de abajo (choca por
        // license_id+gift_name, y la clave ya es otra), así que se borra
        // acá explícitamente para no dejarla huérfana.
        if (isEditing && editingRow.gift_name.toLowerCase() !== triggerKey.toLowerCase()) {
            await db.deleteAlertConfig(editingRow.id, req.license.id);
            getOrCreateTenant(req.license.id, req.license.license_type).removeAlertConfig(editingRow.gift_name);
        }

        const id = crypto.randomUUID();
        const row = await db.upsertAlertConfig({
            id, licenseId: req.license.id, giftName: triggerKey,
            visualUrl, visualPath, visualType: finalVisualType, visualMuted,
            audioUrl, audioPath,
            text: cleanText, textPosition: finalTextPosition,
            durationMs: finalDuration, position: finalPosition,
            entranceAnim: finalEntranceAnim, exitAnim: finalExitAnim, triggerType, minCoins,
        });
        // Mantiene al día el cache en memoria que usa processAlertTrigger —
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
    if (row.visual_path) await storage.deleteFile(row.visual_path);
    if (row.audio_path) await storage.deleteFile(row.audio_path);
    await db.deleteAlertConfig(row.id, req.license.id);
    getOrCreateTenant(req.license.id, req.license.license_type).removeAlertConfig(row.gift_name);
    res.json({ success: true });
});

// ==========================================
// PAGOS: MercadoPago Checkout API + Orders API — autoservicio total. El
// monto SIEMPRE se calcula acá desde pricing.js a partir de planType/
// diceTier; nunca se confía en un precio que mande el cliente. Body de
// /api/payments/charge (mas abajo): { planType?: 'month'|'annual'|
// 'lifetime', diceTier?: 'pro'|'vip' } — al menos uno de los dos (compra
// de "solo addon" sin renovar el plan, o renovación de plan sin tocar el
// addon, son ambas válidas).
// ==========================================

// Pedido explicito de MercadoPago (soporte, ver "reintentos clonados" en
// su guía de reducción de high_risk): dos pagos consecutivos con el mismo
// payer + mismos items + mismo monto disparan su motor antifraude, aunque
// la integración esté completa. En vez de dejar que el streamer reintente
// de una con los datos idénticos (que MP va a rechazar igual, pero ahora
// sumando una marca antifraude más a la cuenta), se frena ACÁ antes de
// llamar a MP: mismo licencia+plan+addon+monto dentro de una ventana
// corta devuelve un error claro sin gastar otro intento real. En memoria
// nada más (no hace falta persistencia -- si el proceso reinicia, el
// peor caso es dejar pasar un reintento, no un problema real) con
// limpieza perezosa para no crecer sin límite.
const RECENT_CHARGE_COOLDOWN_MS = 3 * 60 * 1000;
const recentChargeAttempts = new Map(); // `${licenseId}:${planType}:${diceTier}:${amountCents}` -> timestamp
setInterval(() => {
    const cutoff = Date.now() - RECENT_CHARGE_COOLDOWN_MS;
    for (const [key, ts] of recentChargeAttempts) {
        if (ts < cutoff) recentChargeAttempts.delete(key);
    }
}, RECENT_CHARGE_COOLDOWN_MS).unref();

// Precios vigentes de los 3 planes (override del admin si existe, default
// de pricing.js si no) -- publica a proposito, sin auth: la vitrina de
// Membership.jsx la necesita ANTES de que exista una sesion (ver el
// comentario de "Anonymous purchase flow" en Membership.jsx).
app.get('/api/pricing', (req, res) => {
    res.json({ success: true, prices: pricing.getAllPlanPricesCents() });
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
    //
    // OJO: MercadoPago documenta que si data.id es alfanumerico (como los
    // ID de 'order', ej. "ORD01M29...") hay que pasarlo en MINUSCULAS al
    // armar el manifest de la firma -- los ID de 'payment' son siempre
    // numericos asi que ahi nunca importo, pero para 'order' rompia la
    // validacion 100% de las veces (confirmado en logs de produccion: TODAS
    // las notificaciones de tipo order daban SignatureMismatch). El SDK NO
    // lo hace por su cuenta, hay que bajarlo a minuscula ANTES de llamar a
    // validate() -- pero solo para la firma: el dataId ORIGINAL (con su
    // mayuscula real) es el que hay que usar despues para el GET a MP.
    try {
        WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId: String(dataId).toLowerCase(), secret });
    } catch (err) {
        const reason = err instanceof InvalidWebhookSignatureError ? err.reason : err.message;
        console.error('[MP] Webhook con firma inválida — descartado', { reason, dataId, xRequestId, secretLength: secret.length });
        return res.sendStatus(401);
    }

    // Se responde 200 apenas la firma es válida: MercadoPago reintenta la
    // notificación si no contesta rápido, y lo que sigue (consultar el pago
    // real contra la API de MP + escribir en la DB) puede tardar un poco.
    res.sendStatus(200);

    // Esta integración cobra EXCLUSIVAMENTE vía la Orders API (Checkout API
    // orientado a Orders, ver /api/payments/charge) -- ya no existe ningún
    // camino que cree una Preference/Checkout Pro (se eliminó ese endpoint
    // muerto hace un tiempo), así que el único tópico real que puede llegar
    // es 'order'. Se descarta cualquier otro explícitamente en vez de
    // dejarlo pasar en silencio, para que quede claro en el log si algún
    // día MercadoPago manda algo inesperado en esta cuenta.
    const topic = req.query.type || req.body?.type;
    if (topic !== 'order') {
        console.log('[MP] Webhook con tópico no soportado (esta integración es solo Orders API) — descartado:', topic);
        return;
    }

    try {
        // No se confia en el body de la notificacion -- se pide el estado
        // real con un GET.
        const orderRes = await fetch(`https://api.mercadopago.com/v1/orders/${dataId}`, {
            headers: { Authorization: `Bearer ${getMpAccessToken()}` },
        });
        const order = await orderRes.json();
        if (!orderRes.ok) {
            console.error('[MP] Webhook de order: no se pudo consultar la orden', dataId, orderRes.status);
            return;
        }
        const { orderPayment, approved } = evaluateOrderStatus(order);
        if (!approved) return;
        // Separador '_' a proposito (ver donde se arma external_reference en
        // /api/payments/charge): licenseId es un UUID con '-' adentro, asi
        // que '_' es el unico separador que se puede partir sin ambiguedad.
        const [licenseId, planTypeRaw, diceTierRaw] = String(order.external_reference || '').split('_');
        const planType = planTypeRaw && planTypeRaw !== 'none' ? planTypeRaw : undefined;
        const diceTier = diceTierRaw && diceTierRaw !== 'none' ? diceTierRaw : undefined;
        await applyApprovedPaymentIfNew({ licenseId, planType, diceTier, mpPaymentId: orderPayment?.id || order.id });
    } catch (err) {
        console.error('[MP] Error procesando webhook:', err.message);
    }
});

// Aplica una compra ya APROBADA por MercadoPago a la licencia
// correspondiente -- tres llamadores: el webhook de tópico 'order' y el
// polling de /api/payments/orders/:orderId/status (post-challenge 3DS)
// parsean licenseId/planType/diceTier de external_reference (separador
// '_', ver donde se arma en /api/payments/charge), mientras que
// /api/payments/charge ya conoce esos valores de su propio request y no
// necesita parsear nada. Idempotente via el UNIQUE de payments.
// mp_payment_id (ver insertPaymentIfNew): llamarla dos veces con el
// mismo pago (ej. el webhook de 'order' llega DESPUES de que
// /api/payments/charge ya lo aplico al toque) no aplica el cambio dos
// veces.
// Extraido de applyApprovedPaymentIfNew para que Stripe pueda reusar
// EXACTAMENTE la misma logica de rotacion de key / calculo de expiracion /
// upgrade de dice_tier sin duplicarla -- es la parte mas delicada de todo
// el flujo de pagos, asi que un solo lugar que la calcule para ambos
// proveedores.
function computeLicenseUpdateForPurchase(license, { planType, diceTier }) {
    const update = {};
    if (planType) {
        update.licenseType = planType;
        const remainingTrialMs = (license.license_type === 'trial' && license.expires_at && license.expires_at > Date.now())
            ? (license.expires_at - Date.now())
            : 0;
        const baseExpiresAt = auth.computeExpiresAt(planType);
        update.expiresAt = baseExpiresAt === null ? null : baseExpiresAt + remainingTrialMs;

        const newRawKey = auth.generateLabeledKey(license.username, PLAN_KEY_LABELS[planType] || planType.toLowerCase());
        update.keyHash = auth.hashKey(newRawKey);
        update.keyPrefix = auth.keyPrefix(newRawKey);
        update.pendingKeyReveal = newRawKey;
    }
    if (diceTier) {
        const currentRank = pricing.DICE_TIER_RANK[license.dice_tier] ?? 0;
        const newRank = pricing.DICE_TIER_RANK[diceTier] ?? 0;
        if (newRank > currentRank) update.diceTier = diceTier;
    }
    return update;
}

async function applyApprovedPaymentIfNew({ licenseId, planType, diceTier, mpPaymentId }) {
    if (!licenseId || (!planType && !diceTier)) {
        console.error('[MP] applyApprovedPaymentIfNew: faltan licenseId/planType/diceTier', { licenseId, planType, diceTier });
        return { applied: false };
    }

    // El UNIQUE sobre mp_payment_id hace esto idempotente: si ya vimos este
    // pago (reintento de webhook, o el cobro directo ya lo aplico antes),
    // insertPaymentIfNew devuelve false y no se vuelve a aplicar nada.
    const isNew = await db.insertPaymentIfNew({
        id: crypto.randomUUID(),
        licenseId,
        mpPaymentId: String(mpPaymentId),
        planType: planType || null,
        diceTier: diceTier || null,
        amountCents: pricing.computeAmountCents({ planType, diceTier }),
        status: 'approved',
        createdAt: Date.now(),
    });
    if (!isNew) return { applied: false, alreadyProcessed: true };

    const license = await db.findById(licenseId);
    if (!license) {
        console.error('[MP] Pago para una licencia inexistente:', licenseId);
        return { applied: false };
    }

    const update = computeLicenseUpdateForPurchase(license, { planType, diceTier });
    if (Object.keys(update).length > 0) {
        await db.applyPurchase(licenseId, update);
        console.log(`[MP] ✅ Pago aplicado — licencia ${licenseId}:`, update);
    }
    return { applied: true, licenseId };
}

// Mismo patron que applyApprovedPaymentIfNew de arriba, pero para Stripe:
// idempotente via el UNIQUE de payments.stripe_payment_id (columna
// paralela a mp_payment_id, ver db.js) -- llamarla dos veces con el mismo
// PaymentIntent (ej. /api/payments/stripe/confirm ya lo aplico y despues
// llega el webhook) no aplica el cambio dos veces.
async function applyApprovedStripePaymentIfNew({ licenseId, planType, diceTier, stripePaymentId }) {
    if (!licenseId || (!planType && !diceTier)) {
        console.error('[Stripe] applyApprovedStripePaymentIfNew: faltan licenseId/planType/diceTier', { licenseId, planType, diceTier });
        return { applied: false };
    }

    const isNew = await db.insertStripePaymentIfNew({
        id: crypto.randomUUID(),
        licenseId,
        stripePaymentId: String(stripePaymentId),
        planType: planType || null,
        diceTier: diceTier || null,
        amountCents: pricing.computeAmountCents({ planType, diceTier }),
        status: 'approved',
        createdAt: Date.now(),
    });
    if (!isNew) return { applied: false, alreadyProcessed: true };

    const license = await db.findById(licenseId);
    if (!license) {
        console.error('[Stripe] Pago para una licencia inexistente:', licenseId);
        return { applied: false };
    }

    const update = computeLicenseUpdateForPurchase(license, { planType, diceTier });
    if (Object.keys(update).length > 0) {
        await db.applyPurchase(licenseId, update);
        console.log(`[Stripe] ✅ Pago aplicado — licencia ${licenseId}:`, update);
    }
    return { applied: true, licenseId };
}

// Interpreta el estado real de una orden de la Orders API -- compartido
// entre el cobro directo y el polling de status despues de un challenge
// 3DS (ver mas abajo), asi ambos caminos coinciden en como distinguir
// aprobado / rechazado / pendiente-async / pendiente-challenge.
function evaluateOrderStatus(order) {
    const orderPayment = order?.transactions?.payments?.[0];
    const approved = order.status === 'processed' && (orderPayment?.status === 'processed' || orderPayment?.status === 'approved');
    const challengeUrl = orderPayment?.payment_method?.transaction_security?.url;
    const isChallenge = !approved && orderPayment?.status_detail === 'pending_challenge' && !!challengeUrl;
    // "processing"/"action_required" son estados async reales de la Orders
    // API (ver doc oficial) -- se traducen a 'pending' para que el frontend
    // (que ya sabe mostrar "pago pendiente", ver CardPaymentForm.jsx) no los
    // confunda con un rechazo.
    const isPending = !approved && !isChallenge && (order.status === 'processing' || order.status === 'action_required');
    return { orderPayment, approved, isChallenge, challengeUrl, isPending };
}

// ==========================================
// COBRO DIRECTO (Checkout API + Card Payment Brick) -- unico camino de
// cobro de la plataforma (el checkout hosteado de MercadoPago via
// Preference API tenia un bug confirmado del lado de ellos --
// challenge-orchestrator nunca resolvia por un CORS mal configurado en
// mercadolibre.com/jms/lgz/background/automation, asi que el boton
// "Pagar" de SU pagina nunca se habilitaba -- reproducido en dos
// navegadores distintos, con y sin cuenta de MP -- asi que se elimino ese
// endpoint en vez de mantenerlo muerto). Aca el comprador nunca sale de
// este sitio: el Card Payment Brick tokeniza la tarjeta en un iframe de
// MercadoPago (mismo mecanismo que ya usa CardVerifyForm.jsx para
// verificar tarjetas sin cobrar) -- a este endpoint solo llega el token,
// nunca el numero de tarjeta real.
app.post('/api/payments/charge', auth.requireAuth, paymentLimiter, async (req, res) => {
    const { planType, diceTier, email, firstName: rawFirstName, lastName: rawLastName, zipCode, streetName, streetNumber, token, payment_method_id: paymentMethodId, installments, identificationType, identificationNumber, deviceId, policyAcceptedAt } = req.body || {};
    if (planType !== undefined && !pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan invalido' });
    }
    if (diceTier !== undefined && !pricing.isValidAddon(diceTier)) {
        return res.status(400).json({ success: false, error: 'Addon invalido' });
    }
    if (!planType && !diceTier) {
        return res.status(400).json({ success: false, error: 'Elige al menos un plan o un addon' });
    }
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!EMAIL_RE.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'Ingresa un correo valido para continuar con el pago' });
    }
    const firstName = typeof rawFirstName === 'string' ? rawFirstName.trim() : '';
    const lastName = typeof rawLastName === 'string' ? rawLastName.trim() : '';
    if (!firstName || !lastName) {
        return res.status(400).json({ success: false, error: 'Ingresa tu nombre y apellido para continuar con el pago' });
    }
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, error: 'Falta el token de la tarjeta' });
    }
    if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        return res.status(400).json({ success: false, error: 'Falta el medio de pago' });
    }
    // Pedido explicito: evidencia real (con fecha) de que el comprador
    // aceptó la política de reembolsos ANTES de pagar -- se exige
    // server-side (no solo ocultar el botón en el frontend) para que el
    // registro exista siempre. Va pegado al `description` de la orden (ver
    // más abajo) en vez de additional_info -- ese campo tiene un schema
    // estricto del lado de MP (confirmado en vivo: rechaza cualquier clave
    // que no reconozca), mientras que description es texto libre.
    if (typeof policyAcceptedAt !== 'string' || Number.isNaN(Date.parse(policyAcceptedAt))) {
        return res.status(400).json({ success: false, error: 'Debes aceptar la política de reembolsos para continuar' });
    }

    // El monto SIEMPRE se calcula aca desde pricing.js, nunca se confia en
    // un transaction_amount que pueda venir del formData del Brick.
    const amountCents = pricing.computeAmountCents({ planType, diceTier });

    // Pedido explicito de MercadoPago: frena reintentos idénticos (mismo
    // payer + mismos items + mismo monto) antes de gastar otro intento
    // real contra su antifraude -- ver el comentario de
    // recentChargeAttempts más arriba.
    const chargeAttemptKey = `${req.license.id}:${planType || ''}:${diceTier || ''}:${amountCents}`;
    const lastAttemptAt = recentChargeAttempts.get(chargeAttemptKey);
    if (lastAttemptAt && Date.now() - lastAttemptAt < RECENT_CHARGE_COOLDOWN_MS) {
        return res.status(429).json({
            success: false,
            error: 'Ya intentaste este mismo pago hace muy poco. Por seguridad, MercadoPago rechaza reintentos idénticos muy seguidos — espera unos minutos o prueba pagando con Stripe.',
        });
    }
    recentChargeAttempts.set(chargeAttemptKey, Date.now());

    // Sin ':' a proposito -- la Orders API (a diferencia de Preference) NO
    // acepta ese caracter en external_reference (confirmado probando:
    // "'$.external_reference' - does not match pattern"). Se usa '_' como
    // separador (no '-') porque licenseId es un UUID que YA trae '-'
    // adentro -- con '_' el webhook de notificaciones tipo "order" (ver mas
    // abajo) puede hacer external_reference.split('_') y recuperar
    // licenseId/planType/diceTier sin ambiguedad. Esto importa porque esta
    // cuenta usa capture_mode "automatic_async" por default: la mayoria de
    // los pagos se resuelven al toque (este mismo endpoint ya aplica el
    // plan en ese caso), pero cuando MP tarda mas en confirmar, el UNICO
    // aviso de que se aprobo llega despues via ese webhook, no en esta
    // respuesta.
    const externalReference = `${req.license.id}_${planType || 'none'}_${diceTier || 'none'}_${Date.now()}`;
    const titleParts = [];
    if (planType) titleParts.push({ month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' }[planType]);
    if (diceTier) titleParts.push(diceTier.toUpperCase());

    // El prefijo "deb" (debmaster/debvisa) indica una tarjeta de DEBITO.
    // Confirmado en logs de produccion, en ese orden:
    // 1) mandando siempre credit_card + id normalizado a la marca generica
    //    ('master') -> 422 generico "Unprocessable Entity" para una
    //    tarjeta de debito real (Nubank).
    // 2) corrigiendo el type a 'debit_card' pero SIN dejar de normalizar
    //    el id a 'master' -> 400 "value must be one of 'debmaster',
    //    'debvisa'" -- para debito el id CORRECTO es justamente el que
    //    normalizeCardBrand le sacaba el prefijo. O sea: normalizar la
    //    marca solo aplica a credito; a debito hay que dejar el id
    //    original tal cual vino del Brick.
    const isDebit = String(paymentMethodId || '').toLowerCase().startsWith('deb');
    const cardType = isDebit ? 'debit_card' : 'credit_card';
    const normalizedPaymentMethodId = isDebit ? paymentMethodId : normalizeCardBrand(paymentMethodId);
    if (normalizedPaymentMethodId !== paymentMethodId) {
        console.log(`[MP] payment_method_id normalizado: "${paymentMethodId}" -> "${normalizedPaymentMethodId}"`);
    }
    // Opcional: se manda solo si vienen las 3 partes juntas.
    const address = (zipCode && streetName && streetNumber)
        ? { zip_code: String(zipCode).trim(), street_name: String(streetName).trim(), street_number: String(streetNumber).trim() }
        : undefined;

    // Diagnostico temporal: la respuesta de la Orders API nunca hace eco
    // de additional_info/payer (ni aprobado ni rechazado), asi que no hay
    // forma de confirmar desde ahi si de verdad llegan completos. Ya no
    // aplica a firstName/lastName (validados arriba, siempre llegan si el
    // request pasa de ahi) pero sigue siendo util para deviceId/address.
    console.log('[MP] Datos del comprador para esta orden:', {
        hasAddress: !!address,
        hasDeviceId: !!deviceId,
    });

    try {
        const amountStr = (amountCents / 100).toFixed(2);
        const mpRes = await fetch('https://api.mercadopago.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getMpAccessToken()}`,
                'X-Idempotency-Key': crypto.randomUUID(),
                // Pedido explicito de MercadoPago (checklist de calidad,
                // "Identificador del dispositivo"): sin este header el
                // motor antifraude tiene mucha menos señal y rechaza mucho
                // mas seguido por "high_risk" (confirmado: TODOS los cobros
                // reales hasta ahora venian sin esto y caian en high_risk).
                // Puede faltar (bloqueador de anuncios, script que no
                // cargo a tiempo) -- en ese caso simplemente no se manda,
                // MP sigue evaluando con el resto de la señal disponible.
                ...(deviceId ? { 'X-meli-session-id': String(deviceId) } : {}),
            },
            body: JSON.stringify({
                type: 'online',
                processing_mode: 'automatic',
                total_amount: amountStr,
                external_reference: externalReference,
                description: `BenjaApis - ${titleParts.join(' + ')} | Política de reembolsos aceptada: ${policyAcceptedAt}`,
                // Pedido explicito de MercadoPago (checklist de calidad,
                // "Precio unitario del producto" / "Cantidad de productos" /
                // "Nombre del producto" / "Categoría del producto"): un solo
                // item que representa la compra completa (plan y/o addon
                // juntos, si se compran a la vez) -- unit_price = el mismo
                // monto que ya se cobra en total_amount/transactions, asi
                // que la suma siempre cuadra sin tener que descomponer el
                // precio de pricing.js en partes. "services" porque esto es
                // una suscripcion digital, no un producto fisico.
                items: [{
                    title: titleParts.join(' + ') || 'BenjaApis',
                    description: `Suscripción BenjaApis - ${titleParts.join(' + ')}`,
                    category_id: 'services',
                    quantity: 1,
                    unit_price: amountStr,
                }],
                payer: {
                    email: cleanEmail,
                    first_name: firstName,
                    last_name: lastName,
                    address,
                    identification: (identificationType && identificationNumber)
                        ? { type: identificationType, number: identificationNumber }
                        : undefined,
                },
                // Pedido explicito de MercadoPago (checklist de calidad,
                // "Fecha de registro del pagador"): la fecha en que se creo
                // la licencia es lo mas parecido que tenemos a "cuando se
                // registro en el sitio". OJO: a diferencia de la vieja
                // Payments API (que anida esto en additional_info.payer.
                // registration_date), la Orders API usa una clave PLANA con
                // el punto literal adentro del nombre -- probado en vivo
                // contra el sandbox: additional_info:{payer:{...}} lo
                // rechaza con "additionalProperties 'payer' not allowed",
                // additional_info:{"payer.registration_date":...} sí lo
                // acepta.
                additional_info: {
                    'payer.registration_date': new Date(req.license.created_at).toISOString(),
                },
                transactions: {
                    payments: [{
                        amount: amountStr,
                        payment_method: {
                            id: normalizedPaymentMethodId,
                            type: cardType,
                            token,
                            installments: Number(installments) || 1,
                            // Pedido explicito de MercadoPago (checklist
                            // de calidad, "Descripción-Resumen de
                            // tarjeta") -- confirmado que la Orders API
                            // acepta este campo acá adentro de
                            // payment_method (no a nivel order).
                            statement_descriptor: 'TIKTOKEVENTS',
                        },
                    }],
                },
                // Pedido explicito de MercadoPago (checklist de calidad,
                // "Protocolo de seguridad 3DS"): sin esto la Orders API
                // nunca ofrece un challenge 3DS -- solo puede aprobar o
                // rechazar de una, y confirmado en logs de produccion que
                // ante cualquier señal de riesgo elegia rechazar (high_risk)
                // en vez de pedir una segunda verificacion con el banco.
                // "on_fraud_risk" deja que MP decida caso por caso si pedir
                // el challenge; "required" en liability_shift es el unico
                // valor que acepta la API y traslada la responsabilidad del
                // fraude a la red de la tarjeta cuando el challenge se
                // completa bien. Si toca challenge, la orden vuelve con
                // status "action_required"/"pending_challenge" (ver mas
                // abajo) en vez de aprobada o rechazada de una.
                config: {
                    online: {
                        transaction_security: {
                            validation: 'on_fraud_risk',
                            liability_shift: 'required',
                        },
                    },
                },
            }),
        });
        const result = await mpRes.json();

        if (!mpRes.ok) {
            console.error('[MP] Error creando pago directo (Orders API):', mpRes.status, JSON.stringify(redactOrderTokens(result)));
            const detail = result?.errors?.[0]?.details?.[0] || result?.errors?.[0]?.message;
            res.status(502).json({ success: false, error: detail ? `No se pudo procesar el pago (${detail}).` : 'No se pudo procesar el pago. Intenta de nuevo en un momento.' });
            return;
        }

        // Diagnostico temporal: primera vez que se usa la Orders API en esta
        // integracion -- se deja el resultado crudo logueado para terminar
        // de confirmar el shape real contra pagos de verdad (aprobados y
        // rechazados) antes de simplificar este log.
        console.log('[MP] Resultado crudo de POST /v1/orders:', JSON.stringify(redactOrderTokens(result)));

        const { orderPayment, approved, isChallenge, challengeUrl, isPending } = evaluateOrderStatus(result);
        // Si la confirmacion final llega despues (async o post-challenge),
        // la aplica el webhook de tipo "order" de mas abajo (o el polling
        // de /api/payments/orders/:orderId/status), no esta respuesta.
        if (approved) {
            await applyApprovedPaymentIfNew({
                licenseId: req.license.id,
                planType,
                diceTier,
                mpPaymentId: orderPayment?.id || result.id,
            });
        }

        res.json({
            success: true,
            status: approved ? 'approved' : isChallenge ? 'challenge_required' : isPending ? 'pending' : (orderPayment?.status || result.status || 'unknown'),
            statusDetail: orderPayment?.status_detail || result.status_detail,
            paymentId: orderPayment?.id || result.id,
            orderId: result.id,
            challengeUrl: isChallenge ? challengeUrl : undefined,
        });
    } catch (err) {
        console.error('[MP] Error creando pago directo:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo procesar el pago. Intenta de nuevo en un momento.' });
    }
});

// El frontend llama esto en loop corto (ver CardPaymentForm.jsx) mientras
// el comprador completa el challenge 3DS en el iframe de su banco -- el
// propio doc de MercadoPago aclara que el evento del iframe solo avisa que
// el challenge termino, no que el pago ya tiene status final, asi que hay
// que volver a consultar la orden para saberlo de verdad. Nunca se confia
// en el orderId a ciegas: se verifica que la orden sea de ESTA licencia
// (mismo external_reference que arma /api/payments/charge) antes de
// devolver nada.
app.get('/api/payments/orders/:orderId/status', auth.requireAuth, paymentStatusLimiter, async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}`, {
            headers: { Authorization: `Bearer ${getMpAccessToken()}` },
        });
        const order = await orderRes.json();
        if (!orderRes.ok) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        const [ownerLicenseId, planTypeRaw, diceTierRaw] = String(order.external_reference || '').split('_');
        if (ownerLicenseId !== req.license.id) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        const planType = planTypeRaw && planTypeRaw !== 'none' ? planTypeRaw : undefined;
        const diceTier = diceTierRaw && diceTierRaw !== 'none' ? diceTierRaw : undefined;

        const { orderPayment, approved, isChallenge, challengeUrl, isPending } = evaluateOrderStatus(order);
        if (approved) {
            await applyApprovedPaymentIfNew({ licenseId: ownerLicenseId, planType, diceTier, mpPaymentId: orderPayment?.id || order.id });
        }
        res.json({
            success: true,
            status: approved ? 'approved' : isChallenge ? 'challenge_required' : isPending ? 'pending' : (orderPayment?.status || order.status || 'unknown'),
            statusDetail: orderPayment?.status_detail || order.status_detail,
            challengeUrl: isChallenge ? challengeUrl : undefined,
        });
    } catch (err) {
        console.error('[MP] Error consultando status de orden:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo consultar el estado del pago.' });
    }
});

// ==========================================
// PAGOS: Stripe (Payment Element embebido) -- segunda forma de pago,
// seleccionable junto a MercadoPago desde Membership.jsx. Mismo principio
// que el cobro de MP: el monto SIEMPRE se calcula acá desde pricing.js,
// nunca se confía en nada que mande el cliente. A diferencia de MP (que
// tokeniza la tarjeta y cobra en un solo POST), Stripe separa la compra en
// dos pasos -- 1) crear un PaymentIntent server-side (acá abajo,
// /intent), 2) el frontend lo confirma con stripe.confirmPayment() usando
// el Payment Element (tarjeta nunca toca nuestro backend) -- y recién
// entonces /confirm valida contra la API de Stripe (nunca contra lo que
// diga el frontend) y aplica la compra. El webhook es la confirmación de
// respaldo por si el navegador se cierra entre el paso 2 y la llamada a
// /confirm.
// ==========================================

app.post('/api/payments/stripe/intent', auth.requireAuth, paymentLimiter, async (req, res) => {
    const { planType, diceTier, email, firstName: rawFirstName, lastName: rawLastName, policyAcceptedAt } = req.body || {};
    if (planType !== undefined && !pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan invalido' });
    }
    if (diceTier !== undefined && !pricing.isValidAddon(diceTier)) {
        return res.status(400).json({ success: false, error: 'Addon invalido' });
    }
    if (!planType && !diceTier) {
        return res.status(400).json({ success: false, error: 'Elige al menos un plan o un addon' });
    }
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!EMAIL_RE.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'Ingresa un correo valido para continuar con el pago' });
    }
    const firstName = typeof rawFirstName === 'string' ? rawFirstName.trim() : '';
    const lastName = typeof rawLastName === 'string' ? rawLastName.trim() : '';
    if (!firstName || !lastName) {
        return res.status(400).json({ success: false, error: 'Ingresa tu nombre y apellido para continuar con el pago' });
    }
    // Pedido explicito: evidencia real (con fecha) de que el comprador
    // aceptó la política de reembolsos ANTES de pagar -- se manda como
    // metadata del PaymentIntent, visible en el propio dashboard de
    // Stripe si alguien abre una disputa. Se exige server-side (no solo
    // ocultar el botón en el frontend) para que el registro exista
    // siempre, sin depender de que nadie evite el check del lado del
    // cliente.
    if (typeof policyAcceptedAt !== 'string' || Number.isNaN(Date.parse(policyAcceptedAt))) {
        return res.status(400).json({ success: false, error: 'Debes aceptar la política de reembolsos para continuar' });
    }

    const amountCents = pricing.computeAmountCents({ planType, diceTier });
    const titleParts = [];
    if (planType) titleParts.push({ month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' }[planType]);
    if (diceTier) titleParts.push(diceTier.toUpperCase());

    try {
        const stripe = getStripeClient();
        const intent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'mxn',
            // Solo tarjeta a propósito -- mismo alcance que la opción de MP
            // ("Credit/Debit Card"), sin habilitar métodos async (OXXO,
            // SPEI) que complicarían este flujo de confirmación inmediata.
            payment_method_types: ['card'],
            description: `BenjaApis - ${titleParts.join(' + ')}`,
            // Recibo automático de Stripe al correo del comprador -- pedido
            // explícito, sin necesidad de configurar Stripe Invoicing aparte.
            receipt_email: cleanEmail,
            metadata: {
                licenseId: req.license.id,
                planType: planType || '',
                diceTier: diceTier || '',
                policyAcceptedAt,
            },
        });
        res.json({ success: true, clientSecret: intent.client_secret, paymentIntentId: intent.id });
    } catch (err) {
        console.error('[Stripe] Error creando PaymentIntent:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.' });
    }
});

// El frontend llama esto apenas stripe.confirmPayment() resuelve con
// succeeded (ver StripePaymentForm.jsx) -- nunca se aplica la compra por
// lo que diga el frontend: se vuelve a pedir el PaymentIntent a la propia
// API de Stripe y se verifica que su metadata.licenseId sea el de ESTA
// sesión antes de aplicar nada (mismo criterio que el polling de status
// de MP). El webhook de más abajo es la red de respaldo si el navegador
// se cierra justo acá.
app.post('/api/payments/stripe/confirm', auth.requireAuth, paymentStatusLimiter, async (req, res) => {
    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
        return res.status(400).json({ success: false, error: 'Falta el id del pago' });
    }
    try {
        const stripe = getStripeClient();
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.metadata?.licenseId !== req.license.id) {
            return res.status(404).json({ success: false, error: 'Pago no encontrado' });
        }
        const planType = intent.metadata?.planType || undefined;
        const diceTier = intent.metadata?.diceTier || undefined;
        if (intent.status === 'succeeded') {
            await applyApprovedStripePaymentIfNew({ licenseId: req.license.id, planType, diceTier, stripePaymentId: intent.id });
        }
        res.json({
            success: true,
            status: intent.status === 'succeeded' ? 'approved' : (intent.status === 'processing' ? 'pending' : intent.status),
        });
    } catch (err) {
        console.error('[Stripe] Error confirmando PaymentIntent:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo confirmar el pago. Intenta de nuevo en un momento.' });
    }
});

// Notificación server-to-server de Stripe -- red de respaldo de /confirm
// de arriba (ej. el streamer cierra la pestaña justo después de pagar).
// El body llega CRUDO acá (ver el express.raw() montado antes del
// express.json() global, arriba del todo del archivo) porque
// stripe.webhooks.constructEvent() valida la firma sobre los bytes
// exactos, no sobre un objeto ya parseado.
app.post('/api/payments/stripe/webhook', webhookLimiter, async (req, res) => {
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const signature = req.headers['stripe-signature'];
    if (!secret || !signature) {
        return res.sendStatus(400);
    }

    let event;
    try {
        event = getStripeClient().webhooks.constructEvent(req.body, signature, secret);
    } catch (err) {
        console.error('[Stripe] Webhook con firma inválida — descartado:', err.message);
        return res.sendStatus(401);
    }

    // Se responde 200 apenas la firma es válida, mismo criterio que el
    // webhook de MP -- Stripe reintenta si no contesta rápido.
    res.sendStatus(200);

    if (event.type !== 'payment_intent.succeeded') return;

    try {
        const intent = event.data.object;
        const licenseId = intent.metadata?.licenseId;
        const planType = intent.metadata?.planType || undefined;
        const diceTier = intent.metadata?.diceTier || undefined;
        if (!licenseId) return;
        await applyApprovedStripePaymentIfNew({ licenseId, planType, diceTier, stripePaymentId: intent.id });
    } catch (err) {
        console.error('[Stripe] Error procesando webhook:', err.message);
    }
});

// Rechazos de tarjeta (SetupIntent de la prueba gratis o PaymentIntent del
// checkout) los resuelve Stripe.js DIRECTO en el navegador
// (confirmSetup/confirmPayment) -- nunca pasan por este backend, así que
// sin esto no queda ningún rastro en los logs de un intento rechazado.
// Pedido explícito: poder ver acá el JSON crudo del error (decline_code,
// etc.) sin tener que abrir devtools cada vez. Sin auth a propósito: la
// verificación de tarjeta de la prueba gratis pasa pre-login. Solo
// loguea -- no se persiste en DB ni se usa para nada más.
app.post('/api/stripe/client-error', stripeClientErrorLimiter, (req, res) => {
    console.error(`[Stripe] Error de tarjeta reportado por el navegador (${req.body?.context || 'sin contexto'}):`, JSON.stringify(req.body?.error));
    res.sendStatus(204);
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
// DOWNLOADER: descarga videos de YouTube/TikTok (sin marca de agua) --
// disponible para cualquier sesión válida, incluida la prueba gratis
// (pedido explícito). Puerto del proyecto standalone YTDownloader ya
// probado, adaptado acá multi-tenant (ver downloader.js) -- cada job
// vive scopeado a la licencia que lo creó, y status/file verifican esa
// pertenencia antes de responder nada.
// ==========================================
const DOWNLOADER_FORMATS = ['mp4', 'mp3'];
function sanitizeDownloaderQuality(quality, fmt) {
    if (fmt === 'mp3') return ['320', '192', '128'].includes(quality) ? quality : '192';
    return quality === 'best' || /^\d{2,4}$/.test(quality) ? quality : 'best';
}

app.post('/api/downloader/info', auth.requireAuth, downloaderActionLimiter, async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ success: false, error: 'URL requerida' });
    try {
        const info = await downloader.getVideoInfo(url);
        res.json({ success: true, ...info });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.post('/api/downloader/start', auth.requireAuth, downloaderActionLimiter, (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ success: false, error: 'URL requerida' });
    const fmt = DOWNLOADER_FORMATS.includes(req.body?.format) ? req.body.format : 'mp4';
    const quality = sanitizeDownloaderQuality(req.body?.quality, fmt);
    try {
        const jobId = downloader.startDownload({ licenseId: req.license.id, url, fmt, quality });
        res.json({ success: true, job_id: jobId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/downloader/status/:jobId', auth.requireAuth, downloaderStatusLimiter, (req, res) => {
    const job = downloader.getJob(req.params.jobId);
    if (!job || job.licenseId !== req.license.id) return res.status(404).json({ success: false, error: 'Job no encontrado' });
    res.json({ status: job.status, percent: job.percent, speed: job.speed, eta: job.eta, filename: job.filename, title: job.title, error: job.error });
});

// Sirve por jobId (nunca por nombre de archivo crudo, a diferencia del
// proyecto standalone de un solo usuario) -- así ningún licenciatario
// puede adivinar/pedir el archivo de otro: la pertenencia se resuelve acá
// contra el job, no confiando en nada que mande el cliente.
app.get('/api/downloader/file/:jobId', auth.requireAuth, generalLimiter, (req, res) => {
    const job = downloader.getJob(req.params.jobId);
    if (!job || job.licenseId !== req.license.id || job.status !== 'done' || !job.filePath) {
        return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }
    res.download(job.filePath, job.filename);
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
