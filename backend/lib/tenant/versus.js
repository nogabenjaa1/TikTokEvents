// Modo Versus: héroes contra villanos. A diferencia de los demás juegos no
// tiene timer -- es un marcador por lado que suma las MONEDAS de cada regalo
// que matchea (pedido explícito: "un solo score global que vaya sumando el
// total de valor en coins"; antes cada regalo llevaba su propio contador y
// el overlay mostraba una fila suelta por regalo), con el
// mismo ciclo Iniciar/Pausar/Reanudar/Reiniciar/Detener de siempre (mientras
// está pausado, los regalos no cuentan, mismo criterio que Rey del
// Trono/Zubastinis). Dos listas de configuración INDEPENDIENTES por
// licencia, cada una hasta con su propio tope (ver versus_configs en
// db.js): los regalos que suman a héroes/villanos (la "acción" de texto es
// una por lado, en versusSettings) y, aparte, un vínculo opcional con el modo Extensible
// (héroes/villanos con segundos +/-, hasta 10 de cada lado) que suma/resta
// tiempo a SU timer cuando un regalo vinculado llega. Un mismo regalo puede
// estar en la lista base Y en la de Extensible a la vez (son cosas
// distintas); dentro de la MISMA lista no puede estar de los dos lados.
const crypto = require('crypto');
const db = require('../../db');
const { giftNameKey } = require('../../lib/giftCatalog');
const giftDirectory = require('../giftDirectory');

const BASE_LIST_CAP = 30;
const EXT_LIST_CAP = 10;
const MAX_ACTION_TEXT = 40;
const MAX_SECONDS_DELTA = 7200; // mismo tope que MAX_EXTENSIBLE_BASE_SECONDS en extensible.js
const MAX_ICON_LENGTH = 500;

// Ícono que manda el panel al agregar (sale de SU catálogo en vivo): solo una
// imagen por https, igual que el directorio de regalos.
function cleanIcon(value) {
    return typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= MAX_ICON_LENGTH ? value : null;
}

const emptyScores = () => ({ hero: 0, villain: 0 });

function clampSecondsDelta(value) {
    const n = Math.round(Number(value) || 0);
    return Math.max(-MAX_SECONDS_DELTA, Math.min(MAX_SECONDS_DELTA, n));
}

// Fila de la DB -> forma que usa el resto de este módulo (y que viaja tal
// cual, salvo el ícono agregado en getVersusPublicState, al overlay/panel).
function rowToEntry(row) {
    return {
        id: row.id, giftName: row.gift_name, giftId: row.gift_id || null,
        actionText: row.action_text || '', secondsDelta: row.seconds_delta != null ? Number(row.seconds_delta) : 0,
        savedIcon: row.gift_icon || '',
    };
}

// Mismo criterio que findAlertConfig en lib/tenant/alerts.js: primero el id
// de TikTok (estable entre catálogo y evento en vivo), si no un nombre
// normalizado (sin mayúsculas/acentos/espacios de más).
function findEntry(list, giftName, giftId) {
    if (giftId) {
        const byId = list.find((e) => e.giftId && String(e.giftId) === String(giftId));
        if (byId) return byId;
    }
    const wanted = giftNameKey(giftName);
    if (!wanted) return null;
    return list.find((e) => giftNameKey(e.giftName) === wanted) || null;
}

const KIND_LIST_KEY = { hero: 'heroes', villain: 'villains', ext_hero: 'extHeroes', ext_villain: 'extVillains' };
const KIND_SIBLING = { hero: 'villain', villain: 'hero', ext_hero: 'ext_villain', ext_villain: 'ext_hero' };

module.exports = {
    // ==========================================
    // LÓGICA: MODO VERSUS
    // ==========================================
    // A diferencia de loadAlertConfigs (fire-and-forget, self-corrige solo),
    // esto lo llama loadPersistedSettings en persistence.js y SÍ espera a
    // que termine antes de sincronizar al cliente que se acaba de conectar:
    // heroLabel/villainLabel viajan en el mismo estado que esta lista (ver
    // getVersusPublicState), y esas etiquetas son un ajuste editable con el
    // mismo riesgo de "pisar lo real con el valor de fábrica" que
    // tema/Spotify/TTS (ver el comentario grande en loadPersistedSettings).
    applyVersusConfigRows(rows) {
        rows.forEach((row) => {
            const key = KIND_LIST_KEY[row.kind];
            if (key) this.versusConfigs[key].push(rowToEntry(row));
        });
    },

    // Ícono de cada regalo resuelto contra el directorio GLOBAL (mismo
    // criterio que getGiftTickerSnapshot en lib/tenant/alerts.js) -- el
    // overlay no tiene sesión ni el catálogo en vivo del panel, así que no
    // puede resolverlo por su cuenta. El directorio solo tiene los regalos
    // que ya llegaron en algún directo: si este todavía no, se usa el ícono
    // que guardó el panel al agregarlo (antes se quedaba sin imagen).
    async resolveVersusIcons(list) {
        await giftDirectory.load();
        const gifts = giftDirectory.list();
        return list.map((entry) => {
            let icon = '';
            if (entry.giftId) icon = gifts.find((g) => String(g.id) === String(entry.giftId))?.icon || '';
            if (!icon) {
                const wanted = giftNameKey(entry.giftName);
                icon = (wanted && gifts.find((g) => giftNameKey(g.name) === wanted)?.icon) || '';
            }
            const { savedIcon, ...rest } = entry;
            return { ...rest, giftIcon: icon || savedIcon || '' };
        });
    },

    // La acción de cada lado. Antes era una por regalo: si todavía no se
    // guardó la del lado, se toma la del primer regalo (lo que ya veía el
    // streamer) en vez de dejarla vacía.
    versusSideAction(side) {
        const saved = this.versusSettings[side === 'hero' ? 'heroAction' : 'villainAction'];
        if (typeof saved === 'string') return saved;
        const list = this.versusConfigs[side === 'hero' ? 'heroes' : 'villains'];
        return list.find((e) => e.actionText)?.actionText || '';
    },

    async getVersusPublicState() {
        const scores = this.versusState.scores || emptyScores();
        const [heroes, villains, extHeroes, extVillains] = await Promise.all([
            this.resolveVersusIcons(this.versusConfigs.heroes),
            this.resolveVersusIcons(this.versusConfigs.villains),
            this.resolveVersusIcons(this.versusConfigs.extHeroes),
            this.resolveVersusIcons(this.versusConfigs.extVillains),
        ]);
        return {
            isActive: this.versusState.isActive, paused: this.versusState.paused,
            heroLabel: this.versusSettings.heroLabel, villainLabel: this.versusSettings.villainLabel,
            extensibleLinkEnabled: this.versusSettings.extensibleLinkEnabled,
            heroAction: this.versusSideAction('hero'), villainAction: this.versusSideAction('villain'),
            heroScore: scores.hero || 0, villainScore: scores.villain || 0,
            heroes, villains, extHeroes, extVillains,
        };
    },

    async emitVersusState() {
        this.broadcast.emit('versus_state_update', await this.getVersusPublicState());
    },

    // Un regalo que matchea en la lista base suma sus monedas al marcador de
    // su lado: el valor de la racha completa (monedas x repeatCount, ya
    // calculado en dispatchGiftEvent como totalCoins). El vínculo con
    // Extensible es independiente: un mismo regalo puede sumar al marcador Y
    // ajustar el timer a la vez si está en las dos listas.
    processGiftVersus({ giftName, giftId, repeatCount, diamondCount, totalCoins }) {
        if (this.versusState.isActive && !this.versusState.paused) {
            const side = findEntry(this.versusConfigs.heroes, giftName, giftId) ? 'hero'
                : findEntry(this.versusConfigs.villains, giftName, giftId) ? 'villain' : null;
            const coins = Number(totalCoins ?? (Number(diamondCount) || 0) * Math.max(1, repeatCount || 1)) || 0;
            if (side && coins > 0) {
                if (!this.versusState.scores) this.versusState.scores = emptyScores();
                this.versusState.scores[side] += coins;
                this.emitVersusState();
            }
        }
        if (this.versusSettings.extensibleLinkEnabled && this.extensibleState.isActive && !this.extensibleState.finished) {
            const extHero = findEntry(this.versusConfigs.extHeroes, giftName, giftId);
            const extVillain = !extHero ? findEntry(this.versusConfigs.extVillains, giftName, giftId) : null;
            const match = extHero || extVillain;
            if (match && match.secondsDelta) this.adjustExtensibleTime(match.secondsDelta);
        }
    },

    stopVersus() {
        this.versusState.isActive = false;
        this.versusState.paused = false;
        this.versusState.scores = emptyScores();
        this.emitVersusState();
        this.maybeDisconnectTikTok();
    },

    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerVersusHandlers(socket) {
        socket.on('start_versus', (config) => {
            console.log(`\n[${this.logId}] [JUEGO] ▶️ INICIANDO VERSUS...`);
            this.versusState = { isActive: true, paused: false, scores: emptyScores() };
            this.emitVersusState();
            if (config?.tiktokUsername) this.ensureTikTokConnection(config.tiktokUsername).catch(() => {});
        });

        socket.on('pause_versus', () => {
            if (this.versusState.isActive) { this.versusState.paused = true; this.emitVersusState(); }
        });

        socket.on('resume_versus', () => {
            if (this.versusState.isActive) { this.versusState.paused = false; this.emitVersusState(); }
        });

        socket.on('restart_versus', () => {
            if (this.versusState.isActive) {
                console.log(`\n[${this.logId}] [JUEGO] ⟲ REINICIANDO VERSUS...`);
                this.versusState.paused = false;
                this.versusState.scores = emptyScores();
                this.emitVersusState();
            }
        });

        socket.on('stop_versus', () => this.stopVersus());

        // Etiquetas de cada lado y el interruptor de vínculo con Extensible —
        // se guardan siempre (sobreviven a un reinicio aunque Versus no esté
        // corriendo), a diferencia de isActive/paused/counts (efímero, ver
        // runtimeState.js).
        socket.on('update_versus_settings', async ({ heroLabel, villainLabel, heroAction, villainAction, extensibleLinkEnabled } = {}) => {
            const action = (value, side) => (typeof value === 'string' ? value.trim().slice(0, MAX_ACTION_TEXT) : this.versusSideAction(side));
            this.versusSettings = {
                heroLabel: typeof heroLabel === 'string' && heroLabel.trim() ? heroLabel.trim().slice(0, 30) : this.versusSettings.heroLabel,
                villainLabel: typeof villainLabel === 'string' && villainLabel.trim() ? villainLabel.trim().slice(0, 30) : this.versusSettings.villainLabel,
                // La acción sí puede quedar vacía (el overlay no la muestra).
                heroAction: action(heroAction, 'hero'),
                villainAction: action(villainAction, 'villain'),
                extensibleLinkEnabled: extensibleLinkEnabled !== undefined ? !!extensibleLinkEnabled : this.versusSettings.extensibleLinkEnabled,
            };
            this.emitVersusState();
            try { await db.setVersusSettings(this.licenseId, this.versusSettings); } catch (err) {
                console.error(`[${this.logId}] [DB] setVersusSettings:`, err.message);
            }
        });

        // Agrega un regalo a una de las cuatro listas -- sin archivo que
        // subir (el ícono sale del directorio global, ver
        // resolveVersusIcons), así que alcanza con un evento de socket en
        // vez de una ruta REST. Rechaza en silencio si el tope ya se
        // alcanzó, el regalo ya está en esta lista o en la del lado
        // contrario de la MISMA familia (el panel ya valida esto antes de
        // ofrecer el botón, ver Versus.jsx) -- este chequeo es la última
        // barrera, mismo criterio que /api/alerts en server.js.
        socket.on('versus_add_gift', async ({ kind, giftName, giftId, giftIcon, secondsDelta } = {}) => {
            const key = KIND_LIST_KEY[kind];
            if (!key) return;
            const cleanName = typeof giftName === 'string' ? giftName.trim().slice(0, 120) : '';
            if (!cleanName) return;
            const cleanGiftId = /^\d{1,20}$/.test(String(giftId ?? '')) ? String(giftId) : null;
            const list = this.versusConfigs[key];
            const siblingList = this.versusConfigs[KIND_LIST_KEY[KIND_SIBLING[kind]]];
            const cap = kind === 'hero' || kind === 'villain' ? BASE_LIST_CAP : EXT_LIST_CAP;
            if (list.length >= cap) return;
            if (findEntry(list, cleanName, cleanGiftId) || findEntry(siblingList, cleanName, cleanGiftId)) return;

            try {
                const row = await db.insertVersusConfig({
                    id: crypto.randomUUID(), licenseId: this.licenseId, kind,
                    giftName: cleanName, giftId: cleanGiftId, giftIcon: cleanIcon(giftIcon),
                    secondsDelta: (kind === 'ext_hero' || kind === 'ext_villain') ? clampSecondsDelta(secondsDelta) : null,
                });
                list.push(rowToEntry(row));
                this.emitVersusState();
            } catch (err) {
                console.error(`[${this.logId}] [VERSUS] No se pudo agregar el regalo:`, err.message);
            }
        });

        socket.on('versus_remove_gift', async ({ id } = {}) => {
            if (typeof id !== 'string' || !id) return;
            for (const key of Object.values(KIND_LIST_KEY)) {
                const list = this.versusConfigs[key];
                const idx = list.findIndex((e) => e.id === id);
                if (idx === -1) continue;
                list.splice(idx, 1);
                try { await db.deleteVersusConfig(id, this.licenseId); } catch (err) {
                    console.error(`[${this.logId}] [DB] deleteVersusConfig:`, err.message);
                }
                this.emitVersusState();
                return;
            }
        });
    },
};
