// ==========================================
// CIFRADO DE TOKENS SENSIBLES EN REPOSO (Spotify access_token/refresh_token
// por ahora). Pedido explícito tras una revisión de seguridad: si la base
// de datos alguna vez se filtra, estos tokens dejan de servir para nada sin
// TOKEN_ENCRYPTION_KEY (que vive solo en las variables de entorno del
// backend, nunca en la DB).
//
// AES-256-GCM: cifrado autenticado -- si alguien modifica el texto cifrado
// a mano, decrypt() falla en vez de devolver basura silenciosamente.
//
// Formato de salida: "enc:v1:<iv-base64>:<authTag-base64>:<datos-base64>".
// El prefijo "enc:v1:" es lo que permite distinguir un valor YA cifrado de
// uno legado en texto plano (cuentas de Spotify conectadas ANTES de este
// cambio) -- decrypt() devuelve el valor tal cual si no tiene el prefijo,
// así ninguna cuenta existente se rompe. La próxima vez que esa cuenta
// refresque su access_token (automático, ver spotify.getValidAccessToken)
// va a quedar cifrada de una, sin necesidad de una migración aparte.
// ==========================================
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey() {
    const raw = process.env.TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error('Falta TOKEN_ENCRYPTION_KEY en las variables de entorno (backend/.env) -- generar con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) {
        throw new Error('TOKEN_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres) -- generar con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return key;
}

function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return plaintext;
    const key = getKey();
    const iv = crypto.randomBytes(12); // 96 bits, el tamaño recomendado para GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return PREFIX + [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

// Legado: si el valor no tiene el prefijo "enc:v1:", es texto plano de
// antes de este cambio -- se devuelve tal cual (ver comentario del
// encabezado). Nunca lanza para valores legados, solo para valores QUE SÍ
// dicen ser cifrados pero fallan la verificación de autenticidad de GCM
// (dato corrupto o TOKEN_ENCRYPTION_KEY equivocada).
function decrypt(value) {
    if (value === null || value === undefined) return value;
    if (!value.startsWith(PREFIX)) return value;
    const key = getKey();
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
