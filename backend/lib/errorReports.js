// Reportes de errores para el admin: recoge lo que falla en las pantallas de
// los streamers (incluidos los overlays de OBS), en el servidor y las
// violaciones de la política de seguridad de contenido, y lo guarda AGRUPADO
// por "huella" (el mismo error repetido mil veces es una fila con un contador,
// no mil filas). Nada de lo que llega se guarda tal cual: el navegador lo manda
// cualquiera, así que se limpia, se recorta y se le quitan claves y tokens.

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX = { message: 300, stack: 2000, context: 160, userAgent: 160 };
const SOURCES = new Set(['frontend', 'backend', 'csp']);
const KINDS = new Set(['render', 'error', 'promise', 'csp', 'exception', 'rejection', 'http']);

// Lo que jamás debe quedar guardado, aunque un mensaje de error lo arrastre por
// accidente: el token de un overlay, un JWT, una clave de licencia, una cabecera
// Bearer o un ?key=... dentro de una URL.
const REDACTIONS = [
    [/\bovl\.[\w-]{1,64}\.[\w-]{8,}/g, 'ovl.[oculto]'],
    [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[jwt oculto]'],
    [/(\bBearer\s+)[\w.~+/-]{8,}/gi, '$1[oculto]'],
    [/([?&#](?:key|token|licenseKey|access_token|refresh_token|code|state|secret)=)[^&\s"')]+/gi, '$1[oculto]'],
    [/\b\w{1,40}-(?:FREE7DAY|daily|weekly|monthly|yearly|lifetime|ADMIN)-[A-Za-z0-9_-]{8,}\b/gi, '[clave oculta]'],
];

function redact(text) {
    let out = String(text ?? '');
    for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
    return out;
}

// Quita los caracteres de control (así nadie falsifica líneas del registro ni
// rompe la tabla del panel), redacta y recorta.
function clean(text, max, { keepNewlines = false } = {}) {
    // eslint-disable-next-line no-control-regex
    const controls = keepNewlines ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g : /[\x00-\x1f\x7f]+/g;
    const out = redact(text).replace(controls, keepNewlines ? '' : ' ').trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

// Una URL sin su query ni su fragmento (pueden llevar claves o tokens): solo
// origen y ruta. "inline", "eval" y demás valores que no son URL se dejan igual.
function stripUrl(value) {
    const text = String(value ?? '');
    if (/^data:/i.test(text)) return 'data:';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text.split(/[?#]/)[0];
    try {
        const url = new URL(text);
        return `${url.origin}${url.pathname}`;
    } catch {
        return text.split(/[?#]/)[0];
    }
}

function hostOf(value) {
    try { return new URL(String(value)).host || ''; } catch { return ''; }
}

// Lo que hace "igual" a dos errores: mismo origen y tipo, mismo mensaje sin
// números ni identificadores, y el mismo archivo donde ocurrió (sin el hash que
// Vite le pone al nombre en cada compilación).
function normalizeMessage(message) {
    return String(message)
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
        .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
        .replace(/\d+/g, 'N')
        .toLowerCase();
}

function topFrame(stack) {
    const line = String(stack || '').split('\n').map((l) => l.trim()).find((l) => /^at\s|@/.test(l) && /:\d+/.test(l));
    if (!line) return '';
    const file = /([^/\\()\s@]+?)(?::\d+)+\)?$/.exec(line);
    return file ? file[1].replace(/-[A-Za-z0-9_-]{6,}(?=\.\w+$)/, '-*') : '';
}

function fingerprintOf({ source, kind, message, stack }) {
    return crypto.createHash('sha1').update(`${source}|${kind}|${normalizeMessage(message)}|${topFrame(stack)}`).digest('hex').slice(0, 24);
}

// Convierte lo que llega (o se captura) en un reporte limpio, o null si no sirve.
function sanitizeReport(raw, { source }) {
    if (!raw || typeof raw !== 'object' || !SOURCES.has(source)) return null;
    const kind = KINDS.has(raw.kind) ? raw.kind : (source === 'csp' ? 'csp' : 'error');
    const message = clean(raw.message, MAX.message);
    if (!message) return null;
    const stack = raw.stack ? clean(raw.stack, MAX.stack, { keepNewlines: true }) : '';
    const context = clean(stripUrl(raw.context), MAX.context);
    const userAgent = clean(raw.userAgent, MAX.userAgent);
    return {
        source, kind, message,
        stack: stack || null,
        context: context || null,
        userAgent: userAgent || null,
        fingerprint: fingerprintOf({ source, kind, message, stack }),
    };
}

// Una violación de la política de seguridad de contenido (CSP) que el navegador
// manda por su cuenta (report-uri): el formato viejo trae { "csp-report": {...} }.
function cspReportToRaw(body) {
    // El formato moderno (Reporting API) llega como una lista: [{ type, body }].
    const single = Array.isArray(body) ? body[0]?.body : body;
    const report = (single && typeof single === 'object' && (single['csp-report'] || single)) || {};
    const directive = clean(report['effective-directive'] || report['violated-directive'] || report.effectiveDirective || '', 60) || 'una directiva';
    const blockedRaw = report['blocked-uri'] ?? report.blockedURL ?? report.blockedURI ?? '';
    const blocked = stripUrl(blockedRaw) || 'un recurso';
    const shown = hostOf(blocked) || blocked;
    const enforced = report.disposition === 'enforce';
    const file = stripUrl(report['source-file'] || report.sourceFile || '');
    const line = Number(report['line-number'] ?? report.lineNumber) || 0;
    return {
        kind: 'csp',
        message: `${directive} ${enforced ? 'bloqueó' : 'habría bloqueado'} ${shown}`,
        context: report['document-uri'] || report.documentURL || '',
        stack: file ? `at ${file}${line ? `:${line}` : ''}` : '',
    };
}

// Guarda los reportes sin poder tumbar nada: acota cuántos escribe por minuto
// (un error en bucle en miles de pantallas no puede inundar la base de datos),
// junta las ráfagas de una misma huella en una sola escritura y nunca lanza.
function createErrorReporter({ db, now = Date.now, perMinute = 60, coalesceMs = 5000, maxRows = 500, retentionMs = 30 * DAY_MS, pruneEvery = 100 }) {
    let windowStart = 0;
    let windowCount = 0;
    let dropped = 0;
    let written = 0;
    const recent = new Map(); // huella -> { at, pending }

    async function record(raw, { source, licenseId = null } = {}) {
        try {
            const report = sanitizeReport(raw, { source });
            if (!report) return false;
            const t = now();
            const last = recent.get(report.fingerprint);
            if (last && t - last.at < coalesceMs) { last.pending++; return true; } // se cuenta al próximo guardado
            if (t - windowStart >= 60 * 1000) { windowStart = t; windowCount = 0; }
            if (windowCount >= perMinute) { dropped++; return false; }
            windowCount++;
            const increment = 1 + (last ? last.pending : 0);
            recent.delete(report.fingerprint);
            recent.set(report.fingerprint, { at: t, pending: 0 });
            if (recent.size > 2000) for (const key of recent.keys()) { recent.delete(key); if (recent.size <= 1500) break; }
            await db.upsertErrorReport({ ...report, licenseId, increment, at: t });
            written++;
            if (written % pruneEvery === 0) await db.pruneErrorReports({ olderThan: t - retentionMs, maxRows });
            return true;
        } catch (err) {
            console.error('[Errores] No se pudo registrar un reporte:', err.message);
            return false;
        }
    }

    return { record, stats: () => ({ written, dropped }) };
}

module.exports = {
    redact, clean, stripUrl, fingerprintOf, sanitizeReport, cspReportToRaw, createErrorReporter,
    MAX, DAY_MS,
};
