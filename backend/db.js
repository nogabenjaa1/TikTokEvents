// ==========================================
// PERSISTENCIA DE LICENCIAS (Postgres / Supabase)
// Pool de conexión + API async. Este módulo solo sabe de guardar/leer
// filas: la generación de keys, el hashing y los JWT viven en auth.js.
//
// Antes esto era SQLite (better-sqlite3, un solo archivo local). Se migró
// a Supabase para que los datos sobrevivan a redeploys/reinicios del
// backend sin importar dónde corra (Railway, Render, Fly, un VPS, etc.).
// Los datos de la base SQLite anterior ya se pasaron; no queda ningún rastro
// de SQLite en el código.
// ==========================================
const { Pool, types } = require('pg');
const tokenCrypto = require('./tokenCrypto');

// BIGINT (OID 20) viene como STRING por defecto en node-postgres — es una
// protección genérica del driver contra enteros que no entran en un
// Number sin perder precisión. Acá todas las columnas BIGINT son
// timestamps epoch en ms (created_at, expires_at, last_login_at,
// last_active_at), muy por debajo de Number.MAX_SAFE_INTEGER, así que
// convertirlas a número es seguro. Sin esto, `new Date(row.expires_at)` en
// el frontend daba "Invalid Date": un string numérico como "1788219753914"
// se interpreta como una fecha con formato inválido, no como epoch — a
// diferencia de comparaciones como `<=` que sí coercionan el string a
// número solas y por eso el bug pasó desapercibido en otros lados.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Falta DATABASE_URL en las variables de entorno (backend/.env) — connection string de Postgres de Supabase');
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});

// Se ejecuta una sola vez al cargar el módulo; toda función exportada espera
// esta promesa antes de tocar la tabla, así no hace falta un init() aparte
// que cada caller tenga que acordarse de llamar.
// Cada función exportada espera esta promesa antes de tocar la tabla (ver
// más abajo); el .catch() de acá abajo es solo para que un fallo al
// arrancar (Supabase caído, DATABASE_URL mal) no tumbe el proceso entero
// por un unhandled rejection — cada caller sigue viendo el error propio
// cuando le toque hacer `await ready`.
const ready = pool.query(`
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
    roulette_starts INTEGER NOT NULL DEFAULT 0,
    last_active_at BIGINT,
    session_id TEXT,
    multi_device BOOLEAN NOT NULL DEFAULT FALSE
  )
`)
  // Migraciones aditivas: CREATE TABLE IF NOT EXISTS no toca una tabla que
  // ya existe (la de producción, hoy), así que las columnas nuevas se
  // agregan acá — Postgres soporta ADD COLUMN IF NOT EXISTS nativo, sin
  // necesitar el chequeo manual que hacía la versión vieja en SQLite.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS trial_alias TEXT`))
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS trial_connected_username TEXT`))
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS roulette_starts INTEGER NOT NULL DEFAULT 0`))
  // dice_tier: nivel de Color Says (regular/pro/vip/admin) — a propósito
  // SEPARADO de is_admin. is_admin sigue siendo exclusivamente "administra
  // la plataforma" (panel de Licencias, endpoints /api/licenses); dice_tier
  // 'admin' es un nivel MÁS que se le puede vender a cualquier licencia
  // paga (el panel de Modo Seguro de Color Says), sin darle ningún permiso
  // real de administración. Mezclar los dos sería un agujero de seguridad
  // real: cualquiera que comprara el nivel más caro terminaría pudiendo
  // crear/revocar licencias de otros.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS dice_tier TEXT NOT NULL DEFAULT 'regular'`))
  // Backfill de una sola vez: el dueño real de la plataforma (is_admin ya
  // true de antes) mantiene su nivel 'admin' en Color Says sin tener que
  // tocarlo a mano. El guard `AND dice_tier = 'regular'` lo hace
  // idempotente — no pisa un valor ya cambiado a mano en un reinicio futuro.
  .then(() => pool.query(`UPDATE licenses SET dice_tier = 'admin' WHERE is_admin = TRUE AND dice_tier = 'regular'`))
  // Al comprar un plan pago, la key se rota (ver /api/payments/webhook) para
  // que siga el formato legible alias-TIER-hash — pero el webhook no tiene
  // forma de mandarle la key nueva al navegador (es una notificación
  // servidor-a-servidor, sin respuesta HTTP hacia el streamer). Se guarda
  // acá temporalmente en texto plano (única excepción a "solo se guarda
  // hasheada": esta SÍ tiene que poder mostrarse una vez) y /api/auth/verify
  // la devuelve y la borra la primera vez que el frontend vuelve a
  // preguntar — de ahí "reveal" en el nombre, es de un solo uso.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS pending_key_reveal TEXT`))
  // El WIN BONUS de Color Says dejó de ser algo que un dice_tier pago
  // otorga automáticamente (pedido explícito: la dinámica debe ser
  // transparente por default para streamers y espectadores). Ahora es una
  // excepción manual: un admin la prende para UNA licencia puntual desde el
  // panel de Licencias (ver /api/licenses/:id/win-bonus), sin importar su
  // dice_tier. Admin (dice_tier='admin') sigue teniendo el bonus siempre,
  // resuelto en el frontend, no acá.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS dice_win_bonus_unlocked BOOLEAN NOT NULL DEFAULT FALSE`))
  // Ajustes que antes solo vivían en memoria del Tenant (se perdían en cada
  // reinicio del server) y/o en el localStorage de un único navegador —
  // pedido explícito: que el streamer entre desde otro navegador/
  // computadora con solo su clave y todo quede tal cual lo dejó, sin tener
  // que reconfigurar nada. JSONB nullable: NULL significa "nunca lo tocó",
  // y el Tenant se queda con sus valores de fábrica (ver
  // loadPersistedSettings en tenant.js) — nunca se escribe nada acá hasta
  // que el streamer cambia algo por primera vez.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS theme_settings JSONB`))
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS overlay_customization JSONB`))
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS spotify_settings JSONB`))
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS tts_settings JSONB`))
  // Sonido opcional al completar el Objetivo (pedido explícito) --
  // { audioUrl, audioPath }, mismo criterio que spotify_settings/
  // tts_settings: sobrevive a un reinicio del server y a entrar desde otro
  // dispositivo. El progreso/meta del objetivo NO va acá sino en
  // goal_progress (más abajo) -- esta columna es solo la configuración
  // persistente del sonido.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS goal_settings JSONB`))
  // El catálogo se consulta de nuevo con cada LIVE. Retira únicamente la
  // caché antigua; los regalos asignados a alertas y juegos viven aparte.
  .then(() => pool.query(`ALTER TABLE licenses DROP COLUMN IF EXISTS gift_catalog`))
  // Progreso del Objetivo (meta de monedas/seguidores) -- a diferencia del
  // resto de los "juegos", este acumula durante horas y perderlo por un
  // reinicio del servidor (deploy, caída) es de lo más molesto: se guarda
  // acá y se restaura al volver.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS goal_progress JSONB`))
  // Foto del estado en vivo (juegos activos, Extensible, rankings, cola de
  // Spotify) para restaurarlo tras un reinicio del servidor -- ver
  // lib/tenant/runtimeState.js.
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS runtime_state JSONB`))
  .then(() => pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_mp_payment
    ON licenses(mp_payment_id) WHERE mp_payment_id IS NOT NULL
  `)).then(() => pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_trial_connected
    ON licenses(LOWER(trial_connected_username)) WHERE trial_connected_username IS NOT NULL
  `))
  // La prueba gratis por tarjeta ahora se verifica con Stripe (SetupIntent,
  // ver /api/free-trial/setup-intent en server.js) en vez de MercadoPago --
  // a diferencia del chequeo viejo (solo Luhn + token activo, sin comparar
  // contra pruebas anteriores), Stripe expone un fingerprint estable de la
  // tarjeta real (PaymentMethod.card.fingerprint) que SÍ permite bloquear
  // que la misma tarjeta reclame una segunda prueba gratis -- pedido
  // implícito de "mejor validación" además del cambio de proveedor. UNIQUE
  // parcial (no NOT NULL: la vía de "ver anuncios" nunca pasa tarjeta).
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS trial_card_fingerprint TEXT`))
  .then(() => pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_trial_card_fingerprint
    ON licenses(trial_card_fingerprint) WHERE trial_card_fingerprint IS NOT NULL
  `))
  // Historial de pagos de MercadoPago — separado de licenses.mp_payment_id
  // (que solo guarda el último pago) porque el webhook necesita poder
  // distinguir "ya procesé esta notificación" de "es la primera vez que la
  // veo" sin perder el rastro de compras anteriores. El UNIQUE sobre
  // mp_payment_id es lo que hace el webhook idempotente ante los reintentos
  // de notificación de MercadoPago (ver applyPaymentOnce más abajo).
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      mp_payment_id TEXT UNIQUE NOT NULL,
      plan_type TEXT,
      dice_tier TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `))
  // El historial de pagos NO debe impedir eliminar una licencia (antes la FK
  // hacía fallar el borrado de cualquier licencia que hubiera pagado) ni
  // desaparecer con ella (son los ingresos): se quita la FK y el pago conserva
  // su license_id como dato.
  .then(() => pool.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_license_id_fkey`))
  // Segunda forma de pago (Stripe, seleccionable junto a MercadoPago desde
  // Membership.jsx): mp_payment_id ya no puede ser NOT NULL porque un pago
  // de Stripe no tiene uno -- stripe_payment_id es su columna paralela,
  // con el mismo rol de idempotencia (UNIQUE) que mp_payment_id tiene para
  // MP (ver insertStripePaymentIfNew más abajo). `provider` es solo
  // informativo, para poder distinguir el historial de pagos de un
  // vistazo sin tener que fijarse cuál de las dos columnas de id quedó
  // llena; las filas ya existentes (todas de MP) quedan con el default.
  .then(() => pool.query(`ALTER TABLE payments ALTER COLUMN mp_payment_id DROP NOT NULL`))
  .then(() => pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT`))
  .then(() => pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'mercadopago'`))
  .then(() => pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_payment
    ON payments(stripe_payment_id) WHERE stripe_payment_id IS NOT NULL
  `))
  // Una cuenta de Spotify por licencia (multi-tenant, como TikTok): cada
  // streamer conecta LA SUYA por OAuth (ver /api/spotify/connect en
  // server.js) para que el comando !play del chat agregue canciones a SU
  // cola. access_token se refresca solo (ver spotify.getValidAccessToken)
  // y se persiste acá junto con el nuevo expires_at; refresh_token no
  // vence salvo que el streamer revoque el acceso desde Spotify.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS spotify_accounts (
      license_id TEXT PRIMARY KEY REFERENCES licenses(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      spotify_user_id TEXT,
      display_name TEXT,
      connected_at BIGINT NOT NULL
    )
  `))
  // App de Spotify PROPIA de una licencia (ver spotify.js, "Quién puede
  // usarlo"): las licencias sin cupo en la app de la plataforma crean la suya
  // en developer.spotify.com y pegan aquí su client id/secret. El secreto se
  // guarda cifrado (tokenCrypto), igual que los tokens. Sin fila = usa la app
  // de la plataforma. Los tokens de spotify_accounts solo sirven con la app
  // que los emitió, por eso guardar o quitar una app borra la cuenta
  // conectada (ver upsertSpotifyApp/deleteSpotifyApp).
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS spotify_apps (
      license_id TEXT PRIMARY KEY REFERENCES licenses(id),
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `))
  // Cuándo pasó la licencia a Lifetime: reparte los cupos de la app de la
  // plataforma a "los primeros en conseguirlo" (ver
  // getSharedSpotifySlotHolders). Las que ya eran Lifetime antes de esta
  // columna no guardaban el dato: se usa su fecha de creación, lo más
  // cercano que hay (guard `IS NULL`: idempotente, no pisa un valor real).
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS lifetime_at BIGINT`))
  .then(() => pool.query(`UPDATE licenses SET lifetime_at = created_at WHERE license_type = 'lifetime' AND lifetime_at IS NULL`))
  // Complemento de Spotify (pago único, para el plan Mensual): una vez TRUE
  // se queda aunque la licencia se renueve. `payments.spotify_addon` deja
  // constancia de que ese pago lo incluía (el monto ya lo suma).
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS spotify_addon BOOLEAN NOT NULL DEFAULT FALSE`))
  .then(() => pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS spotify_addon BOOLEAN NOT NULL DEFAULT FALSE`))
  // Alertas de regalos: qué recurso (imagen/gif/video/audio, ver storage.js)
  // se reproduce en el overlay al llegar un regalo puntual. Un solo alert
  // por (licencia, regalo) — UNIQUE habilita el upsert desde el panel sin
  // tener que buscar primero si ya existía uno para ese regalo.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS alert_configs (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      gift_name TEXT NOT NULL,
      media_url TEXT NOT NULL,
      media_path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 5000,
      position TEXT NOT NULL DEFAULT 'center',
      created_at BIGINT NOT NULL,
      UNIQUE(license_id, gift_name)
    )
  `))
  // Animación de entrada/salida de la alerta (ver ANIMATION_PRESETS en
  // AlertsAdmin.jsx/Overlay.jsx) — 'fade' de default porque es la que
  // menos desentona si una alerta vieja (guardada antes de que existiera
  // este campo) nunca lo configuró.
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS entrance_anim TEXT NOT NULL DEFAULT 'fade'`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS exit_anim TEXT NOT NULL DEFAULT 'fade'`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'gift'`))
  // Pedido explicito: visual (imagen/gif/video, con mute opcional en video)
  // y audio son DOS recursos independientes y opcionales -- antes
  // media_url/media_path/media_type era UNO solo obligatorio. Se agregan
  // columnas nuevas en vez de reusar las viejas (que se dejan de escribir
  // pero no se borran, mismo criterio que otras migraciones de esta
  // tabla) y se relajan a NULLABLE porque una fila nueva puede no tener
  // ningun archivo viejo-estilo. `text`/`text_position` son el mensaje
  // opcional (arriba/abajo/al lado del recurso visual, o solo texto si no
  // hay visual) -- el ESTILO del texto (color/degradado/tamaño) NO vive
  // por alerta: reusa la personalizacion global del overlay 'alerts' (ver
  // overlayCustomization.js), igual que el resto de los overlays.
  .then(() => pool.query(`ALTER TABLE alert_configs ALTER COLUMN media_url DROP NOT NULL`))
  .then(() => pool.query(`ALTER TABLE alert_configs ALTER COLUMN media_path DROP NOT NULL`))
  .then(() => pool.query(`ALTER TABLE alert_configs ALTER COLUMN media_type DROP NOT NULL`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS visual_url TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS visual_path TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS visual_type TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS visual_muted BOOLEAN NOT NULL DEFAULT FALSE`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS audio_url TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS audio_path TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS alert_text TEXT`))
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS text_position TEXT NOT NULL DEFAULT 'below'`))
  // Color de texto propio de CADA alerta (#RRGGBB). NULL = sigue el estilo
  // general de las alertas ("Estilo y volumen" en el panel).
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS text_color TEXT`))
  // Id del regalo de TikTok (estable entre las dos librerías, a diferencia del
  // nombre, que a veces no coincide entre el catálogo y el evento en vivo).
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS gift_id TEXT`))
  // Regalos que TikTok ha entregado en algún directo, con su id, nombre, monedas
  // e ícono (ver lib/giftDirectoryCore.js). Global, no por licencia.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS seen_gifts (
      gift_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      icon TEXT NOT NULL DEFAULT '',
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL
    )
  `))
  // Stickers del club de fans que han llegado en el chat de CADA licencia, con su id
  // e imagen (ver lib/stickerDirectoryCore.js): son los que se pueden elegir al armar
  // una alerta de sticker. Por licencia (los stickers son de cada creador) y no
  // global como seen_gifts. emote_id va como texto: los ids de TikTok son números de
  // 19 cifras.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS seen_stickers (
      license_id TEXT NOT NULL REFERENCES licenses(id),
      emote_id TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      PRIMARY KEY (license_id, emote_id)
    )
  `))
  // Alertas GENERALES (pedido explícito: "alertas globales" además de las
  // específicas de siempre) -- trigger_type = 'gift_global', sin regalo
  // fijo: se disparan con CUALQUIER regalo que no tenga su propia alerta
  // específica y cuyo valor en monedas alcance este mínimo (ver
  // findGlobalAlertForCoins en tenant.js). NULL para toda fila que no sea
  // de este tipo. `gift_name` sigue guardando la clave única de la fila
  // (acá, `global:<minCoins>`, ver server.js) -- eso es lo que habilita
  // reusar el mismo UNIQUE(license_id, gift_name) para no permitir dos
  // alertas generales con el mismo mínimo, mismo criterio que ya evita dos
  // alertas para el mismo regalo.
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS min_coins INTEGER`))
  // Nombre corto para mostrar en la tira de regalos con alerta (overlay
  // 'ticker'): por defecto el nombre del archivo de audio subido (o del
  // visual si no hay audio), pero editable -- ver POST /api/alerts. NULL en
  // una fila vieja (el nombre original del archivo nunca se guardó antes de
  // esto): serializeAlert la completa con el nombre del regalo al servir.
  .then(() => pool.query(`ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS apodo TEXT`))
  // Backfill de una sola vez: una alerta vieja (guardada antes de que
  // existieran visual_*/audio_*) tenia su unico archivo en media_type/
  // media_url/media_path -- 'audio' va a audio_*, cualquier otro tipo
  // (image/gif/video) va a visual_*. Solo toca filas que todavia no
  // tengan nada en las columnas nuevas, asi que correr esto de nuevo en
  // cada arranque es un no-op para las que ya migraron.
  .then(() => pool.query(`
      UPDATE alert_configs SET audio_url = media_url, audio_path = media_path
      WHERE media_type = 'audio' AND audio_url IS NULL AND media_url IS NOT NULL
  `))
  .then(() => pool.query(`
      UPDATE alert_configs SET visual_url = media_url, visual_path = media_path, visual_type = media_type
      WHERE media_type IS NOT NULL AND media_type != 'audio' AND visual_url IS NULL AND media_url IS NOT NULL
  `))
  // Precios editables desde el panel de Licencias (pedido explicito:
  // "Modificacion manual de precios de licencias desde el panel de
  // administracion") -- una fila por plan que el admin haya tocado; un plan
  // SIN fila aca sigue usando el default de PLAN_PRICES_CENTS en
  // backend/pricing.js. amount_cents en vez de un decimal en pesos por el
  // mismo criterio que `payments.amount_cents`: nunca representar dinero en
  // coma flotante.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_overrides (
      plan_type TEXT PRIMARY KEY,
      amount_cents INTEGER NOT NULL,
      updated_at BIGINT NOT NULL,
      updated_by TEXT NOT NULL
    )
  `))
  // Auditoria de cada cambio de precio (pedido explicito, seccion "Historial
  // de cambios"): a diferencia de pricing_overrides (que solo guarda el
  // valor VIGENTE de cada plan), esta tabla nunca se pisa -- cada fila es un
  // cambio puntual, para poder ver quien bajo el precio a $1 y cuando.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_history (
      id TEXT PRIMARY KEY,
      plan_type TEXT NOT NULL,
      old_amount_cents INTEGER,
      new_amount_cents INTEGER NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at BIGINT NOT NULL
    )
  `))
  // Reportes de errores (ver lib/errorReports.js): una fila por "huella", con un
  // contador de cuántas veces ocurrió, en vez de una fila por ocurrencia.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS error_reports (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      context TEXT,
      user_agent TEXT,
      license_id TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL
    )
  `))
  .then(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_error_reports_last_seen ON error_reports(last_seen)`))
  // Historial de lo que hace el admin (crear, editar, extender, revocar y eliminar
  // licencias, cambios de precio, limpiezas...). Nunca guarda claves.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      at BIGINT NOT NULL,
      admin_username TEXT NOT NULL,
      admin_license_id TEXT,
      action TEXT NOT NULL,
      target_license_id TEXT,
      target_label TEXT,
      details TEXT
    )
  `))
  .then(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at)`))
  // Pagos que se cobraron y no se pudieron aplicar a la licencia: antes solo
  // quedaba una línea en el registro del servidor. Una fila por pago.
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS payment_failures (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL,
      license_id TEXT,
      plan_type TEXT,
      dice_tier TEXT,
      spotify_addon BOOLEAN NOT NULL DEFAULT FALSE,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      error TEXT,
      created_at BIGINT NOT NULL,
      resolved_at BIGINT,
      resolved_by TEXT,
      UNIQUE (provider, provider_payment_id)
    )
  `))
  // Cada vez que el streamer renueva sus enlaces de overlay se suma uno: el token
  // del overlay lo incluye y los anteriores dejan de servir (ver auth.overlayTokenFor).
  .then(() => pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS overlay_epoch INTEGER NOT NULL DEFAULT 0`));
ready.catch(err => console.error('[DB] No se pudo inicializar el schema de licencias en Supabase:', err.message));

async function insertLicense({ id, keyHash, keyPrefix, username, licenseType, isAdmin, createdAt, expiresAt, mpPaymentId = null, trialAlias = null, diceTier = 'regular', trialCardFingerprint = null, spotifyAddon = false }) {
    await ready;
    await pool.query(`
        INSERT INTO licenses (id, key_hash, key_prefix, username, license_type, is_admin, revoked, created_at, expires_at, last_login_at, mp_payment_id, trial_alias, dice_tier, trial_card_fingerprint, lifetime_at, spotify_addon)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, NULL, $9, $10, $11, $12, $13, $14)
    `, [id, keyHash, keyPrefix, username, licenseType, !!isAdmin, createdAt, expiresAt, mpPaymentId, trialAlias, diceTier, trialCardFingerprint, licenseType === 'lifetime' ? createdAt : null, !!spotifyAddon]);
    return findById(id);
}

// Cambia la clave de una licencia existente (panel de Licencias, "Regenerar
// clave"): la vieja deja de servir al instante — también para los overlays de
// OBS, que se autentican con la key cruda — y se cierran las sesiones abiertas
// (session_id NULL) y cualquier key pendiente de mostrar. No toca nada más:
// el id, el plan y los ajustes siguen igual.
async function setLicenseKey(id, { keyHash, keyPrefix }) {
    await ready;
    await pool.query('UPDATE licenses SET key_hash = $1, key_prefix = $2, session_id = NULL, pending_key_reveal = NULL WHERE id = $3', [keyHash, keyPrefix, id]);
    return findById(id);
}

// lifetime_at al cambiar el plan de una licencia existente (ver el comentario
// de la columna, arriba): si pasa A Lifetime desde otro tipo, es ahora; si ya
// era Lifetime, conserva su fecha (COALESCE cubre filas sin dato); si deja de
// serlo, se limpia. Dentro de un UPDATE, `license_type` es el valor ANTERIOR,
// por eso alcanza para distinguir "pasa a" de "ya era". Los parámetros llevan
// cast explícito porque Postgres no infiere su tipo dentro de un CASE.
function lifetimeAtSql(typeParam, nowParam) {
    return `CASE
        WHEN ${typeParam}::text <> 'lifetime' THEN NULL
        WHEN license_type = 'lifetime' THEN COALESCE(lifetime_at, ${nowParam}::bigint)
        ELSE ${nowParam}::bigint
    END`;
}

async function findByKeyHash(keyHash) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses WHERE key_hash = $1', [keyHash]);
    return rows[0];
}

async function findById(id) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses WHERE id = $1', [id]);
    return rows[0];
}

async function listAll() {
    await ready;
    const { rows } = await pool.query('SELECT * FROM licenses ORDER BY created_at DESC');
    return rows;
}

async function revoke(id) {
    await ready;
    await pool.query('UPDATE licenses SET revoked = TRUE WHERE id = $1', [id]);
    return findById(id);
}

async function touchLastLogin(id) {
    await ready;
    await pool.query('UPDATE licenses SET last_login_at = $1 WHERE id = $2', [Date.now(), id]);
}

// Un solo dispositivo activo por licencia: cada login pisa el session_id
// anterior, así que el JWT de la sesión vieja deja de validar (ver
// auth.resolveFromToken). Cambiar de dispositivo funciona siempre; usar
// dos a la vez, no.
async function setSession(id, sessionId) {
    await ready;
    await pool.query('UPDATE licenses SET session_id = $1 WHERE id = $2', [sessionId, id]);
}

// Licencias "todopoderosas" (pensada para el owner, no para vender): se
// saltan por completo la restricción de un solo dispositivo — ver
// auth.checkTokenStatus y el login en server.js.
async function setMultiDevice(id, enabled) {
    await ready;
    await pool.query('UPDATE licenses SET multi_device = $1 WHERE id = $2', [!!enabled, id]);
    return findById(id);
}

// Excepción manual del WIN BONUS de Color Says para una licencia puntual —
// ver comentario de la migración de dice_win_bonus_unlocked más arriba.
// Solo el nivel de Color Says, sin tocar el plan ni el vencimiento (el
// formulario de edición del admin puede cambiar el nivel sin renovar).
async function setDiceTier(id, diceTier) {
    await ready;
    await pool.query('UPDATE licenses SET dice_tier = $1 WHERE id = $2', [diceTier, id]);
    return findById(id);
}

async function setWinBonusUnlocked(id, enabled) {
    await ready;
    await pool.query('UPDATE licenses SET dice_win_bonus_unlocked = $1 WHERE id = $2', [!!enabled, id]);
    return findById(id);
}

// Ajustes que el Tenant guarda cada vez que el streamer cambia algo (ver
// tenant.js) y carga al crearse -- ver el comentario de las columnas JSONB
// en la migración de arriba. No devuelven la licencia entera (a diferencia
// de setMultiDevice/setWinBonusUnlocked): el caller es siempre un handler
// de socket fire-and-forget que no necesita la fila de vuelta.
async function setThemeSettings(id, theme) {
    await ready;
    await pool.query('UPDATE licenses SET theme_settings = $1 WHERE id = $2', [JSON.stringify(theme), id]);
}

async function setOverlayCustomization(id, map) {
    await ready;
    await pool.query('UPDATE licenses SET overlay_customization = $1 WHERE id = $2', [JSON.stringify(map), id]);
}

async function setSpotifySettings(id, settings) {
    await ready;
    await pool.query('UPDATE licenses SET spotify_settings = $1 WHERE id = $2', [JSON.stringify(settings), id]);
}

async function setTtsSettings(id, settings) {
    await ready;
    await pool.query('UPDATE licenses SET tts_settings = $1 WHERE id = $2', [JSON.stringify(settings), id]);
}

async function setGoalSettings(id, settings) {
    await ready;
    await pool.query('UPDATE licenses SET goal_settings = $1 WHERE id = $2', [JSON.stringify(settings), id]);
}

async function setGoalProgress(id, progress) {
    await ready;
    await pool.query('UPDATE licenses SET goal_progress = $1 WHERE id = $2', [JSON.stringify(progress), id]);
}

async function setRuntimeState(id, snapshot) {
    await ready;
    await pool.query('UPDATE licenses SET runtime_state = $1 WHERE id = $2', [snapshot === null ? null : JSON.stringify(snapshot), id]);
}


const USAGE_FIELDS = ['king_starts', 'zub_starts', 'elim_starts', 'roulette_starts'];

async function incrementUsage(id, field) {
    if (!USAGE_FIELDS.includes(field)) throw new Error('Campo de uso inválido: ' + field);
    await ready;
    await pool.query(`UPDATE licenses SET ${field} = ${field} + 1, last_active_at = $1 WHERE id = $2`, [Date.now(), id]);
}

// Anti-abuso de pruebas gratis: la PRIMERA vez que una licencia trial se
// conecta a un usuario de TikTok, ese usuario queda atado a ella para
// siempre (nunca puede cambiar a otro). El índice único parcial
// idx_licenses_trial_connected es quien de verdad impide que dos pruebas
// distintas terminen sirviendo al mismo canal — acá solo se interpreta el
// resultado. 'ok' = recién asignado o coincide con lo ya asignado (misma
// licencia reconectándose al mismo usuario); 'locked-own' = esta licencia
// ya está atada a OTRO usuario (el caller no revoca, solo rechaza);
// 'used-by-other' = otra licencia trial ya reclamó ese usuario (el caller
// sí revoca esta licencia — ver tenant.js).
async function claimTrialConnection(id, targetUsername) {
    await ready;
    const row = await findById(id);
    if (!row) return 'used-by-other'; // no debería pasar; tratamos como rechazo seguro
    if (row.trial_connected_username) {
        return row.trial_connected_username.toLowerCase() === targetUsername.toLowerCase() ? 'ok' : 'locked-own';
    }
    try {
        await pool.query('UPDATE licenses SET trial_connected_username = $1 WHERE id = $2', [targetUsername, id]);
        return 'ok';
    } catch (err) {
        if (err.code === '23505') return 'used-by-other'; // choca con el índice único parcial
        throw err;
    }
}

// Borra la licencia y lo que cuelga de ella (alertas, stickers vistos y
// cuentas/apps de Spotify, que tienen FK a licenses) en una sola transacción.
// Los pagos se conservan (ver la migración de payments más arriba).
async function deleteLicense(id) {
    await ready;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM alert_configs WHERE license_id = $1', [id]);
        await client.query('DELETE FROM seen_stickers WHERE license_id = $1', [id]);
        await client.query('DELETE FROM spotify_accounts WHERE license_id = $1', [id]);
        await client.query('DELETE FROM spotify_apps WHERE license_id = $1', [id]);
        await client.query('DELETE FROM licenses WHERE id = $1', [id]);
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* la conexión ya falló */ }
        throw err;
    } finally {
        client.release();
    }
}

// ==========================================
// SPOTIFY (una cuenta por licencia — ver la tabla spotify_accounts arriba)
// ==========================================
// Pedido explicito de una revision de seguridad: access_token/
// refresh_token se guardan cifrados (ver tokenCrypto.js) -- se descifran
// aca, en el UNICO lugar que lee esta tabla, para que el resto del
// backend (spotify.js/tenant.js) siga trabajando con el token en texto
// plano como siempre, sin tener que saber nada de cifrado.
// Junto con la cuenta viene `app`: la app de Spotify PROPIA de esa licencia
// (ver spotify_apps, secreto descifrado aquí mismo) o null si conecta con la
// de la plataforma. spotify.getValidAccessToken la necesita para refrescar,
// y el tenant para saber si el cupo de la app de la plataforma importa.
async function getSpotifyAccount(licenseId) {
    await ready;
    const { rows } = await pool.query(`
        SELECT sa.*, ap.client_id AS app_client_id, ap.client_secret AS app_client_secret
        FROM spotify_accounts sa
        LEFT JOIN spotify_apps ap ON ap.license_id = sa.license_id
        WHERE sa.license_id = $1
    `, [licenseId]);
    const row = rows[0];
    if (!row) return row;
    const { app_client_id: appClientId, app_client_secret: appClientSecret, ...account } = row;
    return {
        ...account,
        access_token: tokenCrypto.decrypt(row.access_token),
        refresh_token: tokenCrypto.decrypt(row.refresh_token),
        app: appClientId ? { clientId: appClientId, clientSecret: tokenCrypto.decrypt(appClientSecret) } : null,
    };
}

// La app propia por sí sola: el OAuth necesita sus credenciales ANTES de que
// exista la cuenta (a diferencia de getSpotifyAccount, que devuelve algo
// solo si ya se conectó).
async function getSpotifyApp(licenseId) {
    await ready;
    const { rows } = await pool.query('SELECT client_id, client_secret FROM spotify_apps WHERE license_id = $1', [licenseId]);
    const row = rows[0];
    return row ? { clientId: row.client_id, clientSecret: tokenCrypto.decrypt(row.client_secret) } : null;
}

// Guarda (o reemplaza) la app propia y borra la cuenta conectada: sus tokens
// los emitió otra app y ya no sirven. Se cifra ANTES de tocar nada, así una
// TOKEN_ENCRYPTION_KEY faltante no deja al streamer desconectado sin app.
async function upsertSpotifyApp(licenseId, { clientId, clientSecret }) {
    await ready;
    const encryptedSecret = tokenCrypto.encrypt(clientSecret);
    await pool.query('DELETE FROM spotify_accounts WHERE license_id = $1', [licenseId]);
    await pool.query(`
        INSERT INTO spotify_apps (license_id, client_id, client_secret, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (license_id) DO UPDATE SET
            client_id = EXCLUDED.client_id,
            client_secret = EXCLUDED.client_secret,
            created_at = EXCLUDED.created_at
    `, [licenseId, clientId, encryptedSecret, Date.now()]);
}

// Quita la app propia y también la cuenta conectada (mismo motivo de arriba).
async function deleteSpotifyApp(licenseId) {
    await ready;
    await pool.query('DELETE FROM spotify_accounts WHERE license_id = $1', [licenseId]);
    await pool.query('DELETE FROM spotify_apps WHERE license_id = $1', [licenseId]);
}

// Ids de las licencias que hoy tienen cupo en la app de la plataforma: los
// primeros `limit` Lifetime por fecha en que lo consiguieron (lifetime_at;
// created_at e id desempatan para que el orden sea siempre el mismo). Deja
// afuera a la licencia admin (no consume cupo) y a las revocadas (liberan el
// suyo). Se calcula al vuelo en cada consulta: si un cupo se libera pasa al
// siguiente Lifetime sin ningún paso manual.
async function getSharedSpotifySlotHolders(limit) {
    await ready;
    const { rows } = await pool.query(`
        SELECT id FROM licenses
        WHERE license_type = 'lifetime' AND is_admin = FALSE AND revoked = FALSE
        ORDER BY lifetime_at ASC NULLS LAST, created_at ASC, id ASC
        LIMIT $1
    `, [limit]);
    return rows.map((row) => row.id);
}

// A qué cuenta de Spotify está vinculada cada licencia, SIN tokens: el panel de
// Licencias lo muestra para que el dueño vea quién comparte cuenta (dos
// licencias pueden vincular la misma, ver el comentario de SHARED_SLOTS_TOTAL
// en spotify.js). `own_app` distingue las que usan su propia app de Spotify de
// las que usan la de la plataforma, que son las que cuentan para el tope.
async function listSpotifyAccountLinks() {
    await ready;
    const { rows } = await pool.query(`
        SELECT sa.license_id, sa.spotify_user_id, sa.display_name, sa.connected_at,
               (ap.license_id IS NOT NULL) AS own_app
        FROM spotify_accounts sa
        LEFT JOIN spotify_apps ap ON ap.license_id = sa.license_id
    `);
    return rows;
}

// Encender/apagar el complemento a mano (panel de Licencias): cubre un pago
// hecho por fuera o un reembolso. Las compras normales lo encienden por
// applyPurchase.
async function setSpotifyAddon(id, spotifyAddon) {
    await ready;
    await pool.query('UPDATE licenses SET spotify_addon = $1 WHERE id = $2', [!!spotifyAddon, id]);
    return findById(id);
}

// Se usa tanto para la primera conexión (con spotifyUserId/displayName)
// como para reconectar después de desconectar — siempre reemplaza la fila
// entera, a diferencia de updateSpotifyTokens (que solo toca los tokens).
async function upsertSpotifyAccount(licenseId, { accessToken, refreshToken, expiresAt, spotifyUserId, displayName }) {
    await ready;
    await pool.query(`
        INSERT INTO spotify_accounts (license_id, access_token, refresh_token, expires_at, spotify_user_id, display_name, connected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (license_id) DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            spotify_user_id = EXCLUDED.spotify_user_id,
            display_name = EXCLUDED.display_name,
            connected_at = EXCLUDED.connected_at
    `, [licenseId, tokenCrypto.encrypt(accessToken), tokenCrypto.encrypt(refreshToken), expiresAt, spotifyUserId || null, displayName || null, Date.now()]);
}

// Refresh silencioso de un access_token vencido (ver spotify.getValidAccessToken)
// — el refresh_token solo se toca cuando Spotify manda uno nuevo (`refreshToken`
// definido): no lo manda en cada refresh, y pisarlo con undefined dejaría la
// cuenta conectada sin forma de renovarse.
async function updateSpotifyTokens(licenseId, { accessToken, expiresAt, refreshToken }) {
    await ready;
    if (refreshToken) {
        await pool.query(
            'UPDATE spotify_accounts SET access_token = $1, expires_at = $2, refresh_token = $3 WHERE license_id = $4',
            [tokenCrypto.encrypt(accessToken), expiresAt, tokenCrypto.encrypt(refreshToken), licenseId],
        );
        return;
    }
    await pool.query('UPDATE spotify_accounts SET access_token = $1, expires_at = $2 WHERE license_id = $3', [tokenCrypto.encrypt(accessToken), expiresAt, licenseId]);
}

async function deleteSpotifyAccount(licenseId) {
    await ready;
    await pool.query('DELETE FROM spotify_accounts WHERE license_id = $1', [licenseId]);
}

// ==========================================
// ALERTAS DE REGALOS (ver la tabla alert_configs arriba)
// ==========================================
async function listAlertConfigs(licenseId) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM alert_configs WHERE license_id = $1 ORDER BY gift_name ASC', [licenseId]);
    return rows;
}

async function getAlertConfig(id) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM alert_configs WHERE id = $1', [id]);
    return rows[0];
}

// Un solo alert por (licencia, regalo) — volver a guardar para el mismo
// regalo reemplaza el anterior. El caller (server.js) resuelve de
// antemano qué archivo viejo hay que borrar del storage y qué valores de
// visual_*/audio_* mandar acá (los nuevos recién subidos, o los que ya
// tenía la alerta si esto es una edición que no tocó ese archivo) — esta
// función no sabe ni le importa la diferencia entre crear y editar.
async function upsertAlertConfig({
    id, licenseId, giftName,
    visualUrl, visualPath, visualType, visualMuted,
    audioUrl, audioPath,
    text, textPosition, textColor = null, giftId = null,
    durationMs, position, entranceAnim, exitAnim, triggerType, minCoins = null,
    apodo = null,
}) {
    await ready;
    await pool.query(`
        INSERT INTO alert_configs (id, license_id, gift_name, visual_url, visual_path, visual_type, visual_muted, audio_url, audio_path, alert_text, text_position, text_color, gift_id, duration_ms, position, entrance_anim, exit_anim, trigger_type, min_coins, apodo, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $19, $20, $12, $13, $14, $15, $16, $17, $21, $18)
        ON CONFLICT (license_id, gift_name) DO UPDATE SET
            id = EXCLUDED.id,
            visual_url = EXCLUDED.visual_url,
            visual_path = EXCLUDED.visual_path,
            visual_type = EXCLUDED.visual_type,
            visual_muted = EXCLUDED.visual_muted,
            audio_url = EXCLUDED.audio_url,
            audio_path = EXCLUDED.audio_path,
            alert_text = EXCLUDED.alert_text,
            text_position = EXCLUDED.text_position,
            text_color = EXCLUDED.text_color,
            gift_id = EXCLUDED.gift_id,
            duration_ms = EXCLUDED.duration_ms,
            position = EXCLUDED.position,
            entrance_anim = EXCLUDED.entrance_anim,
            exit_anim = EXCLUDED.exit_anim,
            trigger_type = EXCLUDED.trigger_type,
            min_coins = EXCLUDED.min_coins,
            apodo = EXCLUDED.apodo,
            created_at = EXCLUDED.created_at
    `, [
        id, licenseId, giftName,
        visualUrl || null, visualPath || null, visualType || null, !!visualMuted,
        audioUrl || null, audioPath || null,
        text || null, textPosition || 'below',
        durationMs, position, entranceAnim || 'fade', exitAnim || 'fade', triggerType || 'gift', minCoins,
        Date.now(),
        textColor,
        giftId,
        apodo,
    ]);
    return getAlertConfig(id);
}

async function deleteAlertConfig(id, licenseId) {
    await ready;
    await pool.query('DELETE FROM alert_configs WHERE id = $1 AND license_id = $2', [id, licenseId]);
}

async function extendLicense(id, licenseType, expiresAt, diceTier) {
    await ready;
    await pool.query(
        `UPDATE licenses SET license_type = $1, expires_at = $2, revoked = FALSE, dice_tier = $3, lifetime_at = ${lifetimeAtSql('$1', '$5')} WHERE id = $4`,
        [licenseType, expiresAt, diceTier, id, Date.now()],
    );
    return findById(id);
}

// Autoservicio de compra (webhook de MercadoPago, ver server.js): a
// diferencia de extendLicense (admin, siempre pisa los 3 campos), acá
// licenseType/diceTier/keyHash son independientes — una compra de "solo
// addon" no debe tocar license_type/expires_at/la key, y viceversa.
// Undefined = no tocar. keyHash/keyPrefix/pendingKeyReveal van juntos: se
// rota la key al mismo tiempo que se aplica la compra (ver generateLabeledKey
// en auth.js) para que el streamer vea su plan nuevo reflejado en el
// prefijo de la key, sin generar una licencia nueva ni tocar el id/sesión.
async function applyPurchase(id, { licenseType, expiresAt, diceTier, spotifyAddon, keyHash, keyPrefix, pendingKeyReveal } = {}) {
    await ready;
    const sets = ['revoked = FALSE'];
    const params = [];
    if (licenseType !== undefined) {
        params.push(licenseType);
        const typeParam = `$${params.length}`;
        sets.push(`license_type = ${typeParam}`);
        params.push(expiresAt);
        sets.push(`expires_at = $${params.length}`);
        params.push(Date.now());
        sets.push(`lifetime_at = ${lifetimeAtSql(typeParam, `$${params.length}`)}`);
    }
    if (diceTier !== undefined) {
        params.push(diceTier);
        sets.push(`dice_tier = $${params.length}`);
    }
    // Complemento de Spotify: solo se enciende con una compra (undefined = no
    // tocar), nunca se apaga por aquí.
    if (spotifyAddon !== undefined) {
        params.push(!!spotifyAddon);
        sets.push(`spotify_addon = $${params.length}`);
    }
    if (keyHash !== undefined) {
        params.push(keyHash);
        sets.push(`key_hash = $${params.length}`);
        params.push(keyPrefix);
        sets.push(`key_prefix = $${params.length}`);
        params.push(pendingKeyReveal);
        sets.push(`pending_key_reveal = $${params.length}`);
    }
    params.push(id);
    await pool.query(`UPDATE licenses SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    return findById(id);
}

// Lee y borra en el mismo paso la key pendiente de mostrar (ver el
// comentario de pending_key_reveal más arriba) — de un solo uso a propósito,
// así no queda una key en texto plano dando vueltas en la DB más de lo
// necesario. `findById` ya la había leído antes de llamar a esto si hace
// falta mostrarla en la misma respuesta.
async function consumePendingKeyReveal(id) {
    await ready;
    await pool.query('UPDATE licenses SET pending_key_reveal = NULL WHERE id = $1', [id]);
}

// INSERT ... ON CONFLICT DO NOTHING sobre el UNIQUE sobre mp_payment_id:
// devuelve true la primera vez que se ve ese pago, false en cualquier
// reintento posterior de la misma notificación — así el webhook sabe si
// tiene que aplicar la compra o si ya la aplicó antes.
async function insertPaymentIfNew({ id, licenseId, mpPaymentId, planType, diceTier, spotifyAddon, amountCents, status, createdAt }) {
    await ready;
    const { rows } = await pool.query(`
        INSERT INTO payments (id, license_id, mp_payment_id, plan_type, dice_tier, spotify_addon, amount_cents, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mp_payment_id) DO NOTHING
        RETURNING id
    `, [id, licenseId, mpPaymentId, planType || null, diceTier || null, !!spotifyAddon, amountCents, status, createdAt]);
    return rows.length > 0;
}

// Directorio de regalos vistos (ver lib/giftDirectoryCore.js): se guarda cada
// regalo por su id de TikTok; si ya existía se actualizan sus datos y `icon`
// solo se pisa cuando llega uno (nunca se borra un ícono conocido).
async function upsertSeenGift({ id, name, coins, icon }) {
    await ready;
    const now = Date.now();
    await pool.query(`
        INSERT INTO seen_gifts (gift_id, name, coins, icon, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (gift_id) DO UPDATE SET
            name = EXCLUDED.name,
            coins = EXCLUDED.coins,
            icon = CASE WHEN EXCLUDED.icon <> '' THEN EXCLUDED.icon ELSE seen_gifts.icon END,
            last_seen = EXCLUDED.last_seen
    `, [id, name, coins, icon || '', now]);
}

async function listSeenGifts() {
    await ready;
    const { rows } = await pool.query('SELECT gift_id::text AS gift_id, name, coins, icon FROM seen_gifts ORDER BY coins, name');
    return rows;
}

// Stickers del club de fans vistos en el chat de una licencia (ver la tabla
// seen_stickers arriba y lib/stickerDirectoryCore.js). Volver a verlos solo
// refresca la imagen y la fecha; nunca duplica la fila.
async function upsertSeenSticker(licenseId, { id, imageUrl }) {
    await ready;
    const now = Date.now();
    await pool.query(`
        INSERT INTO seen_stickers (license_id, emote_id, image_url, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (license_id, emote_id) DO UPDATE SET
            image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE seen_stickers.image_url END,
            last_seen = EXCLUDED.last_seen
    `, [licenseId, id, imageUrl || '', now]);
}

async function listSeenStickers(licenseId) {
    await ready;
    const { rows } = await pool.query('SELECT emote_id, image_url FROM seen_stickers WHERE license_id = $1 ORDER BY first_seen, emote_id', [licenseId]);
    return rows;
}

// Todos los pagos, solo las columnas que usa el panel de estadísticas del admin.
async function listPaymentsForStats() {
    await ready;
    const { rows } = await pool.query(
        'SELECT license_id, provider, stripe_payment_id, plan_type, dice_tier, spotify_addon, amount_cents, status, created_at FROM payments',
    );
    return rows;
}

// Olvida el registro de un pago cuyo efecto NO se pudo aplicar a la licencia
// (ver applyPaymentWithRetry en server.js): sin esto, el reintento del webhook
// o del sondeo lo vería como "ya procesado" y el cliente quedaría cobrado sin
// su plan. `provider` es 'mp' o 'stripe'.
async function deletePaymentRecord(provider, providerPaymentId) {
    await ready;
    const column = provider === 'stripe' ? 'stripe_payment_id' : 'mp_payment_id';
    await pool.query(`DELETE FROM payments WHERE ${column} = $1`, [String(providerPaymentId)]);
}

// Mismo patrón que insertPaymentIfNew de arriba, pero para Stripe -- el
// UNIQUE parcial sobre stripe_payment_id (ver migración arriba) es lo que
// hace esto idempotente ante un reintento (ej. /confirm ya lo aplicó y
// después llega el webhook con el mismo PaymentIntent).
async function insertStripePaymentIfNew({ id, licenseId, stripePaymentId, planType, diceTier, spotifyAddon, amountCents, status, createdAt }) {
    await ready;
    const { rows } = await pool.query(`
        INSERT INTO payments (id, license_id, stripe_payment_id, provider, plan_type, dice_tier, spotify_addon, amount_cents, status, created_at)
        VALUES ($1, $2, $3, 'stripe', $4, $5, $6, $7, $8, $9)
        ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING
        RETURNING id
    `, [id, licenseId, stripePaymentId, planType || null, diceTier || null, !!spotifyAddon, amountCents, status, createdAt]);
    return rows.length > 0;
}

// Devuelve un mapa { [plan_type]: amount_cents } -- solo los planes que el
// admin haya sobreescrito alguna vez, ver el comentario de la tabla arriba.
async function getPricingOverrides() {
    await ready;
    const { rows } = await pool.query('SELECT plan_type, amount_cents FROM pricing_overrides');
    const map = {};
    rows.forEach(r => { map[r.plan_type] = r.amount_cents; });
    return map;
}

// Upsert del precio vigente + una fila de historial en la misma llamada --
// no hace falta una transaccion explicita: si el INSERT de historial
// fallara, preferimos que el UPSERT del precio vigente (lo unico que de
// verdad afecta lo que se cobra) haya quedado aplicado antes que perder
// ambos por un rollback sobre una tabla puramente de auditoria.
async function setPricingOverride(planType, amountCents, updatedBy) {
    await ready;
    const now = Date.now();
    const { rows: prevRows } = await pool.query('SELECT amount_cents FROM pricing_overrides WHERE plan_type = $1', [planType]);
    const oldAmountCents = prevRows.length > 0 ? prevRows[0].amount_cents : null;
    await pool.query(`
        INSERT INTO pricing_overrides (plan_type, amount_cents, updated_at, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (plan_type) DO UPDATE SET amount_cents = $2, updated_at = $3, updated_by = $4
    `, [planType, amountCents, now, updatedBy]);
    await pool.query(`
        INSERT INTO pricing_history (id, plan_type, old_amount_cents, new_amount_cents, changed_by, changed_at)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [require('crypto').randomUUID(), planType, oldAmountCents, amountCents, updatedBy, now]);
    return { oldAmountCents };
}

async function getPricingHistory(limit = 50) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM pricing_history ORDER BY changed_at DESC LIMIT $1', [limit]);
    return rows;
}

// ── Salud ──────────────────────────────────────────────────
async function ping() {
    await ready;
    await pool.query('SELECT 1');
}

// ── Reportes de errores (ver lib/errorReports.js) ──────────
// Si la huella ya existe se suma al contador; si no, se crea. Se hace en dos
// pasos (y no con ON CONFLICT) para que otro reporte igual que entre a la vez no
// rompa nada: el que pierde la carrera vuelve a sumar.
async function upsertErrorReport({ fingerprint, source, kind, message, stack, context, userAgent, licenseId, increment = 1, at }) {
    await ready;
    const bump = () => pool.query(
        `UPDATE error_reports SET occurrences = occurrences + $2, last_seen = $3 WHERE fingerprint = $1`,
        [fingerprint, increment, at],
    );
    const updated = await bump();
    if (updated.rowCount > 0) return;
    try {
        await pool.query(`
            INSERT INTO error_reports (id, fingerprint, source, kind, message, stack, context, user_agent, license_id, occurrences, first_seen, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        `, [require('crypto').randomUUID(), fingerprint, source, kind, message, stack || null, context || null, userAgent || null, licenseId || null, increment, at]);
    } catch (err) {
        if (err.code !== '23505') throw err;
        await bump();
    }
}

async function listErrorReports(limit = 100) {
    await ready;
    const { rows } = await pool.query(
        'SELECT id, source, kind, message, stack, context, user_agent, license_id, occurrences, first_seen, last_seen FROM error_reports ORDER BY last_seen DESC LIMIT $1',
        [limit],
    );
    return rows;
}

async function clearErrorReports() {
    await ready;
    const result = await pool.query('DELETE FROM error_reports');
    return result.rowCount || 0;
}

// Borra lo viejo y, si aun así hay más de `maxRows`, lo más antiguo.
async function pruneErrorReports({ olderThan, maxRows }) {
    await ready;
    await pool.query('DELETE FROM error_reports WHERE last_seen < $1', [olderThan]);
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM error_reports');
    const extra = Number(rows[0].n) - maxRows;
    if (extra <= 0) return;
    const oldest = await pool.query('SELECT id FROM error_reports ORDER BY last_seen ASC LIMIT $1', [extra]);
    const ids = oldest.rows.map((row) => row.id);
    if (ids.length === 0) return;
    await pool.query(`DELETE FROM error_reports WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ids);
}

// Cuántos errores distintos y cuántas ocurrencias desde `since`.
async function countErrorReportsSince(since) {
    await ready;
    const { rows } = await pool.query('SELECT COUNT(*) AS distinct_count, COALESCE(SUM(occurrences), 0) AS total FROM error_reports WHERE last_seen >= $1', [since]);
    return { distinct: Number(rows[0].distinct_count), occurrences: Number(rows[0].total) };
}

// ── Historial de acciones del admin ────────────────────────
async function insertAuditLog({ id, at, adminUsername, adminLicenseId, action, targetLicenseId, targetLabel, details }) {
    await ready;
    await pool.query(`
        INSERT INTO admin_audit (id, at, admin_username, admin_license_id, action, target_license_id, target_label, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, at, adminUsername, adminLicenseId || null, action, targetLicenseId || null, targetLabel || null, details || null]);
}

async function listAuditLog({ limit = 100, before = null } = {}) {
    await ready;
    const { rows } = before
        ? await pool.query('SELECT * FROM admin_audit WHERE at < $1 ORDER BY at DESC LIMIT $2', [before, limit])
        : await pool.query('SELECT * FROM admin_audit ORDER BY at DESC LIMIT $1', [limit]);
    return rows;
}

async function pruneAuditLog({ olderThan, maxRows }) {
    await ready;
    await pool.query('DELETE FROM admin_audit WHERE at < $1', [olderThan]);
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM admin_audit');
    const extra = Number(rows[0].n) - maxRows;
    if (extra <= 0) return;
    const oldest = await pool.query('SELECT id FROM admin_audit ORDER BY at ASC LIMIT $1', [extra]);
    const ids = oldest.rows.map((row) => row.id);
    if (ids.length === 0) return;
    await pool.query(`DELETE FROM admin_audit WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ids);
}

// ── Pagos que no se pudieron aplicar ───────────────────────
// Una fila por pago: si ya existía (y se resolvió) y vuelve a fallar, se reabre.
async function upsertPaymentFailure({ provider, providerPaymentId, licenseId, planType, diceTier, spotifyAddon, amountCents, reason, error, createdAt }) {
    await ready;
    const reopen = () => pool.query(
        'UPDATE payment_failures SET reason = $3, error = $4, resolved_at = NULL, resolved_by = NULL WHERE provider = $1 AND provider_payment_id = $2',
        [provider, String(providerPaymentId), reason, error || null],
    );
    const updated = await reopen();
    if (updated.rowCount > 0) return;
    try {
        await pool.query(`
            INSERT INTO payment_failures (id, provider, provider_payment_id, license_id, plan_type, dice_tier, spotify_addon, amount_cents, reason, error, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [require('crypto').randomUUID(), provider, String(providerPaymentId), licenseId || null, planType || null, diceTier || null, !!spotifyAddon, Number(amountCents) || 0, reason, error || null, createdAt]);
    } catch (err) {
        if (err.code !== '23505') throw err;
        await reopen();
    }
}

async function listPaymentFailures({ includeResolved = false } = {}) {
    await ready;
    const { rows } = await pool.query(
        `SELECT * FROM payment_failures ${includeResolved ? '' : 'WHERE resolved_at IS NULL'} ORDER BY created_at DESC LIMIT 200`,
    );
    return rows;
}

async function getPaymentFailure(id) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM payment_failures WHERE id = $1', [id]);
    return rows[0];
}

async function resolvePaymentFailure(id, by) {
    await ready;
    await pool.query('UPDATE payment_failures SET resolved_at = $2, resolved_by = $3 WHERE id = $1 AND resolved_at IS NULL', [id, Date.now(), by]);
}

// Cuando un reintento del proveedor sí logra aplicar el pago, el aviso se cierra solo.
async function resolvePaymentFailureFor(provider, providerPaymentId, by) {
    await ready;
    await pool.query(
        'UPDATE payment_failures SET resolved_at = $3, resolved_by = $4 WHERE provider = $1 AND provider_payment_id = $2 AND resolved_at IS NULL',
        [provider, String(providerPaymentId), Date.now(), by],
    );
}

// ── Conciliación ───────────────────────────────────────────
async function listPaymentsWithoutLicense(limit = 200) {
    await ready;
    const { rows } = await pool.query(
        'SELECT p.* FROM payments p LEFT JOIN licenses l ON l.id = p.license_id WHERE l.id IS NULL ORDER BY p.created_at DESC LIMIT $1',
        [limit],
    );
    return rows;
}

async function listStripePaymentIdsSince(sinceMs) {
    await ready;
    const { rows } = await pool.query('SELECT stripe_payment_id FROM payments WHERE stripe_payment_id IS NOT NULL AND created_at >= $1', [sinceMs]);
    return rows.map((row) => row.stripe_payment_id);
}

// ── Enlaces de overlay ─────────────────────────────────────
async function bumpOverlayEpoch(id) {
    await ready;
    const { rows } = await pool.query('UPDATE licenses SET overlay_epoch = overlay_epoch + 1 WHERE id = $1 RETURNING overlay_epoch', [id]);
    return rows[0] ? Number(rows[0].overlay_epoch) : null;
}

// ── Archivos en uso (para detectar huérfanos, ver lib/storageOrphans.js) ──
// Todas las rutas del bucket que alguna fila de la base usa: los archivos de las
// alertas y el sonido de "objetivo completado" de cada licencia.
async function listReferencedMediaPaths() {
    await ready;
    const alerts = await pool.query('SELECT visual_path, audio_path, media_path FROM alert_configs');
    const goals = await pool.query('SELECT goal_settings FROM licenses WHERE goal_settings IS NOT NULL');
    const paths = new Set();
    for (const row of alerts.rows) {
        for (const path of [row.visual_path, row.audio_path, row.media_path]) if (path) paths.add(path);
    }
    for (const row of goals.rows) {
        let settings = row.goal_settings;
        if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { settings = null; } }
        if (settings && settings.audioPath) paths.add(settings.audioPath);
    }
    return paths;
}

module.exports = {
    insertLicense, findByKeyHash, findById, listAll, revoke, touchLastLogin, incrementUsage, setSession, setMultiDevice,
    setWinBonusUnlocked, claimTrialConnection, deleteLicense, extendLicense, applyPurchase, insertPaymentIfNew, insertStripePaymentIfNew, consumePendingKeyReveal,
    setThemeSettings, setOverlayCustomization, setSpotifySettings, setTtsSettings, setGoalSettings, setGoalProgress, setRuntimeState,
    getSpotifyAccount, upsertSpotifyAccount, updateSpotifyTokens, deleteSpotifyAccount,
    getSpotifyApp, upsertSpotifyApp, deleteSpotifyApp, getSharedSpotifySlotHolders, setSpotifyAddon, setDiceTier, deletePaymentRecord, listPaymentsForStats, upsertSeenGift, listSeenGifts, upsertSeenSticker, listSeenStickers,
    setLicenseKey, listSpotifyAccountLinks,
    listAlertConfigs, getAlertConfig, upsertAlertConfig, deleteAlertConfig,
    getPricingOverrides, setPricingOverride, getPricingHistory,
    ping, upsertErrorReport, listErrorReports, clearErrorReports, pruneErrorReports, countErrorReportsSince,
    insertAuditLog, listAuditLog, pruneAuditLog,
    upsertPaymentFailure, listPaymentFailures, getPaymentFailure, resolvePaymentFailure, resolvePaymentFailureFor,
    listPaymentsWithoutLicense, listStripePaymentIdsSince, bumpOverlayEpoch, listReferencedMediaPaths,
};
