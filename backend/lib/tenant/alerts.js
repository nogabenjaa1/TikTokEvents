// Alertas de regalos/eventos: configuración, disparo y combos.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    applyAlertTextTemplate,
} = require('../../lib/tenantHelpers');
const { giftNameKey } = require('../../lib/giftCatalog');

module.exports = {
    // ==========================================
    // LÓGICA: ALERTAS DE REGALOS
    // ==========================================
    // Se llama una sola vez (ver attachSocket) — sin await ahí a propósito,
    // no tiene sentido bloquear la sincronización del resto del panel por
    // esto. Ventana mínima real: un regalo que llegue en los primeros
    // milisegundos de la primera conexión podría no disparar su alerta
    // todavía si la consulta a la DB no terminó — aceptable, mismo criterio
    // que otras esperas cortas ya existentes en este archivo.
    async loadAlertConfigs() {
        if (this.alertConfigsLoaded) return;
        this.alertConfigsLoaded = true;
        try {
            const rows = await db.listAlertConfigs(this.licenseId);
            rows.forEach((row) => {
                this.alertConfigs[row.gift_name.toLowerCase()] = {
                    id: row.id, giftName: row.gift_name,
                    visualUrl: row.visual_url, visualType: row.visual_type, visualMuted: !!row.visual_muted,
                    audioUrl: row.audio_url,
                    text: row.alert_text || '', textPosition: row.text_position || 'below', textColor: row.text_color || null,
                    giftId: row.gift_id || null,
                    durationMs: row.duration_ms, position: row.position,
                    entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
                    minCoins: row.min_coins != null ? Number(row.min_coins) : null,
                };
            });
        } catch (err) {
            console.error(`[${this.logId}] [ALERTAS] No se pudieron cargar las alertas guardadas:`, err.message);
        }
    },

    // Llamados desde server.js justo después de guardar/borrar en la DB —
    // mantienen este cache en memoria al día sin tener que releer todo.
    setAlertConfig(giftName, alertData) {
        this.alertConfigs[giftName.toLowerCase()] = alertData;
    },

    removeAlertConfig(giftName) {
        delete this.alertConfigs[giftName.toLowerCase()];
    },

    // La alerta de un regalo se guarda con el nombre tal como lo mostró el
    // selector; el evento en vivo puede traerlo con otra capitalización, con
    // acentos distintos o con espacios de más. Primero la coincidencia exacta
    // (la de siempre) y, si no hay, una comparación sin eso.
    // Antes que el nombre se busca el id del regalo: el catálogo sale de una
    // librería y el evento en vivo de otra, y no siempre nombran igual al
    // mismo regalo, pero su id de TikTok sí es el mismo.
    findAlertConfig(key, giftId) {
        if (giftId !== undefined && giftId !== null && giftId !== '') {
            const wanted = String(giftId);
            for (const config of Object.values(this.alertConfigs)) {
                if (config.minCoins == null && config.giftId && String(config.giftId) === wanted) return config;
            }
        }
        const exact = this.alertConfigs[String(key).toLowerCase()];
        if (exact) return exact;
        const wanted = giftNameKey(key);
        if (!wanted) return null;
        for (const [configKey, config] of Object.entries(this.alertConfigs)) {
            if (config.minCoins == null && giftNameKey(configKey) === wanted) return config;
        }
        return null;
    },

    // Avisa al panel si hay (o no) un overlay de alertas abierto: con uno
    // conectado, el sonido lo pone él (OBS) y el panel no debe repetirlo.
    emitAlertOverlayStatus() {
        this.broadcast.emit('alerts_overlay_status', { connected: this.alertOverlaySockets.size > 0, count: this.alertOverlaySockets.size });
    },

    // Cada evento completo se emite inmediatamente con sus propios datos.
    // El cliente serializa la reproducción; aquí no se agrupan donadores
    // ni se espera silencio antes de mostrar regalos, follows u otros eventos.
    processAlertTrigger({ username, nickname, key: triggerKey, giftId, repeatCount, giftName, coins, allowGlobalFallback = false }) {
        if (!triggerKey || triggerKey.startsWith('__draft_gift__:')) return;
        let alert = this.findAlertConfig(triggerKey, giftId);
        if (!alert && allowGlobalFallback) alert = this.findGlobalAlertForCoins(coins);
        if (!alert) return;
        const count = Math.max(1, repeatCount || 1);
        this.broadcast.emit('alert_triggered', {
            triggerId: ++this.alertTriggerCounter,
            visualUrl: alert.visualUrl,
            visualType: alert.visualType,
            visualMuted: alert.visualMuted,
            audioUrl: alert.audioUrl,
            text: applyAlertTextTemplate(alert.text, {
                username: username || '', nickname: nickname || username || '',
                gift: giftName || '', coins: coins || 0, count,
            }),
            textPosition: alert.textPosition,
            textColor: alert.textColor || null,
            durationMs: alert.durationMs,
            position: alert.position,
            entranceAnim: alert.entranceAnim,
            exitAnim: alert.exitAnim,
            count,
        });
    },

    // Alerta GENERAL de mayor mínimo que el regalo todavía alcance (pedido
    // explícito: varias alertas globales por nivel, ej. una desde 1 moneda
    // y otra separada desde 500) -- `minCoins` solo existe en las filas
    // 'gift_global' (ver loadAlertConfigs/setAlertConfig), así que filtrar
    // por `minCoins != null` alcanza para no confundirlas con alertas
    // específicas o de follow/sticker. Se elige la de mínimo MÁS ALTO entre
    // las que el regalo alcanza (no la primera que matchee) para que un
    // regalo caro dispare su propio nivel "premium" en vez del genérico más
    // bajo si el streamer configuró varios escalones.
    findGlobalAlertForCoins(coins) {
        const value = Number(coins) || 0;
        let best = null;
        for (const alert of Object.values(this.alertConfigs)) {
            if (alert.minCoins == null || value < alert.minCoins) continue;
            if (!best || alert.minCoins > best.minCoins) best = alert;
        }
        return best;
    },

    // Disparo manual desde el panel (botón "🔥 Probar", ver AlertsAdmin.jsx)
    // -- entra en la misma cola de reproducción que los eventos LIVE. Usa el
    // 'alert_triggered' que ve el overlay de OBS Y el propio panel del
    // streamer (mismo room, ver attachSocket) -- así el streamer confirma
    // en vivo que la alerta suena/se ve bien sin depender de estar mirando
    // OBS en ese momento. No hay un espectador real disparándola, así que
    // los tags se rellenan con datos de prueba obvios (ver
    // applyAlertTextTemplate) en vez de dejarlos literales sin reemplazar.
    testFireAlert(alertId) {
        const alert = Object.values(this.alertConfigs).find((a) => a.id === alertId);
        if (!alert) return;
        // Una alerta general no tiene un regalo fijo -- `giftName` acá es la
        // clave interna ("global:100"), no algo presentable, así que la
        // prueba usa un nombre de regalo genérico y una cantidad de monedas
        // que respete su propio mínimo (en vez del fijo 100 de siempre, que
        // podría quedar por debajo del mínimo configurado y confundir).
        const isGlobal = alert.minCoins != null;
        this.broadcast.emit('alert_triggered', {
            triggerId: ++this.alertTriggerCounter,
            visualUrl: alert.visualUrl,
            visualType: alert.visualType,
            visualMuted: alert.visualMuted,
            audioUrl: alert.audioUrl,
            text: applyAlertTextTemplate(alert.text, {
                username: 'usuario_de_prueba', nickname: 'Usuario de Prueba',
                gift: isGlobal || alert.giftName?.startsWith('__draft_gift__:') ? 'Regalo' : (alert.giftName || 'Regalo'),
                coins: isGlobal ? Math.max(100, alert.minCoins) : 100, count: 1,
            }),
            textPosition: alert.textPosition,
            textColor: alert.textColor || null,
            durationMs: alert.durationMs,
            position: alert.position,
            entranceAnim: alert.entranceAnim,
            exitAnim: alert.exitAnim,
            count: 1,
        });
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerAlertHandlers(socket) {
        // Presencia del overlay de alertas: el overlay de OBS se autentica con
        // su token (o la clave, en los enlaces anteriores) y se declara con
        // `overlayScreen: 'alerts'` (ver auth.js del frontend). Al panel que se
        // conecta se le dice cómo está ahora.
        const declaredScreen = socket.handshake?.auth?.overlayScreen;
        const isOverlaySocket = socket.authMethod === 'key' || socket.authMethod === 'overlay';
        if (isOverlaySocket && declaredScreen === 'alerts') {
            this.alertOverlaySockets.add(socket.id);
            this.emitAlertOverlayStatus();
            socket.on('disconnect', () => {
                this.alertOverlaySockets.delete(socket.id);
                this.emitAlertOverlayStatus();
            });
        } else {
            socket.emit('alerts_overlay_status', { connected: this.alertOverlaySockets.size > 0, count: this.alertOverlaySockets.size });
        }

        // Un overlay con token de solo lectura no dispara nada.
        if (socket.authMethod === 'overlay') return;

        // Botón "🔥 Probar" del panel de Alertas (ver AlertsAdmin.jsx) —
        // dispara la alerta real, id de por medio, sin esperar ningún
        // evento de TikTok.
        socket.on('test_alert', (alertId) => {
            if (typeof alertId === 'string' && alertId) this.testFireAlert(alertId);
        });
    },
};
