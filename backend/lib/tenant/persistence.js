// Ajustes guardados en la base de datos (tema, overlays, Spotify, TTS, Objetivo).
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT,
} = require('../../lib/tenantHelpers');
const {
    VALID_THEME_STYLES,
    VALID_THEME_ACCENTS,
    sanitizeHexColor,
    sanitizeUsernameOverrides,
    sanitizeOverlayCustomization,
} = require('../../lib/tenantSanitizers');

module.exports = {
    // ==========================================
    // AJUSTES PERSISTIDOS (tema, personalización de overlays, Spotify, TTS)
    // ==========================================
    // Se llama una sola vez por Tenant (ver attachSocket, que SÍ espera a
    // que esto termine antes de sincronizar al cliente que se conectó —
    // a diferencia de loadAlertConfigs, acá sí importa: si el cliente
    // llegara a ver los valores de fábrica un instante y el streamer
    // tocara algo en ESE instante, se guardaría por encima del ajuste
    // real). Cualquier campo que falte o venga inválido en la fila de la
    // licencia se queda con el default que ya trae el constructor —
    // idéntico criterio que sanitizeOverlayCustomization/set_theme, nunca
    // confía ciegamente en lo que haya en la DB.
    async loadPersistedSettings() {
        if (this.settingsLoaded) return;
        this.settingsLoaded = true;
        try {
            const license = await db.findById(this.licenseId);
            if (!license) return;
            this.licenseLabel = license.username || null;

            if (license.theme_settings) {
                const t = license.theme_settings;
                this.theme = {
                    style: VALID_THEME_STYLES.includes(t.style) ? t.style : this.theme.style,
                    accent: VALID_THEME_ACCENTS.includes(t.accent) ? t.accent : this.theme.accent,
                    customColor: sanitizeHexColor(t.customColor, this.theme.customColor),
                };
            }
            if (license.overlay_customization) {
                this.overlayCustomization = sanitizeOverlayCustomization(license.overlay_customization);
            }
            if (license.spotify_settings) {
                const s = license.spotify_settings;
                this.spotifySettings = {
                    enabled: s.enabled !== undefined ? Boolean(s.enabled) : this.spotifySettings.enabled,
                    allUsers: Boolean(s.allUsers),
                    moderators: s.moderators !== undefined ? Boolean(s.moderators) : this.spotifySettings.moderators,
                    fanMembers: Boolean(s.fanMembers),
                    minFanLevel: Math.max(1, Math.min(50, Number(s.minFanLevel) || 1)),
                    maxQueueSize: Math.max(1, Math.min(20, Number(s.maxQueueSize) || SPOTIFY_QUEUE_DISPLAY_SIZE_DEFAULT)),
                };
            }
            if (license.tts_settings) {
                const tt = license.tts_settings;
                this.ttsSettings = {
                    allUsers: Boolean(tt.allUsers),
                    moderators: tt.moderators !== undefined ? Boolean(tt.moderators) : this.ttsSettings.moderators,
                    superFans: tt.superFans !== undefined ? Boolean(tt.superFans) : this.ttsSettings.superFans,
                    fanMembers: tt.fanMembers !== undefined ? Boolean(tt.fanMembers) : this.ttsSettings.fanMembers,
                    minFanLevel: Math.max(1, Math.min(50, Number(tt.minFanLevel) || 1)),
                    usernameOverrides: sanitizeUsernameOverrides(tt.usernameOverrides),
                };
            }
            if (license.goal_progress && !this.goalState.isActive) {
                const gp = license.goal_progress;
                const targetType = gp.targetType === 'followers' ? 'followers' : 'coins';
                const cap = targetType === 'coins' ? 10_000_000 : 1_000_000;
                const target = Math.max(1, Math.min(cap, Math.round(Number(gp.target)) || 1));
                if (gp.isActive) {
                    this.goalState = {
                        isActive: true,
                        finished: !!gp.finished,
                        targetType,
                        target,
                        current: Math.max(0, Math.min(target, Math.round(Number(gp.current)) || 0)),
                        title: typeof gp.title === 'string' ? gp.title.slice(0, 60) : '',
                    };
                    console.log(`[${this.logId}] [OBJETIVO] Progreso restaurado tras el reinicio: ${this.goalState.current}/${this.goalState.target}.`);
                }
            }
            // Juegos activos, rankings y cola de Spotify de antes del reinicio
            // (ver runtimeState.js): restaurados en pausa.
            if (license.runtime_state) this.restoreRuntimeState(license.runtime_state);
            if (license.goal_settings) {
                const gs = license.goal_settings;
                this.goalAudioUrl = typeof gs.audioUrl === 'string' ? gs.audioUrl : null;
                this.goalAudioPath = typeof gs.audioPath === 'string' ? gs.audioPath : null;
            }
        } catch (err) {
            console.error(`[${this.logId}] No se pudieron cargar los ajustes guardados:`, err.message);
        }
    },
};
