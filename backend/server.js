require('dotenv').config({ quiet: true });

// Bug conocido de tiktok-live-connector (legacy.js, getTopViewerAttributes):
// al normalizar CUALQUIER WebcastRoomUserSeqMessage (estadísticas de
// viewers, las manda TikTok solo cada tanto mientras alguien está en vivo)
// hacía `ranksList.map(...)` sin chequear que `ranksList` exista — en salas
// chicas/nuevas llega undefined y explota. Pasa DENTRO de un emit síncrono
// disparado por el propio WebSocket interno de la librería, así que no hay
// forma de envolverlo en un try/catch desde nuestro código (no es un
// listener nuestro el que revienta). Ya está parcheado (ver
// patch-tiktok-live-connector.js, `getTopViewerAttributes`) — ahora sí
// escuchamos 'roomUser' (ver handleRoomUserEvent en tenant.js, para el
// contador de espectadores del overlay de chat), pero este handler global
// se deja igual como red de seguridad: cualquier otra excepción no
// atrapada en cualquier otro punto del proceso (no solo este evento
// puntual) tira abajo TODO el proceso sin él — afecta a todas las
// licencias conectadas en ese momento, no solo a una.
// Se conecta más abajo, cuando ya existe la base de datos (ver errorReporter):
// además de dejar la línea en el registro, estos errores quedan guardados y se
// ven en el panel de Sistema > Errores.
let reportBackendError = () => {};
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION] El proceso siguió vivo — no se reinició. Detalle:', err);
    reportBackendError('exception', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
    reportBackendError('rejection', reason);
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
// El catálogo de regalos (para el selector del panel) usa a propósito la
// versión 1.2.3 vieja de la librería, instalada aparte con un alias en
// package.json (tiktok-live-connector-v1) — su getAvailableGifts() pega un
// endpoint público de TikTok que NO necesita firma de Euler Stream, a
// diferencia de fetchAvailableGifts() en la v2, que sí y quedó bloqueada
// detrás de un plan pago (ver /api/setup/:username más abajo). La conexión
// LIVE de verdad sigue siendo la v2 de arriba, sin tocar.
// Las dependencias de ese alias (axios 0.25 y protobufjs 6) tenían
// vulnerabilidades sin arreglo dentro de sus propios rangos: se fuerzan a
// axios 0.34 y protobufjs 7 con `overrides` en package.json, solo para el
// alias (la v2 no se toca). Verificado con una llamada real: la lista de
// getAvailableGifts() es idéntica a la de antes.
const { WebcastPushConnection: WebcastPushConnectionV1 } = require('tiktok-live-connector-v1');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const Stripe = require('stripe');

const multer = require('multer');

const db = require('./db');
const auth = require('./auth');
const tokenCrypto = require('./tokenCrypto');
const { createStripeBilling, TRIAL_DAYS: BILLING_TRIAL_DAYS } = require('./lib/stripeBilling');
const pricing = require('./pricing');
const spotify = require('./spotify');
const storage = require('./storage');
const Tenant = require('./tenant');
const downloader = require('./downloader');
const { DownloadUrlError } = require('./lib/downloaderSafety');
const { createHandshakeLimiter, clientIp, isNewSession } = require('./lib/handshakeLimiter');
const { createErrorReporter } = require('./lib/errorReports');
const { canCreateAlert, limitMessage, quotaInfo } = require('./lib/alertQuota');
const { helmetDirectives } = require('./lib/csp');
const { createHealthChecker } = require('./lib/healthCheck');
const { registerSystemRoutes } = require('./routes/system');
const { computeAdminStats } = require('./lib/adminStats');
const { mergeGiftCatalogs } = require('./lib/giftCatalog');
const { isKnownPage } = require('./lib/sitePages');
const analytics = require('./lib/analytics');
const { stickerAlertKey, stickerIdFromKey, cleanStickerId } = require('./lib/stickerCatalog');
const giftDirectory = require('./lib/giftDirectory');
const { sniffMedia } = require('./lib/mediaSniff');

// Archivos de las Alertas de regalos (imagen/gif/video/audio) — en memoria,
// nunca tocan disco: van directo de la request a Supabase Storage (ver
// storage.js). 15MB alcanza de sobra para un clip corto de alerta; frenar
// acá evita cargar archivos gigantes enteros en RAM antes de subirlos.
// Pedido explicito: visual (imagen/gif/video) y audio son dos campos
// independientes del mismo form -- `.fields()` en vez de `.single()`
// porque ahora puede venir uno, el otro, o los dos juntos.
const uploadAlertMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
    .fields([{ name: 'visual', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);
// Qué se acepta se decide por lo que el archivo ES (sus primeros bytes, ver
// lib/mediaSniff.js), no por el tipo que declare el navegador: ese dato lo
// manda quien sube el archivo y puede mentir. El audio (mp3/wav/ogg) es el mismo
// para las alertas y para el sonido de "objetivo completado" (ver /api/goal/audio
// más abajo).
const ALERT_VISUAL_GROUPS = ['image', 'gif', 'video'];
// Tope de alertas por licencia según su plan (ver lib/alertQuota.js): sin él,
// alguien podría llenar con archivos el almacenamiento compartido por todos los
// streamers.
const uploadGoalAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('audio');

// Uno o varios orígenes separados por coma (p. ej. el dominio de Vercel +
// un dominio propio). Con un solo valor, cors/socket.io lo tratan igual
// que antes (string simple); con varios, se pasa el array.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const CORS_ORIGIN = CORS_ORIGINS.length === 1 ? CORS_ORIGINS[0] : CORS_ORIGINS;

// URL propia del frontend -- la usan los redirects de Spotify
// para volver al dominio correcto (Vercel en producción) despues de
// conectar/desconectar una cuenta.
const FRONTEND_URL = (process.env.FRONTEND_URL || CORS_ORIGINS[0] || 'http://localhost:5173').replace(/\/$/, '');

// Se crea perezosamente: no revienta el arranque del server si todavia no
// se configuro STRIPE_SECRET_KEY -- solo fallan las rutas de pago hasta que
// se agregue. La propia llave indica si es de prueba o en vivo por su
// prefijo (sk_test_/sk_live_).
function getStripeClient() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error('Falta STRIPE_SECRET_KEY en las variables de entorno');
    return new Stripe(secretKey);
}

// Versión de la API para el formulario de Checkout (ui_mode 'form'), la
// misma que muestra el Dashboard de Stripe para esta integración. Desde
// Endive el formulario ya no es vista previa: sin bandera beta. Se pasa
// SOLO en las llamadas de Checkout Sessions (opción por petición), no al
// crear el cliente: el resto del backend (clientes, conciliación de pagos)
// sigue en la versión del SDK. Ojo con Endive: payment_method_types en una
// Checkout Session devuelve 400 (va allowed_payment_method_types).
const STRIPE_CHECKOUT_FORM_API_VERSION = '2026-10-28.endive';
const STRIPE_CHECKOUT_INTEGRATION_ID = 'custom_embedded_web_0001';

const VALID_LICENSE_TYPES = ['day', 'week', 'month', 'annual', 'lifetime'];
// Nivel de Color Says — independiente de is_admin (ver comentario en
// db.js): 'admin' acá es un nivel más que se le puede vender a cualquier
// licencia paga (Modo Seguro en el juego de dados), nunca permisos reales
// de administración de la plataforma.
const VALID_DICE_TIERS = ['regular', 'pro', 'vip', 'admin'];

// Etiqueta que va en el medio de la key legible (alias-etiqueta-hash, ver
// auth.generateLabeledKey): al comprar un plan, al crear o regenerar una
// licencia desde el panel de Licencias (todos los tipos, no solo los que se
// venden: day/week las emite el admin) y la de la prueba gratis, que conserva
// su etiqueta de siempre.
const PLAN_KEY_LABELS = { trial: 'FREE7DAY', day: 'daily', week: 'weekly', month: 'monthly', annual: 'yearly', lifetime: 'lifetime' };

// Lo que se guarda de una clave nueva: el hash (con el que se inicia sesión),
// su prefijo visible y la clave cifrada para que el admin pueda volver a
// mostrarla desde el panel de Licencias (ver db.getLicenseKey). Si el cifrado
// falla (falta TOKEN_ENCRYPTION_KEY) la licencia se crea igual, solo que esa
// clave no se podrá recuperar.
function storedKeyFields(key) {
    let keyEncrypted = null;
    try {
        keyEncrypted = tokenCrypto.encrypt(key);
    } catch (err) {
        console.error('[Licencias] No se pudo cifrar la clave; no se podrá volver a mostrar:', err.message);
    }
    return { keyHash: auth.hashKey(key), keyPrefix: auth.keyPrefix(key), keyEncrypted };
}

// El alias de una licencia nueva (prueba gratis o compra sin cuenta): letras,
// números, "_" y "-", hasta 40. Vacío si no queda nada válido.
function cleanLicenseAlias(raw) {
    return typeof raw === 'string' ? raw.trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '') : '';
}
// No bloqueante a propósito: si todavía no se
// configuró SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, el resto de la
// plataforma sigue funcionando igual — solo fallan las rutas de Alertas.
storage.ensureBucket().catch((err) => console.error('[Storage] No se pudo verificar el bucket de alertas al arrancar:', err.message));

// Reportes de errores (pantallas, servidor y política de seguridad): se guardan
// agrupados en la base y se ven en el panel de Sistema > Errores.
const errorReporter = createErrorReporter({ db });
reportBackendError = (kind, err, context) => {
    errorReporter.record({ kind, message: (err && err.message) || String(err), stack: err && err.stack, context }, { source: 'backend' });
};
// El Downloader manda aquí el error real de yt-dlp con el detalle de cada
// intento (y cuándo funcionó tras fallar), para verlo en Sistema > Errores.
downloader.setIssueReporter((report, { licenseId } = {}) => errorReporter.record(report, { source: 'backend', licenseId }));

// Historial de lo que hace el admin (ver Sistema > Historial). No espera ni falla:
// un error al anotar jamás debe impedir la acción en sí. Nunca recibe claves, solo
// quién, qué y sobre qué licencia.
function audit(req, action, target = {}, details = null) {
    db.insertAuditLog({
        id: crypto.randomUUID(), at: Date.now(),
        adminUsername: req.license.username, adminLicenseId: req.license.id,
        action, targetLicenseId: target.id || null, targetLabel: target.label || null,
        details: details ? JSON.stringify(details).slice(0, 1000) : null,
    }).catch((err) => console.error('[Auditoría] No se pudo anotar la acción:', err.message));
}

// Al eliminar una licencia también se borran sus archivos del almacenamiento (antes
// se quedaban para siempre). No espera ni falla: si no se pudo, los archivos quedan
// como huérfanos y se limpian desde Sistema > Archivos.
function cleanLicenseFiles(licenseId) {
    if (!storage.isConfigured()) return;
    storage.deletePrefix(licenseId).catch((err) => console.error('[Storage] No se pudieron borrar los archivos de la licencia ' + licenseId + ':', err.message));
}

const app = express();
// Render (y cualquier host detrás de un proxy/balanceador) manda el IP real
// del cliente en X-Forwarded-For — sin esto, express-rate-limit no confía
// en ese header y tira ERR_ERL_UNEXPECTED_X_FORWARDED_FOR en cada request
// a una ruta con rate limit (login, free-trial, admin, pagos, etc.).
app.set('trust proxy', 1);
// Forzar HTTPS: Render (y cualquier proxy delante) recibe la conexión cifrada
// y la reenvía con X-Forwarded-Proto. Si alguien entra por http://, se le
// manda a la misma dirección con https:// (301, permanente). Solo cuando el
// proxy dice explícitamente "http": las comprobaciones internas de salud de
// Render no traen ese encabezado y no deben recibir una redirección. El
// navegador además recuerda usar HTTPS por la cabecera
// Strict-Transport-Security que pone Helmet más abajo.
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'http' || process.env.FORCE_HTTPS === 'off') return next();
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
});
// Cabeceras de seguridad estandar (X-Frame-Options, X-Content-Type-
// Options, Strict-Transport-Security, Referrer-Policy, quita X-Powered-
// By, etc.) -- pedido explicito de una revision de seguridad del sitio.
// Content-Security-Policy en modo SOLO REPORTE (ver lib/csp.js): el navegador no
// bloquea nada, solo avisa de lo que una política estricta habría bloqueado, y
// esos avisos llegan a Sistema > Errores. Se hace así a propósito: el sitio carga
// Google AdSense, Adsterra y Stripe
// desde muchísimos dominios de terceros, y una política mal armada rompería en
// silencio los anuncios (ingresos) o el cobro con tarjeta. Cuando los reportes
// dejen de mostrar avisos se pasa a bloquear (quitando reportOnly). Sin
// Cross-Origin-Embedder-Policy por el mismo motivo.
app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, reportOnly: true, directives: helmetDirectives({ reportUri: '/api/csp-report' }) },
    crossOriginEmbedderPolicy: false,
}));
// Comprime respuestas (el paquete JS del frontend pesa ~600 kB sin gzip).
// socket.io va por su propio canal WebSocket, no pasa por acá.
app.use(compression());

// Identifica esta "vida" del proceso: si cambia mientras un panel sigue
// abierto, el servidor se reinició (deploy, caída, Render dormido) y todo lo
// que vivía solo en memoria se perdió -- ver 'server_boot' más abajo.
const BOOT_ID = crypto.randomUUID();

// Chequeo de salud sin autenticación ni datos sensibles: sirve para el
// health check de Render y para un ping externo (UptimeRobot, etc.) que
// evite que el servicio se duerma por inactividad. A propósito NO toca la base
// de datos (Render lo usa para decidir si reinicia): para eso está /health/deep.
app.get('/health', (req, res) => {
    res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});
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
// Los overlays de OBS (?overlay=true) cargan la MISMA página que el panel,
// pero no necesitan el script de AdSense (los anuncios ni se muestran ahí y
// solo gastan red y CPU en una fuente de navegador que corre horas). Se les
// sirve el index.html sin esa etiqueta; el panel normal y el rastreador de
// AdSense siguen recibiendo el HTML completo, sin cambios.
const OVERLAY_ADSENSE_TAG = /<script[^>]*pagead2\.googlesyndication\.com[^>]*><\/script>/i;
// La pantalla de carga del panel (fondo pastel + aro) taparía la escena del
// directo mientras carga la fuente de OBS: el overlay arranca transparente.
const OVERLAY_BOOT_LOADER = /<!--tkc-loader-->[\s\S]*?<!--\/tkc-loader-->/;
let overlayIndexCache = null; // { mtimeMs, html }
app.use((req, res, next) => {
    if (req.method !== 'GET' || req.query.overlay !== 'true') return next();
    const indexPath = path.join(__dirname, 'public', 'index.html');
    try {
        const { mtimeMs } = fs.statSync(indexPath);
        if (!overlayIndexCache || overlayIndexCache.mtimeMs !== mtimeMs) {
            overlayIndexCache = { mtimeMs, html: fs.readFileSync(indexPath, 'utf8').replace(OVERLAY_ADSENSE_TAG, '').replace(OVERLAY_BOOT_LOADER, '') };
        }
        res.set('Cache-Control', 'no-cache').type('html').send(overlayIndexCache.html);
    } catch {
        next(); // sin frontend buildeado acá (se sirve aparte): sigue el flujo normal
    }
});
// Ancho de banda: Vite pone un hash en el nombre de todo lo que va en
// /assets/, así que ese archivo nunca cambia de contenido -- se cachea un año
// y el navegador (incluidas las fuentes de OBS, que se recargan seguido) ni
// siquiera pregunta. index.html y lo demás (favicons) siguen revalidándose,
// para que un deploy nuevo se vea en la siguiente carga.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', 'no-cache');
        }
    },
}));

const server = http.createServer(app);
// perMessageDeflate viene apagado por defecto en socket.io: sin esto cada
// estado (rankings, listas de participantes con la URL del avatar de cada
// uno) viaja sin comprimir a cada pestaña y overlay abiertos. Solo se
// comprime lo que pasa de 1 KB (un tick del reloj no gana nada) y con una
// ventana chica: cada socket guarda su propio compresor en memoria, y con
// muchos overlays conectados la ventana por defecto (~300 KB por socket)
// llenaría la RAM del plan de Render.
const io = new Server(server, {
    cors: { origin: CORS_ORIGIN },
    perMessageDeflate: {
        threshold: 1024,
        serverMaxWindowBits: 11,
        zlibDeflateOptions: { level: 6, memLevel: 4, windowBits: 11 },
    },
});

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
// Guardar la app de Spotify propia dispara una llamada a Spotify para
// verificar las credenciales (ver /api/spotify/app): presupuesto aparte y
// bajo, para que no sirva de trampolín contra su API.
const spotifyAppLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
// Mas generoso: lo usa /api/payments/stripe/confirm, que el formulario
// llama justo después de cada pago.
const paymentStatusLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
// Más generoso que el resto: a este lo llama Stripe server-to-server,
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
// Lo que el panel necesita saber de su licencia (inicio de sesión, prueba gratis
// y /verify). `overlayKey` es el token de solo lectura para los enlaces de OBS
// (ver auth.overlayTokenFor): así esos enlaces no llevan la clave de licencia.
function sessionLicense(row) {
    return {
        username: row.username,
        licenseType: row.license_type,
        isAdmin: !!row.is_admin,
        expiresAt: row.expires_at,
        diceTier: row.dice_tier,
        diceWinBonusUnlocked: !!row.dice_win_bonus_unlocked,
        spotifyAddon: !!row.spotify_addon,
        overlayKey: auth.overlayTokenFor(row),
        // Suscripción o prueba de 14 días (ver lib/stripeBilling.js): Membresía
        // dice cuándo se cobra o se renueva y ofrece gestionarla.
        billing: row.subscription_plan ? {
            plan: row.subscription_plan,
            status: row.subscription_status || null,
            cancelAt: row.subscription_cancel_at ? Number(row.subscription_cancel_at) : null,
            lifetimeChargeAt: row.lifetime_trial_charge_at ? Number(row.lifetime_trial_charge_at) : null,
            lifetimeAmountCents: row.lifetime_trial_amount_cents || null,
            hasSubscription: !!row.stripe_subscription_id,
        } : null,
    };
}

// Un cambio en una licencia (el admin la extiende o la edita, una compra se
// aplica) tiene que verse YA en el panel del streamer, no al volver a iniciar
// sesión: el panel guarda su plan y vencimiento, y el Tenant en memoria
// guarda el tipo de licencia (lo usan las reglas de la prueba gratis). Bug
// real: una prueba extendida a mensual seguía viéndose vencida hasta que se
// regeneró la clave. Solo a los paneles (JWT): los overlays no necesitan
// datos de la licencia. Nunca lanza: es un aviso, no parte de la operación.
async function pushLicenseState(licenseId) {
    try {
        const row = await db.findById(licenseId);
        if (!row) return;
        const tenant = tenants.get(licenseId);
        if (tenant) tenant.licenseType = row.license_type;
        const payload = sessionLicense(row);
        for (const socket of await io.in(licenseId).fetchSockets()) {
            if (socket.authMethod === 'jwt') socket.emit('license_updated', payload);
        }
    } catch (err) {
        console.error(`[Licencias] No se pudo avisar el cambio de la licencia ${licenseId}:`, err.message);
    }
}

// Campo trampa contra bots (ver HoneypotField en el frontend): una persona no
// lo ve ni lo llena; un script que rellena todos los campos sí. Se responde
// con el mismo error genérico que una clave inválida, sin dar pistas.
const isBotSubmission = (body) => typeof body?.website === 'string' && body.website.trim() !== '';

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    if (isBotSubmission(req.body)) return res.status(401).json({ success: false, error: 'Licencia inválida, revocada o expirada' });
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
    res.json({ success: true, token, license: sessionLicense(row) });
});

// Logout explícito: mata la sesión server-side de inmediato (no hace falta
// esperar a que otro dispositivo se loguee para invalidar este token).
app.post('/api/auth/logout', auth.requireAuth, async (req, res) => {
    await db.setSession(req.license.id, null);
    res.json({ success: true });
});

// El token de solo lectura para los enlaces de OBS (ver auth.overlayTokenFor).
// Lo pide el panel de una sesión abierta antes de que ese token existiera.
// A propósito NO toca `pending_key_reveal` (a diferencia de /verify, que
// entrega la clave nueva de una compra una sola vez): pedir esto jamás puede
// hacer que el streamer pierda esa clave.
app.get('/api/auth/overlay-key', auth.requireAuth, generalLimiter, (req, res) => {
    res.json({ success: true, overlayKey: auth.overlayTokenFor(req.license) });
});

// Renueva SOLO los enlaces de overlay: sube la "época" del token (ver
// auth.overlayTokenFor), así que los enlaces anteriores dejan de servir y se cortan
// los overlays que ya estaban conectados con ellos. La clave de licencia y la sesión
// no cambian. Es lo que se hace cuando un enlace de OBS se filtró (una captura, una
// pantalla compartida). Límite bajo: no es algo que se haga a diario.
const rotateOverlayLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.post('/api/auth/rotate-overlay-key', auth.requireAuth, rotateOverlayLimiter, async (req, res) => {
    try {
        await db.bumpOverlayEpoch(req.license.id);
        const row = await db.findById(req.license.id);
        // Solo los overlays con token: el panel (sesión) y los enlaces anteriores con
        // la clave cruda no se tocan (esos se invalidan regenerando la clave).
        let disconnected = 0;
        for (const socket of await io.in(req.license.id).fetchSockets()) {
            if (socket.authMethod === 'overlay') { socket.disconnect(true); disconnected++; }
        }
        console.log('[Overlay] ' + req.license.username + ' renovó sus enlaces de overlay (' + disconnected + ' conexión(es) cortada(s)).');
        res.json({ success: true, overlayKey: auth.overlayTokenFor(row), disconnected });
    } catch (err) {
        console.error('[Overlay] No se pudieron renovar los enlaces:', err.message);
        res.status(500).json({ success: false, error: 'No se pudieron renovar los enlaces. Intenta de nuevo.' });
    }
});

// Re-chequeo liviano de un token ya emitido: lo usa la app de escritorio
// (que corre el juego 100% local) para confirmar cada tanto que la key
// sigue viva contra este servidor — revocada, expirada, o reemplazada por
// otro dispositivo se detectan acá sin necesitar ninguna otra infraestructura.
app.get('/api/auth/verify', auth.requireAuth, generalLimiter, async (req, res) => {
    const row = req.license;
    // De un solo uso: si un pago rotó la key (compra de un plan pago, ver
    // applyPaymentWithRetry), acá es donde el frontend la ve
    // por primera y única vez — se borra de la DB apenas se lee.
    if (row.pending_key_reveal) await db.consumePendingKeyReveal(row.id);
    res.json({
        success: true,
        license: sessionLicense(row),
        newKey: row.pending_key_reveal || undefined,
    });
});



// ==========================================
// ADMINISTRACIÓN DE LICENCIAS (solo notbenjaa1 / cualquier licencia isAdmin)
// ==========================================
app.get('/api/licenses', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const rows = await db.listAll();
    // Quiénes tienen hoy cupo en la app de Spotify de la plataforma: el admin
    // necesita saber a quién cargar en User Management del dashboard.
    const slotHolders = await db.getSharedSpotifySlotHolders(spotify.SHARED_SLOTS_TOTAL);
    // A qué cuenta de Spotify está vinculada cada licencia (solo el nombre, sin
    // tokens) y quién más usa esa MISMA cuenta con la app de la plataforma: el
    // tope de Spotify cuenta cuentas distintas, así que dos licencias con la
    // misma cuenta valen un solo lugar (ver SHARED_SLOTS_TOTAL en spotify.js).
    const links = await db.listSpotifyAccountLinks();
    const usernameById = new Map(rows.map(row => [row.id, row.username]));
    const spotifyAccountOf = (row) => {
        const link = links.find(l => l.license_id === row.id);
        if (!link) return null;
        const sharedWith = (link.own_app || !link.spotify_user_id) ? [] : links
            .filter(other => other.license_id !== row.id && !other.own_app && other.spotify_user_id === link.spotify_user_id)
            .map(other => usernameById.get(other.license_id))
            .filter(Boolean);
        return { displayName: link.display_name, connectedAt: link.connected_at, ownApp: !!link.own_app, sharedWith };
    };
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
        spotifyAddon: !!row.spotify_addon,
        lifetimeAt: row.lifetime_at,
        spotifySharedSlot: slotHolders.includes(row.id),
        spotifyAccount: spotifyAccountOf(row),
    }));
    res.json({ success: true, licenses });
});

app.post('/api/licenses', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const { username, licenseType, diceTier, spotifyAddon } = req.body || {};

    if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ success: false, error: 'Falta el usuario' });
    }
    if (!VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: 'Tipo de licencia inválido' });
    }
    if (diceTier !== undefined && !VALID_DICE_TIERS.includes(diceTier)) {
        return res.status(400).json({ success: false, error: 'Nivel de Color Says inválido' });
    }
    if (spotifyAddon !== undefined && typeof spotifyAddon !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Complemento de Spotify inválido' });
    }

    // Mismo formato legible que las claves de prueba y de compra
    // (alias-etiqueta-hash, ver auth.generateLabeledKey) en vez de un hash
    // suelto: el admin las entrega a mano y tienen que poder leerse/dictarse.
    const key = auth.generateLabeledKey(username.trim(), PLAN_KEY_LABELS[licenseType]);
    const row = await db.insertLicense({
        id: crypto.randomUUID(),
        ...storedKeyFields(key),
        username: username.trim(),
        licenseType,
        isAdmin: false,
        createdAt: Date.now(),
        expiresAt: auth.computeExpiresAt(licenseType),
        diceTier: diceTier || 'regular',
        // Complemento de Spotify de regalo (o cobrado por fuera): la licencia
        // nace con acceso aunque sea Mensual, sin pasar por el checkout.
        spotifyAddon: spotifyAddon === true,
    });

    audit(req, 'license.create', { id: row.id, label: row.username }, { licenseType, diceTier: diceTier || 'regular', spotifyAddon: spotifyAddon === true });

    // La key en claro se devuelve UNA sola vez: a partir de acá solo vive hasheada.
    res.json({
        success: true,
        key,
        license: {
            id: row.id, username: row.username, licenseType: row.license_type,
            createdAt: row.created_at, expiresAt: row.expires_at, spotifyAddon: !!row.spotify_addon,
        },
    });
});

// Regenera la clave de una licencia ya creada: la forma de darle el formato
// alias-etiqueta-hash a las que se emitieron con el hash suelto de antes (o
// de reemplazar una clave que se filtró). La vieja deja de servir para
// cualquier conexión NUEVA — login y las URLs de overlay de OBS, que llevan la
// key cruda, en cuanto se recargan — y se invalidan sus sesiones (JWT), salvo
// en las multi-dispositivo, cuyos tokens no dependen de session_id (ver
// checkTokenStatus en auth.js): el panel avisa antes de confirmar. Igual que
// al revocar, un socket que YA está abierto sigue hasta que se corte. La nueva
// se devuelve UNA sola vez, como al crear. La licencia admin queda afuera a
// propósito (perder su clave = perder el panel; se regenera con seed-admin.js).
app.post('/api/licenses/:id/regenerate-key', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    if (row.is_admin) {
        return res.status(400).json({ success: false, error: 'La clave de una licencia admin se regenera con seed-admin.js' });
    }
    const key = auth.generateLabeledKey(row.username, PLAN_KEY_LABELS[row.license_type] || String(row.license_type).toLowerCase());
    await db.setLicenseKey(row.id, storedKeyFields(key));
    console.log(`[Licencias] ${req.license.username} regeneró la clave de la licencia ${row.id} (@${row.username}).`);
    audit(req, 'license.regenerate_key', { id: row.id, label: row.username });
    pushLicenseState(row.id);
    res.json({ success: true, key, license: { id: row.id, username: row.username } });
});

// "Ver clave" del panel de Licencias: le devuelve al admin la clave original
// de una licencia para que el streamer que la perdió la recupere sin
// regenerarla (regenerar cambia la clave y con ella los enlaces de overlay,
// que se derivan de la clave). Solo existe para las claves creadas o
// regeneradas después de que se empezaran a guardar cifradas (ver
// key_encrypted en db.js); de las anteriores solo queda el hash. Las
// licencias admin quedan fuera a propósito: su clave no se muestra por aquí
// (mismo criterio que regenerate-key). Cada consulta queda en el historial.
app.get('/api/licenses/:id/key', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    // La propia sí: el admin puede ver SU clave (para recuperarla si la
    // perdió), nunca la de otra licencia admin.
    if (row.is_admin && row.id !== req.license.id) {
        return res.status(403).json({ success: false, error: 'La clave de una licencia admin no se muestra aquí.' });
    }
    let key;
    try {
        key = await db.getLicenseKey(row.id);
    } catch (err) {
        console.error(`[Licencias] No se pudo descifrar la clave de la licencia ${row.id}:`, err.message);
        return res.status(500).json({ success: false, error: 'No se pudo leer la clave guardada.' });
    }
    if (!key) {
        return res.status(404).json({
            success: false,
            legacy: true,
            error: 'Esta clave es de antes de que se guardaran las claves y no se puede recuperar. Regenérala: sus enlaces de overlay siguen funcionando.',
        });
    }
    audit(req, 'license.view_key', { id: row.id, label: row.username });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, key });
});

// El admin regenera SU PROPIA clave (la de cualquier otra licencia admin sigue
// fuera, ver regenerate-key): para quien la perdió y sigue con la sesión
// abierta. La sesión de ESTA pestaña sigue valiendo (se le devuelve su mismo
// session_id) y las demás se cierran, como al regenerar cualquier clave. Los
// enlaces de overlay no cambian (ver overlay_key_hash). La clave nueva queda
// cifrada, así que después también se puede ver con "Ver clave".
app.post('/api/auth/regenerate-own-key', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = req.license;
    const label = row.is_admin ? 'admin' : (PLAN_KEY_LABELS[row.license_type] || String(row.license_type).toLowerCase());
    const key = auth.generateLabeledKey(row.username, label);
    await db.setLicenseKey(row.id, storedKeyFields(key));
    if (req.sessionId) await db.setSession(row.id, req.sessionId);
    await kickOtherDevices(row.id, req.sessionId);
    const updated = await db.findById(row.id);
    console.log(`[Licencias] ${row.username} regeneró su propia clave.`);
    audit(req, 'license.regenerate_own_key', { id: row.id, label: row.username });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, key, license: sessionLicense(updated) });
});

app.post('/api/licenses/:id/revoke', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    await db.revoke(row.id);
    audit(req, 'license.revoke', { id: row.id, label: row.username });
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
    audit(req, 'license.multi_device', { id: row.id, label: row.username }, { enabled: !!enabled });
    pushLicenseState(row.id);
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
    audit(req, 'license.win_bonus', { id: row.id, label: row.username }, { enabled: !!enabled });
    pushLicenseState(row.id);
    res.json({ success: true });
});

// Complemento de Spotify a mano (ver spotify.js, "Quién puede usarlo"): para
// un pago hecho por fuera de la plataforma o para quitarlo tras un reembolso
// — las compras normales lo encienden solas (ver computeLicenseUpdateForPurchase).
app.post('/api/licenses/:id/spotify-addon', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const { enabled } = req.body || {};
    await db.setSpotifyAddon(row.id, !!enabled);
    audit(req, 'license.spotify_addon', { id: row.id, label: row.username }, { enabled: !!enabled });
    pushLicenseState(row.id);
    res.json({ success: true });
});

// Resumen del negocio para el panel de Licencias: licencias por estado y plan,
// por vencer, conversión de pruebas e ingresos (ver lib/adminStats.js).
app.get('/api/admin/stats', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    try {
        const [licenses, payments] = await Promise.all([db.listAll(), db.listPaymentsForStats()]);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, stats: computeAdminStats(licenses, payments) });
    } catch (err) {
        console.error('[Admin] No se pudieron calcular las estadísticas:', err.message);
        res.status(500).json({ success: false, error: 'No se pudieron calcular las estadísticas' });
    }
});

// Edición completa de una licencia en UNA sola llamada (formulario "Editar" del
// panel de Licencias): cualquier campo que no venga se deja como está.
//   licenseType  -> renueva: nuevo plan y vencimiento calculado desde ahora
//   diceTier     -> nivel de Color Says
//   multiDevice / spotifyAddon / winBonus -> interruptores
// La licencia admin solo admite los interruptores: su plan y su nivel no se
// tocan desde aquí. El complemento de Spotify se puede dar a CUALQUIER licencia.
app.post('/api/licenses/:id/edit', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    const row = await db.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });
    const { licenseType, diceTier, multiDevice, spotifyAddon, winBonus } = req.body || {};
    if (licenseType !== undefined && !VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: 'Tipo de licencia inválido' });
    }
    if (diceTier !== undefined && !VALID_DICE_TIERS.includes(diceTier)) {
        return res.status(400).json({ success: false, error: 'Nivel de Color Says inválido' });
    }
    for (const [name, value] of Object.entries({ multiDevice, spotifyAddon, winBonus })) {
        if (value !== undefined && typeof value !== 'boolean') {
            return res.status(400).json({ success: false, error: `Valor inválido: ${name}` });
        }
    }
    if (row.is_admin && (licenseType !== undefined || (diceTier !== undefined && diceTier !== row.dice_tier))) {
        return res.status(400).json({ success: false, error: 'El plan y el nivel de una licencia admin no se cambian desde aquí' });
    }
    if (licenseType !== undefined) {
        await db.extendLicense(row.id, licenseType, auth.computeExpiresAt(licenseType), diceTier ?? row.dice_tier);
    } else if (diceTier !== undefined && diceTier !== row.dice_tier) {
        await db.setDiceTier(row.id, diceTier);
    }
    if (multiDevice !== undefined && multiDevice !== !!row.multi_device) await db.setMultiDevice(row.id, multiDevice);
    if (spotifyAddon !== undefined && spotifyAddon !== !!row.spotify_addon) await db.setSpotifyAddon(row.id, spotifyAddon);
    if (winBonus !== undefined && winBonus !== !!row.dice_win_bonus_unlocked) await db.setWinBonusUnlocked(row.id, winBonus);
    console.log(`[Licencias] ${req.license.username} editó la licencia ${row.id} (@${row.username}).`);
    const changes = {};
    if (licenseType !== undefined) changes.licenseType = licenseType;
    if (diceTier !== undefined && diceTier !== row.dice_tier) changes.diceTier = diceTier;
    if (multiDevice !== undefined && multiDevice !== !!row.multi_device) changes.multiDevice = multiDevice;
    if (spotifyAddon !== undefined && spotifyAddon !== !!row.spotify_addon) changes.spotifyAddon = spotifyAddon;
    if (winBonus !== undefined && winBonus !== !!row.dice_win_bonus_unlocked) changes.winBonus = winBonus;
    audit(req, 'license.edit', { id: row.id, label: row.username }, changes);
    pushLicenseState(row.id);
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
    audit(req, 'license.extend', { id: row.id, label: row.username }, { licenseType, diceTier });
    pushLicenseState(row.id);
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
    cleanLicenseFiles(row.id);
    audit(req, 'license.delete', { id: row.id, label: row.username });
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
            cleanLicenseFiles(row.id);
            deleted++;
        } catch (err) {
            console.error('[licenses] Error eliminando en bloque', id, err.message);
            skipped.push(id);
        }
    }
    audit(req, 'license.bulk_delete', {}, { deleted, skipped: skipped.length });
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
    // `spotify_addon` no es un plan (ver pricing.js): se acepta aparte para
    // que su precio se edite desde el mismo panel que los otros tres.
    const isSpotifyAddon = planType === pricing.SPOTIFY_ADDON_KEY;
    if (!isSpotifyAddon && !pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan inválido' });
    }
    if (!Number.isInteger(amountCents) || amountCents < pricing.MIN_PLAN_PRICE_CENTS) {
        return res.status(400).json({ success: false, error: `El precio mínimo es de ${(pricing.MIN_PLAN_PRICE_CENTS / 100).toFixed(2)} MXN` });
    }
    try {
        const { oldAmountCents } = isSpotifyAddon
            ? await pricing.setSpotifyAddonPriceCents(amountCents, req.license.username)
            : await pricing.setPlanPriceCents(planType, amountCents, req.license.username);
        audit(req, 'pricing.set', { label: planType }, { oldAmountCents, newAmountCents: amountCents });
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

// Todo lo que hace falta saber del acceso de una licencia a Spotify (ver
// spotify.evaluateAccess): su app propia, quiénes tienen hoy cupo en la app
// de la plataforma y el veredicto. Lo comparten conectar, estado y guardar
// app, así los tres deciden igual.
async function spotifyAccessFor(license) {
    const [ownApp, slotHolders] = await Promise.all([
        db.getSpotifyApp(license.id),
        db.getSharedSpotifySlotHolders(spotify.SHARED_SLOTS_TOTAL),
    ]);
    const access = spotify.evaluateAccess({ license, hasOwnApp: !!ownApp, sharedSlotHolderIds: slotHolders });
    return { ownApp, slotHolders, access };
}

// Mensaje para quien no tiene derecho a Spotify (lo usan las rutas que lo
// rechazan): distingue al Mensual, que sí puede comprar el complemento.
function spotifyNotEntitledMessage(access) {
    return access.addonRequired
        ? 'Tu plan Mensual no incluye Spotify: activa el complemento de pago único.'
        : 'Spotify está incluido en los planes Anual y Lifetime.';
}

// Devuelve la URL de Spotify a la que el panel redirige (window.location.href
// del lado del cliente) — el `state` lleva la licencia firmada porque el
// callback de más abajo no tiene el header Authorization disponible (es
// Spotify quien redirige al navegador, no un fetch nuestro). Conecta con la
// app propia de la licencia si la tiene, o con la de la plataforma si le
// toca cupo.
app.get('/api/spotify/connect', auth.requireAuth, generalLimiter, async (req, res) => {
    try {
        // El panel ya no ofrece el botón a quien no puede (ver /status), esto
        // cubre a quien llame a la ruta directo.
        const { ownApp, access } = await spotifyAccessFor(req.license);
        if (!access.entitled) {
            return res.status(403).json({ success: false, error: spotifyNotEntitledMessage(access) });
        }
        if (access.needsOwnApp) {
            return res.status(409).json({ success: false, error: 'Primero crea tu propia app de Spotify y guarda sus credenciales.' });
        }
        const state = auth.signSpotifyState(req.license.id);
        res.json({ success: true, authUrl: spotify.getAuthUrl(state, ownApp) });
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
    // Fuera del try para que el catch de abajo sepa con cuál app fue.
    let ownApp = null;
    try {
        // El código de autorización solo se canjea con la app que lo emitió:
        // la propia de esta licencia si la tiene, la de la plataforma si no.
        ownApp = await db.getSpotifyApp(licenseId);
        const tokens = await spotify.exchangeCodeForTokens(code, ownApp);
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
        // Mismo identificador que el resto de los logs ("alias/8 primeros del
        // id"); sin él, todos los intentos fallidos se veían idénticos y no
        // había forma de saber a qué streamer atender.
        const who = tenants.get(licenseId)?.logId || String(licenseId).slice(0, 8);
        if (err instanceof spotify.SpotifyUserNotRegisteredError && ownApp) {
            // En su PROPIA app no hay a quién pedirle nada: le falta agregar su
            // correo en User Management de esa app (paso de la guía del panel).
            console.warn(`[${who}] [Spotify] Conexión rechazada: la cuenta de Spotify no está en la lista de usuarios de SU PROPIA app (modo Development). Le falta agregar su correo en User Management de esa app.`);
            return res.redirect(`${FRONTEND_URL}/?spotify=not_registered_own`);
        }
        if (err instanceof spotify.SpotifyUserNotRegisteredError) {
            // Reintentar no sirve de nada: mientras la app de Spotify esté en
            // modo Development (ver spotify.js), esa cuenta tiene que cargarse
            // a mano en el dashboard — y para eso hace falta su correo de
            // Spotify, que a nosotros no nos llega (ni /me responde).
            console.warn(`[${who}] [Spotify] Conexión rechazada: la cuenta de Spotify de este streamer no está en la lista de usuarios de la app (modo Development). Pídele el correo de su cuenta de Spotify y agrégala en developer.spotify.com/dashboard > tu app > Settings > User Management.`);
            return res.redirect(`${FRONTEND_URL}/?spotify=not_registered`);
        }
        console.error(`[${who}] [Spotify] Error en el callback de OAuth:`, err.message);
        res.redirect(`${FRONTEND_URL}/?spotify=error`);
    }
});

// Lo que el panel necesita para decidir qué mostrar (ver Spotify.jsx):
// `access` (derecho, con qué app conecta, si le toca crear la suya o comprar
// el complemento), los cupos de la app de la plataforma, su app propia (solo
// el Client ID: el secreto nunca vuelve al navegador), el Redirect URI que
// tiene que registrar en su app y el precio del complemento.
app.get('/api/spotify/status', auth.requireAuth, generalLimiter, async (req, res) => {
    const { ownApp, slotHolders, access } = await spotifyAccessFor(req.license);
    // Sin con qué conectar (plan sin derecho, o sin app propia ni cupo) nunca
    // figura como "conectada", aunque haya quedado una cuenta guardada de
    // antes: el comando del chat tampoco la usa (ver getAllowedSpotifyAccount
    // en tenant/spotify.js).
    const canConnect = access.entitled && access.source !== null;
    const account = canConnect ? await db.getSpotifyAccount(req.license.id) : null;
    res.json({
        success: true,
        allowed: canConnect,
        access,
        sharedSlots: { total: spotify.SHARED_SLOTS_TOTAL, used: slotHolders.length },
        ownApp: ownApp ? { clientId: ownApp.clientId } : null,
        redirectUri: spotify.REDIRECT_URI,
        addonPriceCents: pricing.getSpotifyAddonPriceCents(),
        connected: !!account,
        displayName: account?.display_name || null,
        // Cuándo autorizó: Spotify caduca la conexión a los 6 meses de esta
        // fecha (ver SpotifyRefreshTokenExpiredError), el panel avisa antes.
        connectedAt: account?.connected_at ?? null,
    });
});

// Guarda la app de Spotify propia del streamer (client id + secret que pegó
// del dashboard). Antes de guardar se comprueba con Spotify que el par sea
// real, para que se entere ahora y no después de un OAuth que falla. El
// secreto se cifra en la DB y nunca se devuelve ni se loguea. Guardarla borra
// la cuenta conectada (sus tokens eran de otra app): hay que volver a
// conectar.
app.post('/api/spotify/app', auth.requireAuth, spotifyAppLimiter, async (req, res) => {
    const { access } = await spotifyAccessFor(req.license);
    if (!access.entitled) {
        return res.status(403).json({ success: false, error: spotifyNotEntitledMessage(access) });
    }
    const credentials = spotify.parseAppCredentials(req.body);
    if (!credentials) {
        return res.status(400).json({ success: false, error: 'Pega el Client ID y el Client secret tal como aparecen en el dashboard de Spotify.' });
    }
    const who = tenants.get(req.license.id)?.logId || String(req.license.id).slice(0, 8);
    try {
        await spotify.verifyAppCredentials(credentials);
    } catch (err) {
        if (err instanceof spotify.SpotifyInvalidCredentialsError) {
            return res.status(400).json({ success: false, error: 'Spotify no reconoció ese Client ID y Client secret. Revisa que los copiaste completos y que son de la misma app.' });
        }
        console.error(`[${who}] [Spotify] No se pudieron verificar las credenciales de la app propia:`, err.message);
        return res.status(502).json({ success: false, error: 'No se pudo verificar con Spotify. Intenta de nuevo en un momento.' });
    }
    try {
        await db.upsertSpotifyApp(req.license.id, credentials);
    } catch (err) {
        console.error(`[${who}] [Spotify] No se pudo guardar la app propia:`, err.message);
        return res.status(500).json({ success: false, error: 'No se pudo guardar la app. Intenta de nuevo en un momento.' });
    }
    res.json({ success: true });
});

// Quita la app propia (y la cuenta conectada con ella): la licencia vuelve a
// depender de su cupo en la app de la plataforma, si lo tiene.
app.delete('/api/spotify/app', auth.requireAuth, generalLimiter, async (req, res) => {
    await db.deleteSpotifyApp(req.license.id);
    res.json({ success: true });
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
const STICKER_ALERT_LABEL_ES = 'ese sticker del club de fans';
const MIN_COINS_CAP = 999999;
// Mismas listas que ANIMATION_IN_OPTIONS/ANIMATION_OUT_OPTIONS en
// AlertsAdmin.jsx — 'none' significa "sin animación, aparece/desaparece
// de golpe"; 'bounce' es exclusivo de entrada (no tiene mucho sentido
// como salida, ver Overlay.jsx).
const ENTRANCE_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'bounce'];
const EXIT_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom'];

const TEXT_POSITIONS = ['above', 'below', 'beside'];

function serializeAlert(row) {
    const giftName = row.gift_name.startsWith('__draft_gift__:') ? '' : row.gift_name;
    const triggerType = row.trigger_type || 'gift';
    return {
        id: row.id, giftName,
        visualUrl: row.visual_url, visualType: row.visual_type, visualMuted: !!row.visual_muted,
        audioUrl: row.audio_url,
        text: row.alert_text || '', textPosition: row.text_position || 'below', textColor: row.text_color || null,
        giftId: row.gift_id || null,
        giftIcon: row.gift_icon || null,
        durationMs: row.duration_ms, position: row.position,
        entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
        triggerType,
        minCoins: row.min_coins != null ? Number(row.min_coins) : null,
        // Solo las alertas de UN sticker del club de fans (su clave es sticker:<id>); la
        // general de "cualquier sticker" no lleva id.
        stickerId: row.trigger_type === 'sticker' ? stickerIdFromKey(row.gift_name) || null : null,
        // Nombre corto para la tira de regalos (overlay 'ticker', solo alertas de un
        // regalo puntual). Una alerta vieja nunca guardó el nombre real del archivo
        // que se subió (no se capturaba antes de esto) -- se completa con el nombre
        // del regalo para que la tira nunca muestre un ítem sin texto.
        apodo: row.apodo || (triggerType === 'gift' ? giftName : '') || '',
    };
}

app.get('/api/alerts', auth.requireAuth, generalLimiter, async (req, res) => {
    const alerts = await db.listAlertConfigs(req.license.id);
    const quota = quotaInfo(req.license, alerts.length);
    // El texto del límite viaja con la lista para que el panel lo muestre cuando se llegue al tope,
    // sin repetir aquí la redacción de cada plan.
    res.json({ success: true, alerts: alerts.map(serializeAlert), quota, limitMessage: quota.unlimited ? null : limitMessage(req.license) });
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
    // 'sticker' puede llevar además el id del sticker elegido en el selector (clave
    // sticker:<id>, una alerta por sticker); sin id es la de "cualquier sticker".
    let triggerKey;
    let minCoins = null;
    let stickerId = '';
    if (triggerType === 'gift') {
        // Clave única por borrador: las alertas existentes no se migran ni modifican.
        triggerKey = typeof giftName === 'string' && giftName.trim()
            ? giftName.trim().slice(0, 120) : `__draft_gift__:${crypto.randomUUID()}`;
    } else if (triggerType === 'gift_global') {
        minCoins = Math.trunc(Number(req.body?.minCoins));
        if (!Number.isFinite(minCoins) || minCoins < 1 || minCoins > MIN_COINS_CAP) {
            return res.status(400).json({ success: false, error: `El mínimo de monedas debe ser un número entre 1 y ${MIN_COINS_CAP}` });
        }
        triggerKey = `global:${minCoins}`;
    } else if (triggerType === 'sticker') {
        const askedStickerId = typeof req.body?.stickerId === 'string' ? req.body.stickerId.trim() : '';
        stickerId = cleanStickerId(askedStickerId);
        // Un id que no sirve nunca se convierte en silencio en la alerta general.
        if (askedStickerId && !stickerId) return res.status(400).json({ success: false, error: 'Sticker no válido' });
        triggerKey = stickerAlertKey(stickerId);
    } else {
        triggerKey = triggerType;
    }

    const visualFile = req.files?.visual?.[0];
    const audioFile = req.files?.audio?.[0];
    const visualMedia = visualFile ? sniffMedia(visualFile.buffer) : null;
    if (visualFile && !ALERT_VISUAL_GROUPS.includes(visualMedia?.group)) {
        return res.status(400).json({ success: false, error: 'Formato de imagen o video no soportado. Usa PNG, JPG, WEBP, GIF, MP4 o WEBM.' });
    }
    const audioMedia = audioFile ? sniffMedia(audioFile.buffer) : null;
    if (audioFile && audioMedia?.group !== 'audio') {
        return res.status(400).json({ success: false, error: 'Formato de audio no soportado. Usa MP3, WAV u OGG.' });
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 200) : '';
    const finalTextPosition = TEXT_POSITIONS.includes(req.body?.textPosition) ? req.body.textPosition : 'below';
    // Color propio de esta alerta (#RRGGBB); vacío/inválido = sigue el estilo
    // general de las alertas.
    const finalTextColor = typeof req.body?.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.textColor) ? req.body.textColor : null;
    // Id numérico del regalo elegido en el selector: con él la alerta se
    // encuentra aunque el nombre del evento en vivo no coincida con el del
    // catálogo (ver findAlertConfig en lib/tenant/alerts.js).
    const bodyGiftId = /^\d{1,20}$/.test(String(req.body?.giftId ?? '')) ? String(req.body.giftId) : null;
    // La imagen del regalo tal como la mostró el selector: la tira de regalos
    // la necesita si el regalo todavía no llegó en ningún directo. Solo https
    // y de largo razonable: termina en un <img> del overlay.
    const bodyGiftIcon = typeof req.body?.giftIcon === 'string' && /^https:\/\//i.test(req.body.giftIcon) && req.body.giftIcon.length <= 500 ? req.body.giftIcon : null;
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
        if (alertId && !isEditing) return res.status(404).json({ success: false, error: 'Alerta no encontrada' });
        if (isEditing && triggerType === 'gift' && !(typeof giftName === 'string' && giftName.trim())) {
            triggerKey = (editingRow.trigger_type || 'gift') === 'gift' ? editingRow.gift_name : triggerKey;
        }
        const allAlerts = await db.listAlertConfigs(req.license.id);
        const occupyingRow = allAlerts.find((row) => row.gift_name.toLowerCase() === triggerKey.toLowerCase());

        // Si el disparador destino ya lo usa OTRA alerta (no la que se está
        // editando), no se pisa en silencio -- el streamer tiene que
        // resolverlo a mano primero (borrar esa otra, o elegir otro
        // disparador).
        if (occupyingRow && (!isEditing || occupyingRow.id !== editingRow.id)) {
            const conflictLabel = triggerType === 'gift' ? triggerKey
                : triggerType === 'gift_global' ? `general de ${minCoins} monedas`
                : triggerType === 'sticker' && stickerId ? STICKER_ALERT_LABEL_ES
                : TRIGGER_LABEL_ES[triggerType] || triggerKey;
            const conflictNoun = triggerType === 'gift_global' ? 'mínimo' : 'disparador';
            return res.status(409).json({ success: false, error: `Ya existe una alerta para "${conflictLabel}" — bórrala primero o elige otro ${conflictNoun}.` });
        }

        if (!isEditing && !occupyingRow && !canCreateAlert(req.license, allAlerts.length)) {
            return res.status(400).json({ success: false, error: limitMessage(req.license), quota: quotaInfo(req.license, allAlerts.length) });
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
            // El tipo y la extensión salen del contenido real, nunca de lo que declaró el navegador.
            visualPath = `${req.license.id}/${visualId}${visualMedia.ext}`;
            visualUrl = await storage.uploadFile(visualPath, visualFile.buffer, visualMedia.mime);
            finalVisualType = visualMedia.group;
        } else if (clearVisual) {
            if (existing?.visual_path) await storage.deleteFile(existing.visual_path);
            visualUrl = null; visualPath = null; finalVisualType = null;
        }

        let audioUrl = existing?.audio_url || null;
        let audioPath = existing?.audio_path || null;
        if (audioFile) {
            if (existing?.audio_path) await storage.deleteFile(existing.audio_path);
            const audioId = crypto.randomUUID();
            audioPath = `${req.license.id}/${audioId}${audioMedia.ext}`;
            audioUrl = await storage.uploadFile(audioPath, audioFile.buffer, audioMedia.mime);
        } else if (clearAudio) {
            if (existing?.audio_path) await storage.deleteFile(existing.audio_path);
            audioUrl = null; audioPath = null;
        }

        if (!visualUrl && !audioUrl && !cleanText) {
            return res.status(400).json({ success: false, error: 'Agrega al menos un recurso visual, un audio o un texto' });
        }

        // Apodo para la tira de regalos (overlay 'ticker'): lo que haya mandado el
        // panel gana; si no mandó nada, se deriva del archivo recién subido (audio
        // primero, visual si no hay audio) sin su extensión; si tampoco hay archivo
        // nuevo (edición que no tocó ningún recurso), se conserva el que ya tenía.
        const stripExt = (name) => String(name || '').replace(/\.[^./\\]+$/, '').trim().slice(0, 60);
        const bodyApodo = typeof req.body?.apodo === 'string' ? req.body.apodo.trim().slice(0, 60) : '';
        const finalApodo = bodyApodo
            || (audioFile ? stripExt(audioFile.originalname) : '')
            || (visualFile ? stripExt(visualFile.originalname) : '')
            || existing?.apodo || null;

        // El disparador cambió a mitad de una edición -- la fila vieja (con
        // su clave anterior) no la va a pisar el upsert de abajo (choca por
        // license_id+gift_name, y la clave ya es otra), así que se borra
        // acá explícitamente para no dejarla huérfana.
        if (isEditing && editingRow.gift_name.toLowerCase() !== triggerKey.toLowerCase()) {
            await db.deleteAlertConfig(editingRow.id, req.license.id);
            getOrCreateTenant(req.license.id, req.license.license_type).removeAlertConfig(editingRow.gift_name);
        }

        const id = isEditing ? editingRow.id : crypto.randomUUID();
        const row = await db.upsertAlertConfig({
            id, licenseId: req.license.id, giftName: triggerKey,
            visualUrl, visualPath, visualType: finalVisualType, visualMuted,
            audioUrl, audioPath,
            text: cleanText, textPosition: finalTextPosition, textColor: finalTextColor,
            // Solo las alertas de un regalo puntual llevan id. Al editar sin
            // cambiar de regalo se conserva el que tenía; si se elige otro
            // regalo, vale el del nuevo (o ninguno, nunca el del anterior).
            giftId: triggerType !== 'gift' ? null
                : bodyGiftId ?? (isEditing && !(typeof giftName === 'string' && giftName.trim()) ? (editingRow.gift_id ?? null) : null),
            // Mismo criterio que giftId.
            giftIcon: triggerType !== 'gift' ? null
                : bodyGiftIcon ?? (isEditing && !(typeof giftName === 'string' && giftName.trim()) ? (editingRow.gift_icon ?? null) : null),
            durationMs: finalDuration, position: finalPosition,
            entranceAnim: finalEntranceAnim, exitAnim: finalExitAnim, triggerType, minCoins,
            apodo: finalApodo,
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

// Stickers del club de fans que han llegado en el chat de esta licencia (con su imagen): son
// los que se pueden elegir al armar una alerta de sticker. TikTok no da la lista de un
// creador, así que se arma con lo que va apareciendo en sus directos (ver
// lib/stickerDirectoryCore.js); el panel se entera de los nuevos con `sticker_seen`.
app.get('/api/stickers', auth.requireAuth, generalLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const tenant = getOrCreateTenant(req.license.id, req.license.license_type);
    await tenant.getStickerDirectory().load();
    res.json({ success: true, stickers: tenant.getKnownStickers() });
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

// Sonido opcional al completar el Objetivo (pedido explícito) -- mismo
// bucket/criterio de subida que las Alertas, pero acá es UN solo archivo
// por licencia (no una fila por disparador): se guarda directo en
// `goal_settings` de la licencia, no en `alert_configs`.
app.post('/api/goal/audio', auth.requireAuth, generalLimiter, uploadGoalAudio, async (req, res) => {
    const audioFile = req.file;
    if (!audioFile) return res.status(400).json({ success: false, error: 'Falta el archivo de audio' });
    const audioMedia = sniffMedia(audioFile.buffer);
    if (audioMedia?.group !== 'audio') {
        return res.status(400).json({ success: false, error: 'Formato de audio no soportado. Usa MP3, WAV u OGG.' });
    }
    try {
        const tenant = getOrCreateTenant(req.license.id, req.license.license_type);
        if (tenant.goalAudioPath) await storage.deleteFile(tenant.goalAudioPath);
        const audioId = crypto.randomUUID();
        const audioPath = `${req.license.id}/goal-${audioId}${audioMedia.ext}`;
        const audioUrl = await storage.uploadFile(audioPath, audioFile.buffer, audioMedia.mime);
        await db.setGoalSettings(req.license.id, { audioUrl, audioPath });
        tenant.setGoalAudio(audioUrl, audioPath);
        res.json({ success: true, audioUrl });
    } catch (err) {
        console.error('[Objetivo] Error subiendo el audio:', err.message);
        res.status(500).json({ success: false, error: 'No se pudo guardar el audio — revisa que Supabase Storage esté configurado.' });
    }
});

app.delete('/api/goal/audio', auth.requireAuth, generalLimiter, async (req, res) => {
    const tenant = getOrCreateTenant(req.license.id, req.license.license_type);
    if (tenant.goalAudioPath) await storage.deleteFile(tenant.goalAudioPath);
    await db.setGoalSettings(req.license.id, { audioUrl: null, audioPath: null });
    tenant.setGoalAudio(null, null);
    res.json({ success: true });
});

// ==========================================
// PAGOS -- autoservicio total con Stripe (rutas más abajo). El monto SIEMPRE
// se calcula acá desde pricing.js a partir de planType/diceTier/
// spotifyAddon; nunca se confía en un precio que mande el cliente.
// ==========================================

// Validación del cuerpo de compra: devuelve el
// mensaje de rechazo o null. `spotifyAddon` tiene que ser un booleano; si es
// true se aplican las reglas de spotify.addonPurchaseError sobre la licencia
// que paga.
function purchaseItemsError(license, { planType, diceTier, spotifyAddon }) {
    if (planType !== undefined && !pricing.isValidPlan(planType)) return 'Plan invalido';
    if (diceTier !== undefined && !pricing.isValidAddon(diceTier)) return 'Addon invalido';
    if (spotifyAddon !== undefined && typeof spotifyAddon !== 'boolean') return 'Addon invalido';
    if (!planType && !diceTier && spotifyAddon !== true) return 'Elige al menos un plan o un addon';
    if (spotifyAddon === true) return spotify.addonPurchaseError(license, planType);
    return null;
}

// Precios vigentes de los 3 planes (override del admin si existe, default
// de pricing.js si no) -- publica a proposito, sin auth: la vitrina de
// Membership.jsx la necesita ANTES de que exista una sesion (ver el
// comentario de "Anonymous purchase flow" en Membership.jsx).
app.get('/api/pricing', async (req, res) => {
    // Cupos de Spotify en la app de la plataforma (solo el conteo: la
    // vitrina avisa cuántos quedan para los primeros Lifetime). Si la
    // consulta falla los precios se siguen sirviendo, sin ese dato.
    let spotifySlots = null;
    try {
        const holders = await db.getSharedSpotifySlotHolders(spotify.SHARED_SLOTS_TOTAL);
        spotifySlots = { total: spotify.SHARED_SLOTS_TOTAL, used: holders.length };
    } catch (err) {
        console.error('[Pricing] No se pudieron leer los cupos de Spotify:', err.message);
    }
    res.json({
        success: true,
        prices: pricing.getAllPlanPricesCents(),
        spotifyAddon: pricing.getSpotifyAddonPriceCents(),
        spotifySlots,
    });
});

// Lo que cambia en la licencia al aplicar una compra: rotación de key,
// cálculo de expiración y upgrade de dice_tier. Es la parte más delicada de
// todo el flujo de pagos, así que se calcula en un solo lugar.
function computeLicenseUpdateForPurchase(license, { planType, diceTier, spotifyAddon }, { rotateKey = true } = {}) {
    const update = {};
    if (planType) {
        update.licenseType = planType;
        // Los días que le sobraban a una licencia vigente se SUMAN al nuevo
        // periodo (antes solo se conservaban en la prueba gratis, así que
        // renovar antes de tiempo hacía perder lo ya pagado). Una licencia
        // revocada o ya vencida empieza de cero.
        const remainingMs = (!license.revoked && license.expires_at && license.expires_at > Date.now())
            ? (license.expires_at - Date.now())
            : 0;
        const baseExpiresAt = auth.computeExpiresAt(planType);
        update.expiresAt = baseExpiresAt === null ? null : baseExpiresAt + remainingMs;

        // El cobro al final de una prueba (Lifetime) no cambia la clave: el
        // streamer ya la usa desde hace 14 días.
        if (rotateKey) {
            const newRawKey = auth.generateLabeledKey(license.username, PLAN_KEY_LABELS[planType] || planType.toLowerCase());
            Object.assign(update, storedKeyFields(newRawKey));
            update.pendingKeyReveal = newRawKey;
        }
    }
    if (diceTier) {
        const currentRank = pricing.DICE_TIER_RANK[license.dice_tier] ?? 0;
        const newRank = pricing.DICE_TIER_RANK[diceTier] ?? 0;
        if (newRank > currentRank) update.diceTier = diceTier;
    }
    // Complemento de Spotify: pago único, se queda para siempre en la
    // licencia (no depende de la renovación del plan Mensual).
    if (spotifyAddon) update.spotifyAddon = true;
    return update;
}

// Aplica el efecto de un pago YA registrado sobre la licencia. Si la DB falla
// en ese momento se reintenta (3 veces); si sigue fallando se OLVIDA el registro
// del pago (`forget`) para que el siguiente reintento (/confirm o el
// webhook de Stripe) lo aplique, en vez de dejarlo como "ya procesado" con el
// cliente cobrado y sin plan. Devuelve como antes; relanza el error si no pudo.
async function applyPaymentWithRetry({ label, licenseId, planType, diceTier, spotifyAddon, forget, provider, providerPaymentId, amountCents, rotateKey = true }) {
    // Cuando un pago cobrado no se puede aplicar, además de la línea del registro
    // queda una fila en payment_failures: se ve en Sistema > Pagos y se aplica con
    // un botón (antes solo constaba en el registro del servidor).
    // Anotar el fallo jamás debe estropear el pago: ni por un error asíncrono ni por
    // uno síncrono.
    const noteFailure = (reason, error) => {
        if (!provider || !providerPaymentId) return;
        try {
            db.upsertPaymentFailure({
                provider, providerPaymentId, licenseId, planType, diceTier, spotifyAddon, amountCents,
                reason, error: String(error || '').slice(0, 300), createdAt: Date.now(),
            }).catch((err) => console.error(`[${label}] No se pudo anotar el pago fallido:`, err.message));
        } catch (err) {
            console.error(`[${label}] No se pudo anotar el pago fallido:`, err.message);
        }
    };
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const license = await db.findById(licenseId);
            if (!license) {
                console.error(`[${label}] Pago para una licencia inexistente:`, licenseId);
                noteFailure('license_missing', 'La licencia no existe');
                return { applied: false };
            }
            const update = computeLicenseUpdateForPurchase(license, { planType, diceTier, spotifyAddon }, { rotateKey });
            if (Object.keys(update).length > 0) {
                await db.applyPurchase(licenseId, update);
                console.log(`[${label}] ✅ Pago aplicado — licencia ${licenseId}:`, update);
                pushLicenseState(licenseId);
            }
            // Si este pago había quedado anotado como pendiente y ahora sí se aplicó (un
            // reintento del proveedor), el aviso se cierra solo.
            if (provider && providerPaymentId) {
                try { db.resolvePaymentFailureFor(provider, providerPaymentId, 'automático').catch(() => {}); } catch { /* el aviso pendiente nunca debe estropear un pago ya aplicado */ }
            }
            return { applied: true, licenseId };
        } catch (err) {
            lastError = err;
            console.error(`[${label}] Intento ${attempt}/3 de aplicar el pago a la licencia ${licenseId} falló: ${err.message}`);
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
        }
    }
    noteFailure('apply_failed', lastError && lastError.message);
    try { await forget(); } catch (err) {
        console.error(`[${label}] ⚠️ PAGO COBRADO SIN APLICAR y sin poder olvidarlo (licencia ${licenseId}); aplícalo a mano desde Licencias > Editar:`, err.message);
        throw lastError;
    }
    console.error(`[${label}] ⚠️ PAGO COBRADO SIN APLICAR (licencia ${licenseId}): se olvidó el registro para que el próximo reintento lo aplique.`);
    throw lastError;
}

// Registra y aplica un pago de Stripe ya aprobado: idempotente via el
// UNIQUE de payments.stripe_payment_id (ver db.js) -- llamarla dos veces con el mismo
// PaymentIntent (ej. /api/payments/stripe/confirm ya lo aplico y despues
// llega el webhook) no aplica el cambio dos veces.
async function applyApprovedStripePaymentIfNew({ licenseId, planType, diceTier, spotifyAddon, stripePaymentId, newLicenseAlias, rotateKey = true }) {
    if (!licenseId || (!planType && !diceTier && !spotifyAddon)) {
        console.error('[Stripe] applyApprovedStripePaymentIfNew: faltan licenseId/planType/diceTier/spotifyAddon', { licenseId, planType, diceTier, spotifyAddon });
        return { applied: false };
    }

    const isNew = await db.insertStripePaymentIfNew({
        id: crypto.randomUUID(),
        licenseId,
        stripePaymentId: String(stripePaymentId),
        planType: planType || null,
        diceTier: diceTier || null,
        spotifyAddon: !!spotifyAddon,
        amountCents: pricing.computeAmountCents({ planType, diceTier, spotifyAddon }),
        status: 'approved',
        createdAt: Date.now(),
    });
    if (!isNew) return { applied: false, alreadyProcessed: true };

    // Compra sin cuenta (ver /api/payments/stripe/guest-checkout-session): la
    // licencia nace recién ahora, con el pago ya cobrado. Antes de pagar no
    // existe nada, así que un pago cancelado o rechazado no deja ninguna
    // licencia (ni prueba gratis) por el camino.
    if (newLicenseAlias && planType && !(await db.findCoreById(licenseId))) {
        return createPurchasedLicense({ licenseId, alias: newLicenseAlias, planType, stripePaymentId });
    }

    const result = await applyPaymentWithRetry({
        label: 'Stripe', licenseId, planType, diceTier, spotifyAddon, rotateKey,
        provider: 'stripe', providerPaymentId: String(stripePaymentId), amountCents: pricing.computeAmountCents({ planType, diceTier, spotifyAddon }),
        forget: () => db.deletePaymentRecord('stripe', stripePaymentId),
    });
    // Lifetime reemplaza a la suscripción y a cualquier prueba en curso: ya no
    // se cobra nada más.
    if (result?.applied && planType === 'lifetime') await endRecurringBillingForLifetime(licenseId);
    return result;
}

async function endRecurringBillingForLifetime(licenseId) {
    try {
        const license = await db.findCoreById(licenseId);
        if (!license) return;
        if (license.stripe_subscription_id) await billing.cancelPreviousSubscription(getStripeClient(), license, null);
        await db.applyBillingState(licenseId, {
            stripeSubscriptionId: null, subscriptionStatus: null, subscriptionPlan: 'lifetime', subscriptionCancelAt: null,
            lifetimeTrialChargeAt: null, lifetimeTrialPaymentMethod: null,
        });
    } catch (err) {
        console.error(`[Stripe] No se pudo cerrar el cobro recurrente de la licencia ${licenseId} al pasar a Lifetime:`, err.message);
    }
}

// La licencia de una compra sin cuenta, con el id que se reservó al crear la
// sesión de pago. La clave queda en pending_key_reveal hasta que el comprador
// la reclame (ver /api/payments/stripe/guest-confirm) y cifrada para el panel
// de Licencias. Si no se puede crear, se olvida el registro del pago para que
// el siguiente aviso (o /guest-confirm) lo vuelva a intentar.
async function createPurchasedLicense({ licenseId, alias, planType, stripePaymentId }) {
    const key = auth.generateLabeledKey(alias, PLAN_KEY_LABELS[planType] || planType);
    const createdAt = Date.now();
    try {
        await db.insertLicense({
            id: licenseId,
            ...storedKeyFields(key),
            pendingKeyReveal: key,
            username: alias,
            licenseType: planType,
            isAdmin: false,
            createdAt,
            expiresAt: auth.computeExpiresAt(planType),
        });
    } catch (err) {
        console.error(`[Stripe] ⚠️ PAGO COBRADO SIN LICENCIA (${stripePaymentId}, @${alias}): no se pudo crear; se olvida el registro para que el próximo reintento la cree:`, err.message);
        try {
            await db.deletePaymentRecord('stripe', stripePaymentId);
        } catch (forgetErr) {
            console.error(`[Stripe] ⚠️ Y tampoco se pudo olvidar el registro del pago ${stripePaymentId}; crea la licencia a mano:`, forgetErr.message);
        }
        throw err;
    }
    console.log(`[Stripe] ✅ Licencia nueva por compra — ${licenseId} (@${alias}, ${planType})`);
    return { applied: true, licenseId, created: true };
}

// ==========================================
// PAGOS: Stripe (formulario de Checkout embebido), el único medio de pago
// de Membership.jsx. El monto SIEMPRE se calcula acá desde pricing.js,
// nunca se confía en nada que mande el cliente. Tres pasos -- 1) se crea
// una Checkout Session (ui_mode 'form') server-side (acá abajo,
// /checkout-session), 2) el frontend monta el formulario de Stripe con su
// client_secret y lo confirma (la tarjeta nunca toca nuestro backend), y
// 3) /confirm vuelve a pedir la sesión a la API de Stripe (nunca se cree
// lo que diga el frontend) y aplica la compra. El webhook es la
// confirmación de respaldo por si el navegador se cierra entre el paso 2 y
// la llamada a /confirm.
//
// La sesión copia licenseId/planType/diceTier/spotifyAddon a la metadata
// de SU PaymentIntent (payment_intent_data.metadata), así el webhook
// payment_intent.succeeded, la conciliación de Sistema (paymentsReconcile)
// y el UNIQUE de payments.stripe_payment_id siguen funcionando igual que
// con el Payment Element anterior: lo que se guarda como pago es el id del
// PaymentIntent, no el de la sesión.
// ==========================================

const PLAN_LABELS = { month: 'Mensual', annual: 'Anual', lifetime: 'Lifetime' };

const billing = createStripeBilling({
    db, auth, pricing, getStripeClient, apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION, storedKeyFields,
    planKeyLabels: PLAN_KEY_LABELS, pushLicenseState, applyApprovedStripePaymentIfNew,
});

// Un cliente de Stripe por licencia (buscado por su metadata, sin columna
// nueva en la DB) para que "guardar tarjeta" sirva en la siguiente compra
// de ESA licencia. A propósito no se busca por correo: el correo lo escribe
// el comprador sin verificar, y con eso cualquiera podría ver/usar la
// tarjeta guardada de otra persona.
//
// El cliente nuevo se crea SIN correo ni nombre: los pide el propio
// formulario de Stripe. Según la API de Checkout, si el cliente no tiene
// correo, Checkout guarda en él el que se escriba durante el pago; si ya
// lo tiene (compras anteriores), lo muestra precargado y no se puede editar.
async function stripeCustomerForLicense(stripe, licenseId) {
    try {
        const found = await stripe.customers.search({ query: `metadata['licenseId']:'${licenseId.replace(/'/g, '')}'`, limit: 1 });
        if (found.data[0]) return found.data[0].id;
    } catch (err) {
        // La búsqueda no está en todas las cuentas/regiones: sin ella se
        // crea uno nuevo (solo se pierde mostrar la tarjeta guardada).
        console.error('[Stripe] No se pudo buscar el cliente de la licencia:', err.message);
    }
    const customer = await stripe.customers.create({ metadata: { licenseId } });
    return customer.id;
}

// Pedido explicito: evidencia real (con fecha) de que el comprador aceptó la
// política de reembolsos ANTES de pagar -- se manda como metadata del pago,
// visible en el propio dashboard de Stripe si alguien abre una disputa. Se
// exige server-side (no solo ocultar el botón en el frontend) para que el
// registro exista siempre.
function validPolicyAcceptedAt(value) {
    return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

// La Checkout Session de una compra, con o sin cuenta (ver lib/stripeBilling.js):
// - Mensual y Anual: suscripción (mode 'subscription'), con o sin 14 días gratis.
// - Lifetime con prueba: modo 'setup' (solo guarda la tarjeta; el pago único
//   se cobra al día 14).
// - Lifetime al momento, complemento de Spotify y dados: pago único, como siempre.
// El precio sale siempre de pricing.js (override del admin incluido). Una
// suscripción conserva el precio con el que empezó: si después cambias el
// precio en el panel, aplica a las suscripciones nuevas.
async function createPurchaseCheckoutSession({ licenseId, license = null, planType, diceTier, spotifyAddon, trial = false, policyAcceptedAt, extraMetadata = {}, returnUrl }) {
    const stripe = getStripeClient();
    const customer = await stripeCustomerForLicense(stripe, licenseId);
    const common = {
        // Valores configurados en Checkout Studio de Stripe.
        ui_mode: 'form',
        billing_address_collection: 'auto',
        // Nombre dentro del formulario de Stripe (opcional, como quedó en
        // Checkout Studio); el correo lo pide su sección de Contacto.
        name_collection: { individual: { enabled: true, optional: true } },
        integration_identifier: STRIPE_CHECKOUT_INTEGRATION_ID,
        customer,
        // Si el banco exige salir del sitio (raro con tarjeta: el 3DS se
        // muestra en un modal), vuelve a Membresía; el webhook aplica igual.
        return_url: returnUrl,
    };
    const metadata = {
        licenseId,
        planType: planType || '',
        diceTier: diceTier || '',
        // Los metadata de Stripe son texto: 'true' enciende el
        // complemento al confirmar/recibir el webhook, vacío no.
        spotifyAddon: spotifyAddon ? 'true' : '',
        trial: trial ? '1' : '',
        policyAcceptedAt,
        ...extraMetadata,
    };
    // Mejora de plan con tiempo pagado de sobra: se cobra al momento y esos
    // días se suman al plan nuevo (ver billing.fulfillSubscriptionSession,
    // que corre la siguiente renovación de Stripe esos mismos días).
    const bonusMs = billing.SUBSCRIPTION_PLANS.includes(planType) && !trial ? billing.remainingPaidMs(license) : 0;
    if (bonusMs > 0) metadata.bonusMs = String(bonusMs);

    if (billing.SUBSCRIPTION_PLANS.includes(planType)) {
        const subscriptionData = { description: `BenjaApis - Plan ${PLAN_LABELS[planType]}`, metadata };
        if (trial) {
            subscriptionData.trial_period_days = BILLING_TRIAL_DAYS;
            // Sin tarjeta al final de la prueba, la suscripción se cierra sola.
            subscriptionData.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
        }
        return stripe.checkout.sessions.create({
            ...common,
            mode: 'subscription',
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: 'mxn',
                    unit_amount: pricing.getPlanPriceCents(planType),
                    recurring: { interval: planType === 'annual' ? 'year' : 'month' },
                    product_data: { name: `Plan ${PLAN_LABELS[planType]}` },
                },
            }],
            // La prueba siempre con tarjeta (es la que se cobra al terminar y la
            // que tiene la huella para no repetir la prueba): sin Link.
            ...(trial ? { allowed_payment_method_types: ['card'] } : {}),
            payment_method_collection: 'always',
            metadata,
            subscription_data: subscriptionData,
        }, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
    }

    if (planType === 'lifetime' && trial) {
        const amountCents = pricing.getPlanPriceCents('lifetime');
        const trialMetadata = { ...metadata, lifetimeTrial: '1', amountCents: String(amountCents) };
        return stripe.checkout.sessions.create({
            ...common,
            mode: 'setup',
            currency: 'mxn',
            allowed_payment_method_types: ['card'],
            metadata: trialMetadata,
            setup_intent_data: {
                description: `BenjaApis - Prueba de Lifetime: ${BILLING_TRIAL_DAYS} días gratis y luego MX$${(amountCents / 100).toLocaleString('es-MX')} una sola vez`,
                metadata: trialMetadata,
            },
        }, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
    }

    // Un renglón por cosa comprada: el formulario muestra el desglose y la suma
    // da exactamente computeAmountCents, lo mismo que se guarda como monto.
    const lineItem = (name, cents) => ({ quantity: 1, price_data: { currency: 'mxn', unit_amount: cents, product_data: { name } } });
    const lineItems = [];
    if (planType) lineItems.push(lineItem(`Plan ${PLAN_LABELS[planType]}`, pricing.getPlanPriceCents(planType)));
    if (diceTier) lineItems.push(lineItem(`Dados ${diceTier.toUpperCase()}`, pricing.DICE_TIER_PRICES_CENTS[diceTier]));
    if (spotifyAddon) lineItems.push(lineItem('Complemento Spotify', pricing.getSpotifyAddonPriceCents()));
    const titleParts = [];
    if (planType) titleParts.push(PLAN_LABELS[planType]);
    if (diceTier) titleParts.push(diceTier.toUpperCase());
    if (spotifyAddon) titleParts.push('Complemento Spotify');
    return stripe.checkout.sessions.create({
        ...common,
        submit_type: 'auto',
        saved_payment_method_options: { payment_method_save: 'enabled' },
        mode: 'payment',
        line_items: lineItems,
        // Sin payment_method_types: los métodos salen de Configuración →
        // Métodos de pago del Dashboard (tarjeta, Google Pay, Apple Pay y
        // Link). Ojo: OXXO o SPEI, si se activan ahí, dejarían el pago
        // pendiente días (el webhook lo aplicaría al confirmarse).
        metadata,
        payment_intent_data: {
            description: `BenjaApis - ${titleParts.join(' + ')}`,
            // Sin receipt_email: el correo se escribe en el formulario de
            // Stripe, que manda el recibo si en el Dashboard está activo
            // "Enviar correo a los clientes por pagos correctos".
            metadata,
        },
    }, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
}

// Lo que se puede comprar en una sola sesión: Mensual y Anual son suscripciones,
// así que van solos (el complemento o los dados se compran aparte); la prueba
// de 14 días es solo para un plan, y solo para quien no tiene un plan pagado
// vigente (una licencia que ya paga no pasa a "prueba").
function checkoutItemsError(license, { planType, diceTier, spotifyAddon, trial }) {
    if (trial !== undefined && typeof trial !== 'boolean') return 'Prueba invalida';
    if (billing.SUBSCRIPTION_PLANS.includes(planType) && (diceTier || spotifyAddon)) {
        return 'El plan se compra solo; el complemento y los dados, aparte.';
    }
    if (trial) {
        if (!pricing.isValidPlan(planType) || diceTier || spotifyAddon) return 'La prueba gratis es solo para un plan.';
        const paidActive = license && ['month', 'annual', 'lifetime'].includes(license.license_type) && !license.revoked
            && (license.expires_at === null || Number(license.expires_at) > Date.now());
        if (paidActive) return 'Tu licencia ya tiene un plan activo: la prueba gratis es para empezar.';
    }
    return null;
}

// Lo que se responde cuando una sesión de suscripción o de prueba no se aplicó.
const BILLING_STATUS_ERRORS = {
    trial_used: 'Esta tarjeta ya se usó en una prueba gratis. No se hizo ningún cobro; puedes comprar el plan directamente.',
    invalid: 'Pago no encontrado',
};

app.post('/api/payments/stripe/checkout-session', auth.requireAuth, paymentLimiter, async (req, res) => {
    // Correo y nombre ya no llegan desde la página: los pide el propio
    // formulario de Stripe (sección Contacto y name_collection).
    const { planType, diceTier, spotifyAddon, trial, policyAcceptedAt } = req.body || {};
    const itemsError = purchaseItemsError(req.license, { planType, diceTier, spotifyAddon }) || checkoutItemsError(req.license, { planType, diceTier, spotifyAddon, trial });
    if (itemsError) {
        return res.status(400).json({ success: false, error: itemsError });
    }
    if (!validPolicyAcceptedAt(policyAcceptedAt)) {
        return res.status(400).json({ success: false, error: 'Debes aceptar la política de reembolsos para continuar' });
    }
    try {
        const session = await createPurchaseCheckoutSession({
            licenseId: req.license.id, license: req.license, planType, diceTier, spotifyAddon, trial: trial === true, policyAcceptedAt,
            returnUrl: `${FRONTEND_URL}/?payment=pending&stripe_checkout={CHECKOUT_SESSION_ID}`,
        });
        res.json({ success: true, clientSecret: session.client_secret, checkoutSessionId: session.id });
    } catch (err) {
        console.error('[Stripe] Error creando Checkout Session:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.' });
    }
});

const sha256Hex = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// Compra de un plan SIN cuenta (Membresía, con solo un alias), al momento o
// con prueba de 14 días. No se crea nada aquí: se reserva el id de la
// licencia, viaja en la metadata del pago junto con el alias, y la licencia
// nace solo cuando Stripe confirma el cobro o la tarjeta de la prueba (ver
// createPurchasedLicense y lib/stripeBilling.js). Solo planes: el complemento
// de Spotify y los dados se compran con una licencia ya existente.
//
// `claimToken` es lo único que le permite al navegador que pagó recoger la
// clave y entrar (ver /guest-confirm): Stripe guarda solo su hash.
app.post('/api/payments/stripe/guest-checkout-session', paymentLimiter, async (req, res) => {
    if (isBotSubmission(req.body)) return res.status(400).json({ success: false, error: 'No se pudo iniciar el pago.' });
    const { alias, planType, trial, policyAcceptedAt } = req.body || {};
    const cleanAlias = cleanLicenseAlias(alias);
    if (!cleanAlias) {
        return res.status(400).json({ success: false, error: 'Elige un alias válido: letras, números, "_" o "-".' });
    }
    if (!pricing.isValidPlan(planType)) {
        return res.status(400).json({ success: false, error: 'Plan invalido' });
    }
    const itemsError = checkoutItemsError(null, { planType, trial });
    if (itemsError) return res.status(400).json({ success: false, error: itemsError });
    if (!validPolicyAcceptedAt(policyAcceptedAt)) {
        return res.status(400).json({ success: false, error: 'Debes aceptar la política de reembolsos para continuar' });
    }
    const licenseId = crypto.randomUUID();
    const claimToken = crypto.randomBytes(24).toString('base64url');
    try {
        const session = await createPurchaseCheckoutSession({
            licenseId, planType, trial: trial === true, policyAcceptedAt,
            extraMetadata: { newLicenseAlias: cleanAlias, claimHash: sha256Hex(claimToken) },
            returnUrl: `${FRONTEND_URL}/membership?payment=pending&guest_checkout={CHECKOUT_SESSION_ID}`,
        });
        res.json({ success: true, clientSecret: session.client_secret, checkoutSessionId: session.id, claimToken });
    } catch (err) {
        console.error('[Stripe] Error creando Checkout Session sin cuenta:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.' });
    }
});

// Aplica una sesión de Checkout ya pedida a Stripe: pago único, suscripción o
// prueba de Lifetime. Devuelve 'approved', 'pending', 'trial_used' o 'invalid'.
async function fulfillCheckoutSession(session, { newLicenseAlias } = {}) {
    const fromBilling = await billing.fulfillBillingSession(session);
    if (fromBilling) return fromBilling.status;
    const meta = session.metadata || {};
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (session.mode !== 'payment' || session.payment_status !== 'paid' || !paymentIntentId) return 'pending';
    // El id del PaymentIntent, igual que el webhook: así /confirm y
    // payment_intent.succeeded se deduplican por el mismo UNIQUE.
    await applyApprovedStripePaymentIfNew({
        licenseId: meta.licenseId, planType: meta.planType || undefined, diceTier: meta.diceTier || undefined,
        spotifyAddon: meta.spotifyAddon === 'true', stripePaymentId: paymentIntentId, newLicenseAlias,
    });
    return 'approved';
}

// El navegador que pagó (o empezó una prueba) sin cuenta recoge aquí su
// licencia: se vuelve a pedir la sesión a Stripe (nunca se cree lo que diga
// el frontend), se comprueba el claimToken contra el hash de la metadata y, si
// el cobro o la tarjeta de la prueba están confirmados, se crea la licencia (o
// se usa la que ya creó el webhook) y se entrega la clave y una sesión. La
// clave se entrega mientras siga pendiente de mostrar; después, quien la perdió
// la recupera con el admin (panel de Licencias, "Ver clave").
app.post('/api/payments/stripe/guest-confirm', paymentStatusLimiter, async (req, res) => {
    const { checkoutSessionId, claimToken } = req.body || {};
    if (typeof checkoutSessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,200}$/.test(checkoutSessionId)
        || typeof claimToken !== 'string' || !claimToken || claimToken.length > 100) {
        return res.status(400).json({ success: false, error: 'Falta el id del pago' });
    }
    try {
        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {}, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
        const expected = Buffer.from(String(session.metadata?.claimHash || ''));
        const given = Buffer.from(sha256Hex(claimToken));
        const alias = session.metadata?.newLicenseAlias;
        const licenseId = session.metadata?.licenseId;
        if (!alias || !licenseId || expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
            return res.status(404).json({ success: false, error: 'Pago no encontrado' });
        }
        const status = await fulfillCheckoutSession(session, { newLicenseAlias: alias });
        if (BILLING_STATUS_ERRORS[status]) return res.status(409).json({ success: false, status, error: BILLING_STATUS_ERRORS[status] });
        if (status !== 'approved') return res.json({ success: true, status: 'pending' });
        const row = await db.findById(licenseId);
        // El webhook pudo ganarle y estar creándola en este momento.
        if (!row) return res.json({ success: true, status: 'pending' });
        if (!row.pending_key_reveal) {
            return res.status(409).json({ success: false, error: 'La clave de esta compra ya se entregó. Entra con ella en "¿Ya tienes una clave?" o escríbenos si la perdiste.' });
        }
        const sessionId = auth.generateSessionId();
        await db.setSession(row.id, sessionId);
        const token = auth.signSession(row, sessionId);
        res.json({ success: true, status: 'approved', key: row.pending_key_reveal, token, license: sessionLicense(row) });
    } catch (err) {
        console.error('[Stripe] Error confirmando una compra sin cuenta:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo confirmar el pago. Intenta de nuevo en un momento.' });
    }
});

// El frontend llama esto apenas el formulario confirma el pago (ver
// StripePaymentForm.jsx) -- nunca se aplica la compra por lo que diga el
// frontend: se vuelve a pedir la sesión a la propia API de Stripe y se
// verifica que su metadata.licenseId sea el de ESTA sesión de la app antes
// de aplicar nada (mismo criterio que el webhook). El
// webhook de más abajo es la red de respaldo si el navegador se cierra
// justo acá.
app.post('/api/payments/stripe/confirm', auth.requireAuth, paymentStatusLimiter, async (req, res) => {
    const { checkoutSessionId } = req.body || {};
    if (!checkoutSessionId || typeof checkoutSessionId !== 'string') {
        return res.status(400).json({ success: false, error: 'Falta el id del pago' });
    }
    try {
        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {}, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
        if (session.metadata?.licenseId !== req.license.id) {
            return res.status(404).json({ success: false, error: 'Pago no encontrado' });
        }
        const status = await fulfillCheckoutSession(session);
        if (BILLING_STATUS_ERRORS[status]) return res.status(409).json({ success: false, status, error: BILLING_STATUS_ERRORS[status] });
        res.json({ success: true, status: status === 'approved' ? 'approved' : 'pending' });
    } catch (err) {
        console.error('[Stripe] Error confirmando Checkout Session:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo confirmar el pago. Intenta de nuevo en un momento.' });
    }
});

// El portal de Stripe para gestionar la suscripción: cambiar la tarjeta,
// ver los recibos y cancelar (también durante la prueba, antes del primer
// cobro). Hay que guardar su configuración una vez en el Dashboard de Stripe
// (Configuración → Portal de clientes).
app.post('/api/billing/portal', auth.requireAuth, paymentLimiter, async (req, res) => {
    try {
        const stripe = getStripeClient();
        const customer = req.license.stripe_customer_id || await stripeCustomerForLicense(stripe, req.license.id);
        const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${FRONTEND_URL}/membership` }, { apiVersion: STRIPE_CHECKOUT_FORM_API_VERSION });
        res.json({ success: true, url: portal.url });
    } catch (err) {
        console.error('[Stripe] No se pudo abrir el portal de clientes:', err.message);
        res.status(502).json({ success: false, error: 'No se pudo abrir la gestión de tu suscripción. Intenta de nuevo en un momento.' });
    }
});

// Cancelar la prueba de Lifetime antes del cobro: no se cobra nada y la
// licencia termina el día que acababa la prueba.
app.post('/api/billing/cancel-lifetime-trial', auth.requireAuth, paymentLimiter, async (req, res) => {
    if (!req.license.lifetime_trial_charge_at) {
        return res.status(400).json({ success: false, error: 'No tienes una prueba de Lifetime pendiente de cobro.' });
    }
    await db.applyBillingState(req.license.id, { lifetimeTrialChargeAt: null, subscriptionStatus: 'canceled', subscriptionCancelAt: Number(req.license.expires_at) || Date.now() });
    console.log(`[Stripe] Prueba de Lifetime cancelada por el streamer (licencia ${req.license.id}).`);
    pushLicenseState(req.license.id);
    res.json({ success: true });
});

// El cobro del pago único al final de cada prueba de Lifetime (ver
// lib/stripeBilling.js). Cada 10 minutos; el primero, al minuto de arrancar.
const runLifetimeTrialCharges = () => {
    if (!process.env.STRIPE_SECRET_KEY) return;
    billing.chargeDueLifetimeTrials().catch((err) => console.error('[Stripe] Error cobrando pruebas de Lifetime:', err.message));
};
setTimeout(runLifetimeTrialCharges, 60 * 1000).unref();
setInterval(runLifetimeTrialCharges, 10 * 60 * 1000).unref();

// Notificación server-to-server de Stripe -- red de respaldo de /confirm
// de arriba (ej. el streamer cierra la pestaña justo después de pagar) y la
// única fuente de las renovaciones y cancelaciones de las suscripciones.
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

    // Se responde 200 apenas la firma es válida, porque
    // Stripe reintenta si no contesta rápido.
    res.sendStatus(200);

    try {
        const object = event.data.object;
        const stripe = getStripeClient();
        const apiVersion = STRIPE_CHECKOUT_FORM_API_VERSION;

        // Suscripciones: altas, renovaciones, pagos fallidos y cancelaciones.
        // Se vuelve a pedir la suscripción a Stripe (con la versión de la API
        // del código) en vez de usar el cuerpo del aviso.
        if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
            const sub = await stripe.subscriptions.retrieve(object.id, {}, { apiVersion });
            await billing.syncLicenseFromSubscription(sub);
            return;
        }
        if (event.type === 'invoice.paid') {
            const subId = billing.subscriptionId(object.subscription || object.parent?.subscription_details?.subscription);
            if (!subId) return;
            const sub = await stripe.subscriptions.retrieve(subId, {}, { apiVersion });
            const result = await billing.syncLicenseFromSubscription(sub);
            // El cobro queda en el historial de pagos (Sistema > Pagos, ingresos).
            if (result.synced && Number(object.amount_paid) > 0) {
                await db.insertStripePaymentIfNew({
                    id: crypto.randomUUID(), licenseId: result.licenseId, stripePaymentId: String(object.id),
                    planType: sub.metadata?.planType || null, diceTier: null, spotifyAddon: false,
                    amountCents: Number(object.amount_paid), status: 'approved', createdAt: Date.now(),
                });
            }
            return;
        }

        // Pagos únicos y sesiones de suscripción o de prueba. Se aceptan los
        // dos caminos de los pagos únicos para no depender de qué eventos se
        // marquen en el destino del webhook: checkout.session.completed (el que
        // el Dashboard recomienda; async_payment_succeeded es su versión para
        // métodos que se confirman después) y payment_intent.succeeded. Se
        // aplican con el id del PaymentIntent, así que si llegan ambos el
        // UNIQUE de stripe_payment_id deja uno solo.
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
            if (!object.metadata?.licenseId) return; // p. ej. sesiones viejas de la prueba de 7 días
            const session = await stripe.checkout.sessions.retrieve(object.id, {}, { apiVersion });
            await fulfillCheckoutSession(session, { newLicenseAlias: session.metadata?.newLicenseAlias || undefined });
            return;
        }
        if (event.type === 'payment_intent.succeeded') {
            const meta = object.metadata || {};
            // El cobro del final de la prueba de Lifetime ya se aplica al hacerse.
            if (!meta.licenseId || meta.lifetimeTrial === '1') return;
            await applyApprovedStripePaymentIfNew({
                licenseId: meta.licenseId, planType: meta.planType || undefined, diceTier: meta.diceTier || undefined,
                spotifyAddon: meta.spotifyAddon === 'true', stripePaymentId: object.id, newLicenseAlias: meta.newLicenseAlias || undefined,
            });
        }
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
    // Sin auth, así que nada de lo que llega se imprime tal cual: el contexto va
    // corto y sin saltos de línea (no se pueden falsificar líneas del registro)
    // y el detalle del error, acotado.
    const context = String(req.body?.context ?? '').replace(/[^\w .:/-]/g, '').slice(0, 60) || 'sin contexto';
    const detail = (JSON.stringify(req.body?.error ?? null) || 'null').slice(0, 2000);
    console.error(`[Stripe] Error de tarjeta reportado por el navegador (${context}):`, detail);
    res.sendStatus(204);
});

// ==========================================
// API: CARGAR Y ORDENAR REGALOS (requiere cualquier licencia válida)
// ==========================================
app.get('/api/setup/:username', auth.requireAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const username = req.params.username;
        const tenant = getOrCreateTenant(req.license.id, req.license.license_type);
        const connection = tenant.tiktokConnection;
        if (!tenant.liveConnected || tenant.currentTikTokUsername?.toLowerCase() !== username.toLowerCase()) {
            return res.status(409).json({ success: false, error: 'Conecta TikTok LIVE para cargar los regalos' });
        }
        // v1 a propósito acá — ver comentario del import de arriba.
        // Ninguna fuente trae todos los regalos, así que se juntan tres:
        //   1) la lista de ESTA sala (con room_id), la más fiel; puede fallar;
        //   2) la lista genérica de TikTok (lo de siempre);
        //   3) los regalos que ya llegaron en este directo y en cualquier otro
        //      (directorio global de regalos vistos, con su id e ícono).
        // Antes solo se usaba la 2) y se descartaban los que no traían imagen,
        // por eso faltaban regalos (nuevos, regionales o sin ícono).
        const roomId = connection?.roomId;
        let roomGifts = [];
        if (roomId) {
            try {
                roomGifts = await new WebcastPushConnectionV1(username, { clientParams: { room_id: String(roomId) } }).getAvailableGifts();
            } catch (err) {
                console.warn(`[${req.license.id}] Lista de regalos de la sala no disponible, se usa la genérica: ${err.message}`);
            }
        }
        const gifts = await new WebcastPushConnectionV1(username).getAvailableGifts().catch((err) => {
            if (roomGifts.length === 0) throw err;
            return [];
        });
        if (!tenant.liveConnected || tenant.tiktokConnection !== connection) {
            return res.status(409).json({ success: false });
        }
        // Más los que TikTok ya entregó en cualquier directo (ver giftDirectory).
        await giftDirectory.load();
        const validGifts = mergeGiftCatalogs(roomGifts, gifts, giftDirectory.list(), tenant.getSeenGifts());
        // Las alertas guardadas antes de que se guardara la imagen del regalo
        // la toman de este catálogo (ver backfillAlertGiftIcons).
        Promise.resolve().then(() => tenant.backfillAlertGiftIcons(validGifts)).catch(() => { /* no afecta la respuesta */ });
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
        const info = await downloader.getVideoInfo(url, { licenseId: req.license.id });
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
        // URL no válida -> 400; demasiadas descargas -> 429; el resto es un fallo nuestro.
        const status = err instanceof DownloadUrlError ? 400 : (err.status || 500);
        if (status >= 500) console.error('[Downloader] Error iniciando la descarga:', err.message);
        res.status(status).json({ success: false, error: status >= 500 ? 'No se pudo iniciar la descarga. Intenta de nuevo en un momento.' : err.message });
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
// DATOS LEGALES Y ANALÍTICA
// ==========================================
// Responsable que publican el Aviso Legal y el Aviso de Privacidad. Viven en
// variables de entorno (no en el código) para cambiarlos sin un deploy y para
// no publicar nada inventado: lo que falte, el frontend simplemente no lo
// muestra (y Sistema avisa que falta).
app.get('/api/legal-info', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
    res.json({
        success: true,
        name: clean(process.env.LEGAL_NAME, 120),
        email: clean(process.env.LEGAL_EMAIL, 120),
        location: clean(process.env.LEGAL_LOCATION, 160),
        updatedAt: clean(process.env.LEGAL_UPDATED_AT, 40) || '2026-10-03',
    });
});

// Una visita a una página del panel (ver lib/analytics.js). Siempre responde
// 204: el panel no espera nada de esto y un error no debe verse en ningún lado.
const analyticsLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.post('/api/analytics/pageview', analyticsLimiter, (req, res) => {
    res.sendStatus(204);
    if (analytics.optedOut(req.headers)) return;
    const pagePath = analytics.cleanPath(req.body?.path);
    if (!pagePath) return;
    const day = analytics.dayKey();
    db.recordPageview({
        day,
        path: pagePath,
        source: analytics.referrerSource(req.body?.referrer, req.headers.host),
        visitor: analytics.visitorHash({ ip: req.ip, userAgent: req.headers['user-agent'], day, secret: process.env.KEY_HASH_SECRET }),
    }).catch((err) => console.error('[Analítica] No se pudo guardar la visita:', err.message));
});

// Resumen para Sistema > Visitas: los últimos `days` días (máximo 90).
app.get('/api/admin/analytics', auth.requireAuth, auth.requireAdmin, adminLimiter, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
        const since = analytics.dayKey(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, since, days, ...(await db.analyticsSummary(since)) });
    } catch (err) {
        console.error('[Analítica] No se pudo armar el resumen:', err.message);
        res.status(500).json({ success: false, error: 'No se pudo cargar la analítica' });
    }
});
// Se guarda lo de los últimos 90 días; lo anterior se borra una vez al día.
setInterval(() => {
    db.pruneAnalytics(analytics.dayKey(Date.now() - 91 * 24 * 60 * 60 * 1000)).catch(() => {});
}, 24 * 60 * 60 * 1000).unref();

// ==========================================
// SISTEMA: salud, reportes de errores, historial del admin, almacenamiento y
// conciliación de pagos (ver routes/system.js)
// ==========================================
const healthChecker = createHealthChecker({ ping: () => db.ping() });
registerSystemRoutes(app, {
    auth, db, storage, io, tenants, errorReporter, healthChecker, getStripeClient,
    applyPaymentWithRetry, applyApprovedStripePaymentIfNew, audit, bootId: BOOT_ID, downloader,
});

// ==========================================
// SOCKET.IO: autenticación en el handshake + aislamiento por room
// ==========================================
// Freno a las conexiones nuevas por IP: cada intento, aunque traiga una clave
// falsa, cuesta una consulta a la base de datos (ver lib/handshakeLimiter.js).
const handshakeLimiter = createHandshakeLimiter({ max: Number(process.env.SOCKET_HANDSHAKES_PER_MINUTE) || 300 });
setInterval(() => handshakeLimiter.sweep(), 60 * 1000).unref();
io.engine.use((req, res, next) => {
    if (!isNewSession(req) || handshakeLimiter.allow(clientIp(req))) return next();
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
    res.end('Demasiadas conexiones desde esta dirección. Espera un minuto.');
});
io.use(auth.socketAuthMiddleware);

// Saca de memoria los tenants que nadie usa hace rato (ver
// Tenant.isEvictable) -- antes cada licencia que se conectaba alguna vez se
// quedaba en el proceso para siempre.
const TENANT_IDLE_EVICT_MS = 30 * 60 * 1000;
const TENANT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
    for (const [licenseId, tenant] of tenants) {
        const hasSockets = (io.sockets.adapter.rooms.get(licenseId)?.size || 0) > 0;
        if (!tenant.isEvictable(hasSockets, TENANT_IDLE_EVICT_MS)) continue;
        try { tenant.dispose(); } catch (err) { console.error(`[${licenseId}] Error liberando tenant inactivo:`, err.message); }
        tenants.delete(licenseId);
        console.log(`[${licenseId}] Tenant inactivo liberado de memoria (${tenants.size} restantes).`);
    }
}, TENANT_SWEEP_INTERVAL_MS).unref();

io.on('connection', (socket) => {
    // Cada panel recuerda este id: si al reconectarse trae otro distinto, el
    // servidor se reinició y lo activo se perdió (ver App.jsx).
    socket.emit('server_boot', { bootId: BOOT_ID });
    socket.join(socket.licenseId);
    const tenant = getOrCreateTenant(socket.licenseId, socket.licenseType);
    // El Tenant pudo crearse con otro tipo de licencia (sigue en memoria
    // hasta 30 min sin pantallas): el que vale es el de esta conexión.
    tenant.licenseType = socket.licenseType;
    tenant.attachSocket(socket);
    // Un panel que se conecta (o reconecta) recibe su licencia al día: cubre
    // un cambio hecho mientras estaba cerrado o desconectado.
    if (socket.authMethod === 'jwt') {
        db.findCoreById(socket.licenseId)
            .then((row) => { if (row) socket.emit('license_updated', sessionLicense(row)); })
            .catch(() => { /* sin la base, el panel sigue con lo que tenía */ });
    }
});

// Solo existe backend/public/index.html cuando el frontend se buildeó y
// copió ahí (modo "todo junto", ver scripts/copy-frontend-build.js). Si el
// frontend se despliega aparte (p. ej. Vercel), esa carpeta no existe acá
// y no hay nada que servir — devolver un 404 simple en vez de intentar un
// sendFile que rompe con ENOENT.
const FRONTEND_INDEX = path.join(__dirname, 'public', 'index.html');
app.use((req, res) => {
    // Una ruta de la API que no existe es un 404 en JSON, nunca la página.
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
        return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    if (fs.existsSync(FRONTEND_INDEX)) {
        // Página personalizada de 404 (la arma el frontend) CON el código 404
        // de verdad: así los buscadores no indexan rutas inventadas como si
        // fueran páginas del sitio. Los overlays (?overlay=true) van por la
        // raíz y no pasan por aquí.
        if (!isKnownPage(req.path)) res.status(404);
        // `dotfiles: 'allow'`: la ruta es fija (no viene del usuario); sin esto
        // send() se niega a servirla si el proyecto vive dentro de una carpeta
        // que empieza con punto (p. ej. una copia de trabajo en .claude/).
        return res.sendFile(FRONTEND_INDEX, { dotfiles: 'allow' });
    }
    res.status(404).json({ success: false, error: 'No encontrado. Este backend solo expone la API; el frontend se sirve por separado.' });
});

// Red de seguridad final: cualquier error que se escape de una ruta, o de un
// lector de la petición (JSON mal formado, archivo demasiado grande), termina
// aquí. Sin esto Express responde con una página HTML —y, si NODE_ENV no es
// "production", con la traza completa del error— en vez del JSON que espera el
// frontend.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ success: false, error: tooBig ? 'El archivo pesa más de 15 MB.' : 'No se pudo leer el archivo enviado.' });
    }
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status >= 500) {
        console.error(`[Error] ${req.method} ${req.path}:`, err?.stack || err);
        reportBackendError('http', err, `${req.method} ${req.path}`);
    }
    const message = status >= 500 ? 'Error interno del servidor' : status === 413 ? 'La solicitud es demasiado grande' : 'Solicitud inválida';
    res.status(status).json({ success: false, error: message });
});

// Fire-and-forget (mismo criterio que otros catch silenciosos de arranque
// en este archivo): si Supabase esta caido justo al arrancar, el proceso
// sigue con los precios default de PLAN_PRICES_CENTS en vez de no levantar
// -- el admin puede volver a guardar el precio despues para reintentar.
pricing.loadPriceOverrides().catch(err => console.error('[PRICING] No se pudieron cargar los overrides de precio al arrancar:', err.message));

// Mantenimiento de los historiales: reportes de errores (30 días, 500 filas) y
// acciones del admin (1 año, 5000 filas).
async function pruneHistories() {
    const day = 24 * 60 * 60 * 1000;
    try {
        await db.pruneErrorReports({ olderThan: Date.now() - 30 * day, maxRows: 500 });
        await db.pruneAuditLog({ olderThan: Date.now() - 365 * day, maxRows: 5000 });
    } catch (err) {
        console.error('[Mantenimiento] No se pudieron depurar los historiales:', err.message);
    }
}
setTimeout(pruneHistories, 60 * 1000).unref();
setInterval(pruneHistories, 6 * 60 * 60 * 1000).unref();

// Render manda SIGTERM antes de reemplazar el proceso en un deploy: se guarda
// YA el estado en vivo de cada tenant (juegos, rankings, Objetivo) para que el
// proceso nuevo lo restaure sin perder los últimos segundos (ver
// lib/tenant/runtimeState.js). Con un tope de 4 s para no trabar el cierre.
let shuttingDown = false;
async function flushAndExit(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${signal}] Guardando el estado de ${tenants.size} tenant(s) antes de cerrar...`);
    const flush = Promise.all([...tenants.values()].map((t) => Promise.all([
        t.persistRuntimeState(true).catch(() => {}),
        t.goalPersistTimer ? t.persistGoalProgress() : Promise.resolve(),
    ])));
    await Promise.race([flush, new Promise((resolve) => setTimeout(resolve, 4000))]);
    process.exit(0);
}
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('SIGINT', () => flushAndExit('SIGINT'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 BACKEND READY ON PORT ${PORT}\n`);
});
