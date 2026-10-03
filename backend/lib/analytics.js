// Analítica propia, sin cookies (decisión del dueño: nada de terceros ni de
// consentimiento extra). Qué se guarda y qué NO:
//  - visitas por día y por página (solo las páginas públicas del sitio, ver
//    sitePages.js: nada de URLs con datos, nunca la de un overlay);
//  - de qué sitio llegó la visita, solo el nombre del dominio;
//  - una huella diaria por visitante para contar visitantes únicos: un hash
//    de la IP y el navegador con una sal que cambia cada día y se deriva de
//    un secreto del servidor. No se guarda la IP, y la huella de hoy no se
//    puede relacionar con la de ayer.
// Quien manda "Do Not Track" o "Global Privacy Control" no se cuenta.
const crypto = require('crypto');
const { isKnownPage } = require('./sitePages');

function dayKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}

// Solo la ruta de una página conocida, sin consulta ni fragmento.
function cleanPath(raw) {
    if (typeof raw !== 'string' || raw.length > 120) return null;
    const path = raw.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, '') || '/';
    return isKnownPage(path) ? path : null;
}

// Dominio de donde llegó la visita (sin ruta ni consulta). Las visitas desde
// el propio sitio no son un "origen".
function referrerSource(raw, ownHost) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
        if (!host || host === String(ownHost || '').replace(/^www\./, '').toLowerCase()) return null;
        return host.slice(0, 80);
    } catch {
        return null;
    }
}

function visitorHash({ ip, userAgent, day, secret }) {
    const salt = crypto.createHmac('sha256', String(secret)).update(`analytics:${day}`).digest();
    return crypto.createHmac('sha256', salt).update(`${ip}|${userAgent || ''}`).digest('base64url').slice(0, 22);
}

function optedOut(headers = {}) {
    return headers.dnt === '1' || headers['sec-gpc'] === '1';
}

module.exports = { dayKey, cleanPath, referrerSource, visitorHash, optedOut };
