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
const { EVENT_SETTINGS_IDS, sanitizeEventEntry } = require('../../lib/eventSettings');

module.exports = {
    // Guarda los ajustes de eventos en la base de a una escritura a la vez y
    // siempre con lo último que hay en memoria: dos UPDATE en paralelo podían
    // terminar en otro orden y dejar guardada la versión vieja. Devuelve una
    // promesa que se cumple cuando quedó en la base una escritura que empezó
    // DESPUÉS de esta llamada (o sea, que incluye el cambio de quien llama), y
    // se rechaza si esa escritura falla. Los cambios que llegan mientras se
    // escribe comparten la escritura siguiente.
    //
    // Recién cuando quedó en la base se anuncia a la licencia (todas sus
    // pestañas; quien lo mandó lo recibe igual a lo que tiene y no cambia nada)
    // y pasa a ser lo que recibe una pestaña nueva al conectarse. Antes se
    // anunciaba al recibirlo: si la escritura fallaba, las otras pestañas lo
    // tomaban como guardado aunque se perdiera en el siguiente reinicio.
    persistEventSettings() {
        if (!this.eventSettingsQueued) {
            const previous = this.eventSettingsWriting || Promise.resolve();
            this.eventSettingsQueued = previous.then(() => {
                this.eventSettingsQueued = null;
                const snapshot = this.eventSettings;
                const write = db.setEventSettings(this.licenseId, snapshot).then(() => {
                    this.eventSettingsSaved = snapshot;
                    this.broadcast.emit('event_settings_update', snapshot);
                });
                this.eventSettingsWriting = write.then(() => {}, () => {});
                return write;
            });
        }
        return this.eventSettingsQueued;
    },

    // Lo último que se sabe guardado en la base (lo que recibe una pestaña al
    // conectarse). Lo aceptado y todavía sin guardar queda solo en
    // this.eventSettings, para mezclar los cambios siguientes.
    persistedEventSettings() {
        return this.eventSettingsSaved || this.eventSettings;
    },

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
                console.error(`[${this.logId}] No se pudo guardar theme_settings:`, err.message);
            });
        });

        // ── PERSONALIZACIÓN DE OVERLAYS (fondo + color de usuario) ──
        // El panel manda el mapa COMPLETO (los 7 overlays configurables,
        // Alertas incluido) cada vez que el streamer toca cualquier control
        // del modal de "Personalizar" — mismo patrón que set_theme: se sanea
        // y se reenvía tal cual a todo el room, overlay de OBS incluido.
        // ── AJUSTES GUARDADOS DE CADA EVENTO ──
        // El panel manda SOLO lo que cambió ({ king: { mainTime: 30 } }, ver
        // eventSettingsSync.js): se sanea y se mezcla con lo que ya había,
        // evento por evento y campo por campo. Antes llegaba el mapa entero y dos pestañas que
        // cambiaban eventos distintos casi a la vez se pisaban: la segunda
        // borraba lo de la primera sin que nadie se enterara.
        // Solo el panel con sesión: el overlay de OBS nunca configura nada.
        // Nunca toca una partida en curso: estos son los valores con los que
        // se abre el panel, no los de la ronda (esos van por update_*_settings).
        socket.on('set_event_settings', (partial, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            if (socket.authMethod !== 'jwt' || !partial || typeof partial !== 'object' || Array.isArray(partial)) return reply({ ok: false });
            const next = { ...this.eventSettings };
            let changed = false;
            for (const id of EVENT_SETTINGS_IDS) {
                if (!(id in partial)) continue;
                // Campo por campo: llega solo lo que se cambió (ver useEventDraft),
                // y lo demás de ese evento se conserva.
                const raw = partial[id];
                const entry = raw && typeof raw === 'object' && !Array.isArray(raw)
                    ? sanitizeEventEntry(id, { ...(this.eventSettings[id] || {}), ...raw })
                    : null;
                if (!entry) continue;
                next[id] = entry;
                changed = true;
            }
            if (!changed) return reply({ ok: false });
            if (!this.eventSettingsSaved) this.eventSettingsSaved = this.eventSettings;
            this.eventSettings = next;
            // Se confirma recién cuando quedó en la base: antes se confirmaba al
            // recibirlo, y si la escritura fallaba (por ejemplo, sin la columna
            // event_settings) el panel lo daba por guardado y se perdía en el
            // siguiente reinicio del servidor sin que nadie se enterara. Con
            // ok: false el panel lo deja pendiente, lo avisa y lo reintenta.
            const accepted = {};
            for (const id of EVENT_SETTINGS_IDS) if (id in partial && next[id]) accepted[id] = next[id];
            this.persistEventSettings().then(
                () => reply({ ok: true, accepted }),
                (err) => {
                    console.error(`[${this.logId}] No se pudo guardar event_settings:`, err.message);
                    reply({ ok: false, error: 'save_failed' });
                },
            );
        });

        socket.on('set_overlay_customization', (map) => {
            this.overlayCustomization = sanitizeOverlayCustomization(map);
            this.broadcast.emit('overlay_customization_update', this.overlayCustomization);
            // Pedido explícito: que sobreviva a un reinicio del server y a
            // entrar desde otro dispositivo.
            db.setOverlayCustomization(this.licenseId, this.overlayCustomization).catch((err) => {
                console.error(`[${this.logId}] No se pudo guardar overlay_customization:`, err.message);
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
                console.error(`[${this.logId}] No se pudo guardar tts_settings:`, err.message);
            });
        });
    },
};
