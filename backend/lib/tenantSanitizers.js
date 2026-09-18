// Validación/normalización de lo que manda el cliente por socket (tema,
// personalización de overlays, lista blanca/negra de TTS). Se movió acá tal
// cual estaba en tenant.js, sin cambios de lógica.

// Espejo del catálogo de frontend/src/ThemeContext.jsx: valida lo que manda
// el cliente antes de guardarlo/emitirlo, para que un socket manipulado a
// mano no pueda meter un valor arbitrario en --theme-style/--accent.
const VALID_THEME_STYLES = ['default', 'cute'];
const VALID_THEME_ACCENTS = ['purple', 'blue', 'pink', 'custom'];

// Espejo de frontend/src/overlayCustomization.js: qué overlays se pueden
// personalizar (fondo + color de nombre de usuario) desde la pestaña
// Overlays, y qué valores son válidos para cada campo — mismo criterio que
// VALID_THEME_STYLES/VALID_THEME_ACCENTS, para que un socket manipulado a
// mano no pueda meter un `background` con CSS arbitrario.
const OVERLAY_CUSTOMIZE_IDS = ['games', 'colors', 'taptap', 'gifter', 'extensible', 'musicqueue', 'alerts', 'goal', 'chat'];
const VALID_BG_TYPES = ['transparent', 'solid', 'gradient', 'rainbow'];
const VALID_USERNAME_COLOR_TYPES = ['default', 'theme', 'custom', 'gradient', 'rainbow'];
const VALID_FONT_SIZES = ['normal', 'large', 'xlarge'];
// Animación de entrada de cada mensaje nuevo en el overlay de Chat (pedido
// explícito) -- solo lo usa ese overlay, pero vive en el mismo `entry`
// genérico que el resto (ver defaultEntry en overlayCustomization.js).
const VALID_MESSAGE_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'bounce'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeHexColor(value, fallback) {
    return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

// Lista blanca/negra del TTS por @usuario de TikTok (pedido explícito): un
// usuario en modo 'enabled' se lee SIEMPRE aunque no cumpla ningún filtro de
// abajo (moderador/Super Fan/nivel de fan), uno en 'disabled' NUNCA se lee
// aunque los cumpla todos -- ver isAuthorizedForTts en TtsChat.jsx, donde se
// aplica antes que el resto de los criterios. Se normaliza a minúsculas y
// sin '@' acá mismo al guardar, para que la comparación en el navegador sea
// directa contra el `uniqueId` tal cual lo manda TikTok (ver
// handleChatEvent), sin tener que renormalizar en cada mensaje de chat.
const TTS_OVERRIDE_MODES = ['enabled', 'disabled'];
const TTS_OVERRIDES_MAX = 200;

function sanitizeUsernameOverrides(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const username = typeof entry?.username === 'string' ? entry.username.trim().replace(/^@/, '').toLowerCase().slice(0, 50) : '';
        const mode = TTS_OVERRIDE_MODES.includes(entry?.mode) ? entry.mode : null;
        if (!username || !mode || seen.has(username)) continue;
        seen.add(username);
        out.push({ username, mode });
        if (out.length >= TTS_OVERRIDES_MAX) break;
    }
    return out;
}

// Sanea el mapa completo que manda el panel (ver set_overlay_customization
// más abajo) — cualquier id/campo inválido o faltante cae al default en vez
// de rechazar todo el mensaje, para que un solo overlay mal formado no tire
// abajo la personalización de los demás.
function sanitizeOverlayCustomization(raw) {
    const out = {};
    for (const id of OVERLAY_CUSTOMIZE_IDS) {
        const entry = raw?.[id] || {};
        const bg = entry.background || {};
        const uc = entry.usernameColor || {};
        out[id] = {
            background: {
                type: VALID_BG_TYPES.includes(bg.type) ? bg.type : 'solid',
                from: sanitizeHexColor(bg.from, '#7C3AED'),
                to: sanitizeHexColor(bg.to, '#3B82F6'),
            },
            usernameColor: {
                type: VALID_USERNAME_COLOR_TYPES.includes(uc.type) ? uc.type : 'default',
                color: sanitizeHexColor(uc.color, '#FFFFFF'),
                from: sanitizeHexColor(uc.from, '#7C3AED'),
                to: sanitizeHexColor(uc.to, '#3B82F6'),
                fontSize: VALID_FONT_SIZES.includes(uc.fontSize) ? uc.fontSize : 'normal',
            },
            messageAnimation: VALID_MESSAGE_ANIMATIONS.includes(entry.messageAnimation) ? entry.messageAnimation : 'fade',
            // Volumen general de las Alertas (pedido explícito) -- el resto
            // de los overlays lo ignora sin problema, mismo criterio que
            // messageAnimation con el Chat.
            volume: typeof entry.volume === 'number' && entry.volume >= 0 && entry.volume <= 1 ? entry.volume : 1,
            // Switch de bordes por overlay (pedido explícito) -- encendido
            // por defecto, ver bordersEnabled en overlayCustomization.js.
            borders: typeof entry.borders === 'boolean' ? entry.borders : true,
        };
    }
    return out;
}

module.exports = {
    VALID_THEME_STYLES,
    VALID_THEME_ACCENTS,
    OVERLAY_CUSTOMIZE_IDS,
    VALID_BG_TYPES,
    VALID_USERNAME_COLOR_TYPES,
    VALID_FONT_SIZES,
    VALID_MESSAGE_ANIMATIONS,
    HEX_COLOR_RE,
    sanitizeHexColor,
    TTS_OVERRIDE_MODES,
    TTS_OVERRIDES_MAX,
    sanitizeUsernameOverrides,
    sanitizeOverlayCustomization,
};
