// Rutas de operación y administración del sistema: salud, reportes de errores,
// historial de acciones del admin, estado del servidor, almacenamiento y
// conciliación de pagos. Van aparte de server.js (que ya es enorme) y reciben lo
// que necesitan por parámetro, así se pueden probar con piezas de mentira.

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { cspReportToRaw, DAY_MS } = require('../lib/errorReports');
const { findOrphans, usageByLicense } = require('../lib/storageOrphans');
const { listSucceededStripeIntents, findUnrecordedStripe, summarizeWithoutLicense } = require('../lib/paymentsReconcile');

const limiter = (windowMs, max) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false });

const MAX_CLEANUP_BATCH = 500;

// Lo que guarda la base como texto (details) vuelve al panel como objeto.
function parseDetails(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

function registerSystemRoutes(app, deps) {
    const {
        auth, db, storage, io, tenants, errorReporter, healthChecker, getStripeClient,
        applyPaymentWithRetry, applyApprovedStripePaymentIfNew, audit, bootId,
    } = deps;

    const adminOnly = [auth.requireAuth, auth.requireAdmin];
    const healthLimiter = limiter(60 * 1000, 60);
    const clientErrorLimiter = limiter(15 * 60 * 1000, 40);
    const cspReportLimiter = limiter(15 * 60 * 1000, 120);
    const adminLimiter = limiter(15 * 60 * 1000, 120); // paneles que se refrescan solos
    // Las que consultan servicios externos (Supabase, Stripe) tienen su propio límite cada una: el panel de Pagos
    // vuelve a consultar al abrirlo y al cambiar el rango de días, y eso no debe gastar el cupo de Archivos.
    const storageLimiter = limiter(10 * 60 * 1000, 10);
    const reconcileLimiter = limiter(10 * 60 * 1000, 20);

    const licenseNames = async () => new Map((await db.listAll()).map((license) => [license.id, license.username]));

    // ── Salud ────────────────────────────────────────────────
    // /health (en server.js) es solo "el proceso responde" y lo usa Render para
    // decidir si reinicia. Este, además, comprueba la base de datos: es para un
    // monitor externo que avise cuando se cae, sin que un bache de la base tumbe a
    // todos los streamers que están en directo.
    app.get('/health/deep', healthLimiter, async (req, res) => {
        const result = await healthChecker.check();
        res.set('Cache-Control', 'no-store');
        res.status(result.ok ? 200 : 503).json({
            ok: result.ok,
            uptimeSeconds: Math.round(process.uptime()),
            db: result.db.ok ? 'ok' : 'down',
            dbLatencyMs: result.db.latencyMs,
        });
    });

    // ── Reportes de errores ──────────────────────────────────
    // Sin exigir sesión a propósito: los errores también ocurren en el inicio de
    // sesión y en los overlays de OBS (que no tienen sesión). Lo acota el límite de
    // peticiones y el reporter (ver lib/errorReports.js). Si viene una sesión
    // válida se anota de qué licencia es.
    app.post('/api/client-errors', clientErrorLimiter, async (req, res) => {
        let licenseId = null;
        const header = req.headers.authorization || '';
        if (header.startsWith('Bearer ')) {
            try { licenseId = (await auth.checkTokenStatus(header.slice(7))).row?.id || null; } catch { /* sin sesión válida: se registra igual */ }
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const accepted = await errorReporter.record({
            kind: body.kind, message: body.message, stack: body.stack, context: body.context,
            userAgent: req.headers['user-agent'],
        }, { source: 'frontend', licenseId });
        res.sendStatus(accepted ? 204 : 202); // 202: llegó, pero se descartó (ráfaga o vacío)
    });

    // El navegador manda solo las violaciones de la política de seguridad de
    // contenido (modo solo reporte, ver lib/csp.js) con su propio tipo de contenido.
    app.post('/api/csp-report', cspReportLimiter,
        express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '20kb' }),
        async (req, res) => {
            await errorReporter.record(cspReportToRaw(req.body), { source: 'csp' });
            res.sendStatus(204);
        });

    app.get('/api/admin/errors', ...adminOnly, adminLimiter, async (req, res) => {
        try {
            const [rows, names, last24h] = await Promise.all([
                db.listErrorReports(200), licenseNames(), db.countErrorReportsSince(Date.now() - DAY_MS),
            ]);
            res.set('Cache-Control', 'no-store');
            res.json({
                success: true,
                last24h,
                errors: rows.map((row) => ({
                    id: row.id, source: row.source, kind: row.kind, message: row.message, stack: row.stack,
                    context: row.context, userAgent: row.user_agent,
                    license: row.license_id ? (names.get(row.license_id) || '(eliminada)') : null,
                    occurrences: Number(row.occurrences) || 1,
                    firstSeen: Number(row.first_seen), lastSeen: Number(row.last_seen),
                })),
            });
        } catch (err) {
            console.error('[Admin] No se pudieron leer los errores:', err.message);
            res.status(500).json({ success: false, error: 'No se pudieron cargar los errores' });
        }
    });

    app.delete('/api/admin/errors', ...adminOnly, adminLimiter, async (req, res) => {
        try {
            const removed = await db.clearErrorReports();
            audit(req, 'errors.clear', {}, { removed });
            res.json({ success: true, removed });
        } catch (err) {
            console.error('[Admin] No se pudieron limpiar los errores:', err.message);
            res.status(500).json({ success: false, error: 'No se pudieron limpiar los errores' });
        }
    });

    // ── Historial de acciones del admin ──────────────────────
    app.get('/api/admin/audit', ...adminOnly, adminLimiter, async (req, res) => {
        try {
            const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
            const before = Number(req.query.before) || null;
            const rows = await db.listAuditLog({ limit, before });
            res.set('Cache-Control', 'no-store');
            res.json({
                success: true,
                entries: rows.map((row) => ({
                    id: row.id, at: Number(row.at), admin: row.admin_username, action: row.action,
                    targetLicenseId: row.target_license_id, target: row.target_label, details: parseDetails(row.details),
                })),
            });
        } catch (err) {
            console.error('[Admin] No se pudo leer el historial:', err.message);
            res.status(500).json({ success: false, error: 'No se pudo cargar el historial' });
        }
    });

    // ── Estado del servidor ──────────────────────────────────
    app.get('/api/admin/system', ...adminOnly, adminLimiter, async (req, res) => {
        const health = await healthChecker.check();
        let errors24h = { distinct: 0, occurrences: 0 };
        try { errors24h = await db.countErrorReportsSince(Date.now() - DAY_MS); } catch { /* con la base caída se muestra en cero */ }
        const memory = process.memoryUsage();
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            system: {
                bootId, uptimeSeconds: Math.round(process.uptime()), node: process.version,
                db: health.db,
                tenants: tenants.size,
                sockets: io.engine?.clientsCount ?? null,
                memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
                storageConfigured: storage.isConfigured(),
                errors24h,
                reporter: errorReporter.stats(),
            },
        });
    });

    // ── Almacenamiento (archivos de las alertas) ─────────────
    async function scanStorage() {
        const [{ files, truncated }, referenced, names] = await Promise.all([
            storage.listAllFiles(), db.listReferencedMediaPaths(), licenseNames(),
        ]);
        const { orphans, totals } = findOrphans({ files, referenced });
        const top = usageByLicense(files, 8).map((usage) => ({ ...usage, license: names.get(usage.licenseId) || '(licencia eliminada)' }));
        return { orphans, totals, top, truncated };
    }

    // Solo mira: cuánto hay, quién ocupa más y qué archivos sobran.
    app.get('/api/admin/storage', ...adminOnly, storageLimiter, async (req, res) => {
        if (!storage.isConfigured()) return res.json({ success: true, configured: false });
        try {
            const scan = await scanStorage();
            res.set('Cache-Control', 'no-store');
            res.json({
                success: true, configured: true, truncated: scan.truncated, totals: scan.totals, top: scan.top,
                orphans: scan.orphans.slice(0, 50).map((orphan) => ({ path: orphan.path, size: orphan.size, createdAt: orphan.createdAt })),
            });
        } catch (err) {
            console.error('[Admin] No se pudo revisar el almacenamiento:', err.message);
            res.status(502).json({ success: false, error: 'No se pudo revisar el almacenamiento. Intenta de nuevo en un momento.' });
        }
    });

    // Borra los huérfanos. La lista se vuelve a calcular AQUÍ: nunca se confía en
    // una que mande el navegador.
    app.post('/api/admin/storage/cleanup', ...adminOnly, storageLimiter, async (req, res) => {
        if (!storage.isConfigured()) return res.status(400).json({ success: false, error: 'El almacenamiento no está configurado' });
        try {
            const scan = await scanStorage();
            const batch = scan.orphans.slice(0, MAX_CLEANUP_BATCH);
            const { deleted, failed } = await storage.deleteFiles(batch.map((orphan) => orphan.path));
            audit(req, 'storage.cleanup', {}, { deleted, failed, orphans: scan.orphans.length });
            res.json({ success: true, deleted, failed, remaining: Math.max(0, scan.orphans.length - deleted) });
        } catch (err) {
            console.error('[Admin] No se pudo limpiar el almacenamiento:', err.message);
            res.status(502).json({ success: false, error: 'No se pudo limpiar el almacenamiento. Intenta de nuevo en un momento.' });
        }
    });

    // ── Conciliación de pagos ────────────────────────────────
    app.get('/api/admin/payments/reconcile', ...adminOnly, reconcileLimiter, async (req, res) => {
        try {
            const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
            const sinceMs = Date.now() - days * DAY_MS;
            const [failures, withoutLicense, names] = await Promise.all([
                db.listPaymentFailures(), db.listPaymentsWithoutLicense(200), licenseNames(),
            ]);
            const report = {
                days,
                failures: failures.map((failure) => ({
                    id: failure.id, provider: failure.provider, paymentId: failure.provider_payment_id,
                    licenseId: failure.license_id, license: names.get(failure.license_id) || null,
                    planType: failure.plan_type, diceTier: failure.dice_tier, spotifyAddon: !!failure.spotify_addon,
                    amountCents: Number(failure.amount_cents) || 0, reason: failure.reason, error: failure.error,
                    createdAt: Number(failure.created_at),
                })),
                withoutLicense: summarizeWithoutLicense(withoutLicense),
                stripe: { available: false, checked: 0, unrecorded: [], error: null },
            };
            if (process.env.STRIPE_SECRET_KEY) {
                try {
                    const [intents, known] = await Promise.all([
                        listSucceededStripeIntents(getStripeClient(), { sinceSec: Math.floor(sinceMs / 1000) }),
                        db.listStripePaymentIdsSince(sinceMs - 60 * 1000),
                    ]);
                    report.stripe = {
                        available: true, checked: intents.length, error: null,
                        unrecorded: findUnrecordedStripe(intents, new Set(known)).map((item) => ({ ...item, license: names.get(item.licenseId) || null })),
                    };
                } catch (err) {
                    console.error('[Pagos] No se pudo consultar Stripe para conciliar:', err.message);
                    report.stripe = { available: false, checked: 0, unrecorded: [], error: 'No se pudo consultar Stripe' };
                }
            }
            res.set('Cache-Control', 'no-store');
            res.json({ success: true, report });
        } catch (err) {
            console.error('[Pagos] No se pudo conciliar:', err.message);
            res.status(500).json({ success: false, error: 'No se pudo revisar los pagos' });
        }
    });

    // Aplica un pago que se cobró y no se pudo aplicar. Es seguro repetirlo: el
    // registro del pago es único por proveedor, así que un reintento del proveedor
    // que llegue después no lo aplica dos veces.
    app.post('/api/admin/payments/failures/:id/apply', ...adminOnly, adminLimiter, async (req, res) => {
        try {
            const failure = await db.getPaymentFailure(req.params.id);
            if (!failure || failure.resolved_at) return res.status(404).json({ success: false, error: 'Ese pago ya no está pendiente' });
            if (!failure.license_id || !(await db.findById(failure.license_id))) {
                return res.status(409).json({ success: false, error: 'La licencia de este pago ya no existe: no hay a qué aplicarlo.' });
            }
            const stripe = failure.provider === 'stripe';
            const plan = { planType: failure.plan_type || undefined, diceTier: failure.dice_tier || undefined, spotifyAddon: !!failure.spotify_addon };
            const record = {
                id: crypto.randomUUID(), licenseId: failure.license_id, planType: plan.planType || null, diceTier: plan.diceTier || null,
                spotifyAddon: plan.spotifyAddon, amountCents: Number(failure.amount_cents) || 0, status: 'approved', createdAt: Date.now(),
            };
            if (stripe) await db.insertStripePaymentIfNew({ ...record, stripePaymentId: failure.provider_payment_id });
            else await db.insertPaymentIfNew({ ...record, mpPaymentId: failure.provider_payment_id });
            const result = await applyPaymentWithRetry({
                label: stripe ? 'Stripe' : 'MP', licenseId: failure.license_id, ...plan,
                provider: stripe ? 'stripe' : 'mp', providerPaymentId: failure.provider_payment_id, amountCents: record.amountCents,
                forget: async () => {}, // aquí no se olvida el registro: sigue pendiente hasta que se aplique
            });
            if (!result.applied) return res.status(409).json({ success: false, error: 'No se pudo aplicar el pago a la licencia.' });
            await db.resolvePaymentFailure(failure.id, req.license.username);
            audit(req, 'payment.apply_failure', { id: failure.license_id }, { provider: failure.provider, paymentId: failure.provider_payment_id });
            res.json({ success: true });
        } catch (err) {
            console.error('[Pagos] No se pudo aplicar un pago pendiente:', err.message);
            res.status(502).json({ success: false, error: 'No se pudo aplicar el pago. Intenta de nuevo o edita la licencia a mano.' });
        }
    });

    // Registra y aplica un cobro que Stripe da por bueno y este sitio no tenía. Los
    // datos salen de Stripe (no del navegador), y solo se acepta un cobro con éxito
    // que traiga el id de una licencia de este sitio.
    app.post('/api/admin/payments/stripe/apply', ...adminOnly, adminLimiter, async (req, res) => {
        const paymentIntentId = typeof req.body?.paymentIntentId === 'string' ? req.body.paymentIntentId.trim() : '';
        if (!/^pi_[A-Za-z0-9]{8,80}$/.test(paymentIntentId)) return res.status(400).json({ success: false, error: 'Falta el id del cobro' });
        try {
            const intent = await getStripeClient().paymentIntents.retrieve(paymentIntentId);
            if (intent.status !== 'succeeded' || !intent.metadata?.licenseId) {
                return res.status(409).json({ success: false, error: 'Ese cobro no está completado o no pertenece a una licencia de este sitio.' });
            }
            if (!(await db.findById(intent.metadata.licenseId))) {
                return res.status(409).json({ success: false, error: 'La licencia de este cobro ya no existe.' });
            }
            const result = await applyApprovedStripePaymentIfNew({
                licenseId: intent.metadata.licenseId, planType: intent.metadata.planType || undefined,
                diceTier: intent.metadata.diceTier || undefined, spotifyAddon: intent.metadata.spotifyAddon === 'true',
                stripePaymentId: intent.id,
            });
            audit(req, 'payment.apply_stripe', { id: intent.metadata.licenseId }, { paymentIntentId: intent.id, applied: !!result.applied, alreadyProcessed: !!result.alreadyProcessed });
            res.json({ success: true, applied: !!result.applied, alreadyProcessed: !!result.alreadyProcessed });
        } catch (err) {
            console.error('[Pagos] No se pudo aplicar un cobro de Stripe:', err.message);
            res.status(502).json({ success: false, error: 'No se pudo aplicar el cobro. Intenta de nuevo en un momento.' });
        }
    });
}

module.exports = { registerSystemRoutes };
