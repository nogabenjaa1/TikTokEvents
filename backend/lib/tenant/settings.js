// Ajustes del panel por socket: tema, personalización de overlays y TTS.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    VALID_THEME_STYLES,
    VALID_THEME_ACCENTS,
    sanitizeHexColor,
    sanitizeUsernameOverrides,
    sanitizeOverlayCustomization,
} = require('../../lib/tenantSanitizers');

module.exports = {
    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerSettingsHandlers(socket) {
        // ── TEMA (panel -> overlay) ──────────────────
        // El panel emite esto cada vez que el streamer cambia de skin (y una
        // vez al conectar, para sincronizar el estado inicial). Se reenvía a
        // TODO el room, overlay incluido, así el streamer y su audiencia ven
        // siempre el mismo skin.
        socket.on('set_theme', (theme) => {
            const style = VALID_THEME_STYLES.includes(theme?.style) ? theme.style : this.theme.style;
            const accent = VALID_THEME_ACCENTS.includes(theme?.accent) ? theme.accent : this.theme.accent;
            // Solo importa cuando accent === 'custom' (ver accentStyleVars en
            // ThemeContext.jsx) — igual se guarda siempre para que, si el
            // streamer vuelve a "Personalizado", no arranque del valor por
            // defecto en vez del último que había elegido.
            const customColor = sanitizeHexColor(theme?.customColor, this.theme.customColor || '#7C3AED');
            if (style === this.theme.style && accent === this.theme.accent && customColor === this.theme.customColor) return;
            this.theme = { style, accent, customColor };
            this.broadcast.emit('theme_updated', this.theme);
            // Pedido explícito: que el tema sobreviva a un reinicio del
            // server y a entrar desde otro dispositivo.
            db.setThemeSettings(this.licenseId, this.theme).catch((err) => {
                console.error(`[${this.licenseId}] No se pudo guardar theme_settings:`, err.message);
            });
        });

        // ── PERSONALIZACIÓN DE OVERLAYS (fondo + color de usuario) ──
        // El panel manda el mapa COMPLETO (los 7 overlays configurables,
        // Alertas incluido) cada vez que el streamer toca cualquier control
        // del modal de "Personalizar" — mismo patrón que set_theme: se sanea
        // y se reenvía tal cual a todo el room, overlay de OBS incluido.
        socket.on('set_overlay_customization', (map) => {
            this.overlayCustomization = sanitizeOverlayCustomization(map);
            this.broadcast.emit('overlay_customization_update', this.overlayCustomization);
            // Pedido explícito: que sobreviva a un reinicio del server y a
            // entrar desde otro dispositivo.
            db.setOverlayCustomization(this.licenseId, this.overlayCustomization).catch((err) => {
                console.error(`[${this.licenseId}] No se pudo guardar overlay_customization:`, err.message);
            });
        });

        // ── TTS (quién puede activar una lectura -- ver TtsChat.jsx, que
        // hace TODO lo demás 100% en el navegador del streamer) ──
        // Pedido explícito: que estos filtros no se pierdan al entrar desde
        // otro navegador/computadora -- antes vivían solo en el localStorage
        // de UN navegador puntual, sin pasar nunca por acá.
        socket.on('set_tts_settings', (newSettings) => {
            this.ttsSettings = {
                allUsers: Boolean(newSettings?.allUsers),
                moderators: Boolean(newSettings?.moderators),
                superFans: Boolean(newSettings?.superFans),
                fanMembers: Boolean(newSettings?.fanMembers),
                minFanLevel: Math.max(1, Math.min(50, Number(newSettings?.minFanLevel) || 1)),
                usernameOverrides: sanitizeUsernameOverrides(newSettings?.usernameOverrides),
            };
            this.broadcast.emit('tts_settings_update', this.ttsSettings);
            db.setTtsSettings(this.licenseId, this.ttsSettings).catch((err) => {
                console.error(`[${this.licenseId}] No se pudo guardar tts_settings:`, err.message);
            });
        });
    },
};
