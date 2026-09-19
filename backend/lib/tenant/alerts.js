// Alertas de regalos/eventos: configuración, disparo y combos.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const db = require('../../db');
const {
    ALERT_COMBO_SETTLE_MS,
    applyAlertTextTemplate,
} = require('../../lib/tenantHelpers');

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
                    durationMs: row.duration_ms, position: row.position,
                    entranceAnim: row.entrance_anim, exitAnim: row.exit_anim,
                    minCoins: row.min_coins != null ? Number(row.min_coins) : null,
                };
            });
        } catch (err) {
            console.error(`[${this.licenseId}] [ALERTAS] No se pudieron cargar las alertas guardadas:`, err.message);
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

    // Un regalo puede combo-ear (repeatCount > 1) sin que eso deba disparar
    // la alerta varias veces seguidas — handleGiftEvent ya esperó a que
    // termine el combo NATIVO de TikTok, pero un espectador puede además
    // mandar el mismo regalo varias veces seguidas como envíos SEPARADOS
    // (sin ser un combo de TikTok) — acá se agrupan esos también, por
    // persona+disparador, con el mismo mecanismo de asentamiento que Top
    // Tap-Tap (ver ALERT_COMBO_SETTLE_MS/settleAlertCombo): nunca se
    // apilan dos alertas del mismo disparador+persona, se combinan en una
    // sola con el total. `key` es el nombre del regalo para triggerType
    // 'gift', o 'follow'/'sticker' para los demas (ver
    // handleSocialEvent/handleEmoteEvent mas abajo y NON_GIFT_TRIGGER_TYPES
    // en server.js) -- mismo mapa `alertConfigs`, sin distinguir el tipo,
    // porque un regalo real de TikTok jamas se llama literal "follow".
    // `allowGlobalFallback` (pedido explícito: "alertas globales" además de
    // las específicas) -- solo tiene sentido para regalos de verdad (nunca
    // para 'follow'/'sticker', que no mueven monedas): si NO hay una alerta
    // específica para este triggerKey, busca la alerta general de mayor
    // mínimo que el regalo todavía alcance (ver findGlobalAlertForCoins).
    // Las dos categorías nunca se pisan entre sí -- una alerta específica
    // encontrada acá arriba corta la búsqueda antes de siquiera mirar las
    // generales.
    processAlertTrigger({ username, nickname, key: triggerKey, repeatCount, giftName, coins, allowGlobalFallback = false }) {
        if (!triggerKey) return;
        let alert = this.alertConfigs[triggerKey.toLowerCase()];
        if (!alert && allowGlobalFallback) alert = this.findGlobalAlertForCoins(coins);
        if (!alert) return;
        const comboKey = `${username || ''}:${triggerKey.toLowerCase()}`;
        const units = Math.max(1, repeatCount || 1);
        const pending = this.pendingAlertCombos[comboKey];
        if (pending) {
            pending.count += units;
            // Pedido explicito ({coins} en el texto): si el mismo
            // regalo+persona llega en varios envios separados antes de
            // asentarse (ver el comentario de arriba), {coins} tiene que
            // reflejar el TOTAL acumulado, igual que ya hace `count`.
            pending.coins += coins || 0;
            clearTimeout(pending.timer);
        } else {
            this.pendingAlertCombos[comboKey] = {
                alert, count: units, coins: coins || 0,
                username: username || '', nickname: nickname || username || '', giftName: giftName || '',
                timer: null,
            };
        }
        this.pendingAlertCombos[comboKey].timer = setTimeout(() => this.settleAlertCombo(comboKey), ALERT_COMBO_SETTLE_MS);
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

    // El combo terminó (silencio de ALERT_COMBO_SETTLE_MS): recién acá se
    // dispara la alerta, ya con el total acumulado en `count` — el overlay
    // (ver AlertOverlay en Overlay.jsx) muestra "×N" cuando count > 1.
    settleAlertCombo(key) {
        const pending = this.pendingAlertCombos[key];
        if (!pending) return;
        delete this.pendingAlertCombos[key];
        this.broadcast.emit('alert_triggered', {
            triggerId: ++this.alertTriggerCounter,
            visualUrl: pending.alert.visualUrl,
            visualType: pending.alert.visualType,
            visualMuted: pending.alert.visualMuted,
            audioUrl: pending.alert.audioUrl,
            // Pedido explicito: tags {username}/{nickname}/{gift}/{coins}/
            // {count} en el texto de la alerta -- se sustituyen ACÁ, recién
            // al disparar de verdad (con el total ya asentado del combo),
            // nunca en el texto guardado en la DB (ese se queda con el
            // template literal, ver AlertsAdmin.jsx).
            text: applyAlertTextTemplate(pending.alert.text, {
                username: pending.username, nickname: pending.nickname,
                gift: pending.giftName, coins: pending.coins, count: pending.count,
            }),
            textPosition: pending.alert.textPosition,
            textColor: pending.alert.textColor || null,
            durationMs: pending.alert.durationMs,
            position: pending.alert.position,
            entranceAnim: pending.alert.entranceAnim,
            exitAnim: pending.alert.exitAnim,
            count: pending.count,
        });
    },

    // Disparo manual desde el panel (botón "🔥 Probar", ver AlertsAdmin.jsx)
    // -- salta la cola de combo (ALERT_COMBO_SETTLE_MS) a propósito: es una
    // prueba puntual, no tiene sentido esperar a "asentarla". Llega al mismo
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
                gift: isGlobal ? 'Regalo' : (alert.giftName || 'Regalo'),
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
        // Botón "🔥 Probar" del panel de Alertas (ver AlertsAdmin.jsx) —
        // dispara la alerta real, id de por medio, sin esperar ningún
        // evento de TikTok.
        socket.on('test_alert', (alertId) => {
            if (typeof alertId === 'string' && alertId) this.testFireAlert(alertId);
        });
    },
};
