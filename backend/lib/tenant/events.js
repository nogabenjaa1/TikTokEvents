// Eventos de TikTok (regalos, likes, follows, stickers, chat, espectadores).
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.
const {
    GIFT_ACCUMULATE_WINDOW_MS,
    GIFT_COMBO_TIMEOUT_MS,
    GIFT_COMBO_MEMORY_MS,
    MAX_SEEN_GIFTS,
} = require('../../lib/tenantHelpers');
const { giftNameKey } = require('../../lib/giftCatalog');
const giftDirectory = require('../../lib/giftDirectory');

module.exports = {
    // ==========================================
    // DESPACHO ÚNICO DE REGALOS -> CADA MÓDULO DECIDE SI LE INTERESA
    // ==========================================
    handleGiftEvent(data) {
        // Nombres de campo verificados decodificando el protobuf real de
        // esta versión de la librería (WebcastGiftMessage/Gift): el tipo
        // combo-able es `type` (no `giftType`) y el nombre del regalo es
        // `name` (no `giftName`) — quedaron mal desde antes, no es una
        // regresión de este cambio. El avatar sale de `profilePictureUrl`
        // (singular, ya resuelto a una sola URL por la librería), no de
        // `userDetails.profilePictureUrls` (que en esta versión es un
        // string, no un array — indexarlo con [0] agarraba un carácter
        // suelto en vez de la URL).
        // Racha (type 1): se espera al cierre (repeatEnd) para contar y disparar
        // UNA sola vez; si el cierre no llega, un temporizador la cierra con lo
        // último recibido (ver GIFT_COMBO_TIMEOUT_MS). Nunca queda una racha
        // muerta esperando al siguiente evento.
        if (data.type === 1) {
            const comboKey = `${data.userId || data.uniqueId}|${data.giftId ?? data.name}`;
            const open = this.openGiftCombos.get(comboKey);
            if (!data.repeatEnd) {
                if (open) clearTimeout(open.timer);
                const timer = setTimeout(() => {
                    this.openGiftCombos.delete(comboKey);
                    this.closedGiftCombos.set(comboKey, { count: data.repeatCount || 1, at: Date.now() });
                    this.dispatchGiftEvent({ ...data, repeatEnd: true });
                }, GIFT_COMBO_TIMEOUT_MS);
                if (timer.unref) timer.unref();
                this.openGiftCombos.set(comboKey, { timer });
                return;
            }
            if (open) { clearTimeout(open.timer); this.openGiftCombos.delete(comboKey); }
            // El cierre real llegó después de que el temporizador ya la había
            // cerrado: solo se cuenta lo que faltaba (o nada, si no hay más).
            const closed = this.closedGiftCombos.get(comboKey);
            if (closed) {
                this.closedGiftCombos.delete(comboKey);
                if (Date.now() - closed.at <= GIFT_COMBO_MEMORY_MS) {
                    const missing = (data.repeatCount || 1) - closed.count;
                    if (missing <= 0) return;
                    return this.dispatchGiftEvent({ ...data, repeatCount: missing });
                }
            }
        }
        this.dispatchGiftEvent(data);
    },

    // Reparte un regalo YA cerrado a cada módulo (juegos, alertas, catálogo).
    dispatchGiftEvent(data) {
        this.noteSeenGift(data);
        const event = {
            username: data.uniqueId,
            // Pedido explicito ({nickname} en el texto de las alertas): el
            // nombre público (puede tener espacios/emojis, distinto del
            // @usuario) ya lo lee el chat del TTS en otro lado de este mismo
            // archivo (ver el handler de 'chat' más abajo) -- mismo campo.
            nickname: data.nickname || data.uniqueId || '',
            avatar: data.profilePictureUrl || '',
            giftName: data.name || '',
            giftId: data.giftId,
            diamondCount: data.diamondCount || 0,
            repeatCount: data.repeatCount || 1,
            followRole: data.followRole,
        };
        event.totalCoins = event.diamondCount * event.repeatCount;

        this.processGiftKing(event);
        this.processGiftZub(event);
        this.processGiftElim(event);
        this.processGiftRoulette(event);
        this.processGiftGifterBoard(event);
        this.processGiftExtensible(event);
        this.processGiftGoal(event.totalCoins);
        this.processAlertTrigger({
            username: event.username, nickname: event.nickname, key: event.giftName, giftId: event.giftId,
            repeatCount: event.repeatCount, giftName: event.giftName, coins: event.totalCoins,
            allowGlobalFallback: true,
        });
    },

    // Cada regalo que llega en el directo existe sí o sí: se recuerda (id,
    // nombre, monedas, ícono) y, si es nuevo, se avisa al panel para que
    // aparezca en los selectores aunque la lista que bajó TikTok no lo traía.
    noteSeenGift(data) {
        const name = String(data.name || '').trim();
        if (!name) return;
        const key = giftNameKey(name);
        if (this.seenGifts.has(key) || this.seenGifts.size >= MAX_SEEN_GIFTS) return;
        const gift = { id: data.giftId ?? null, name, coins: data.diamondCount || 0, icon: data.giftPictureUrl || '' };
        this.seenGifts.set(key, gift);
        this.broadcast.emit('gift_seen', gift);
        // Queda guardado con su id, nombre, monedas e ícono para todas las
        // licencias (ver giftDirectoryCore.js): así el próximo directo ya lo trae.
        giftDirectory.record(gift);
    },

    getSeenGifts() {
        return [...this.seenGifts.values()];
    },

    // Bug real de nombre de campo (mismo patrón que gift/badge, confirmado
    // decodificando el protobuf real de WebcastLikeMessage): el conteo de
    // ESTE tick es `count`, no `likeCount` — ese campo no existe en el
    // mensaje, así que Number(undefined) siempre daba 0 y CADA like se
    // descartaba antes de llegar al acumulador (por eso Top Tap-Tap nunca
    // sumaba ni un solo like). `total` también existe pero es el acumulado
    // de todo el directo que ya mantiene TikTok — no sirve para nuestro
    // propio acumulador por ráfaga (ver processLikeTapTap/settleTapTap).
    handleLikeEvent(data) {
        const username = data.uniqueId;
        const likeCount = Number(data.count) || 0;

        // Diagnóstico (ver tapTapDiagnostics): se cuenta el evento CRUDO,
        // llegue o no a sumar algo, para distinguir si el problema es que
        // TikTok/la librería no manda eventos de más usuarios (recepción) o
        // si algo de acá abajo los descarta (procesamiento).
        this.recordTapTapEvent(username, likeCount);

        if (!username || likeCount <= 0) return;

        const avatar = data.profilePictureUrl || '';
        this.processLikeTapTap(username, avatar, likeCount);
    },

    // Bug real de la librería (mismo patrón que gift/like/badges, confirmado
    // en vivo contra @samujuega_): el evento derivado `follow` NUNCA se
    // emite porque legacy.js filtra por `simplifiedObj.displayType?.includes
    // ("follow")`, y `displayType` no existe en absoluto en el protobuf real
    // de WebcastSocialMessage (verificado decodificándolo — sus campos reales
    // son shareType/action/shareTarget/followCount/followType/etc, ninguno
    // llamado displayType). Con dos follows reales capturados en vivo, el
    // campo que sí distingue un follow es `action === "1"` (ambos casos
    // reales tenían action:"1"; TikTok también usa este mensaje para
    // "share", que debería traer un action distinto). Por eso escuchamos
    // 'social' directo en vez de confiar en el 'follow' derivado.
    handleSocialEvent(data) {
        if (!data?.uniqueId) return;
        if (String(data.action) !== '1') return; // no es un follow (ej. share -- no soportado, ver el comentario de arriba)
        this.processFollowExtensible();
        this.processFollowGoal();
        this.processAlertTrigger({
            username: data.uniqueId, nickname: data.nickname || data.uniqueId, key: 'follow',
            repeatCount: 1, giftName: '', coins: 0,
        });
    },

    handleEmoteEvent(data) {
        if (!data?.uniqueId) return;
        const emotes = Array.isArray(data.emoteList) ? data.emoteList : [];
        const isFanClubSticker = emotes.some((emote) => (
            emote?.emoteType === 2 || emote?.emoteScene === 2 || emote?.rewardCondition === 2
        ));
        if (!isFanClubSticker) return;
        this.processAlertTrigger({
            username: data.uniqueId, nickname: data.nickname || data.uniqueId, key: 'sticker',
            repeatCount: 1, giftName: '', coins: 0,
        });
    },

    // Reenviamos únicamente los datos necesarios para que el panel decida
    // qué voces pueden entrar al TTS. La síntesis ocurre en el navegador del
    // streamer; el backend nunca reproduce ni almacena los comentarios.
    handleChatEvent(data) {
        // El texto del comentario viene en `data.content`, no `data.comment`
        // (verificado contra un LIVE real) — con el nombre viejo esto
        // siempre daba string vacío y el chat completo (TTS y Ruleta modo
        // chat) quedaba mudo, sin ningún error visible.
        const comment = typeof data.content === 'string' ? data.content.trim() : '';
        if (!comment) return;

        const badges = Array.isArray(data.userBadges) ? data.userBadges : [];
        const badgeText = badges.map((badge) => [badge.type, badge.name, badge.url].filter(Boolean).join(' ')).join(' ').toLowerCase();
        const identity = data.userIdentity || {};

        // Pedido explícito, tras agregar el disparador de alerta 'sticker'
        // (ver handleEmoteEvent): un sticker EXCLUSIVO del club de fans
        // mandado dentro del chat viene como un emote embebido en este
        // mismo mensaje -- mismo criterio que ahí (emoteType/emoteScene/
        // rewardCondition === 2, los valores reales "FANS"/"FANS_CLUB" del
        // protobuf) para que el TTS no intente leer el texto/placeholder
        // que TikTok manda junto con el sticker. Requiere el parche de
        // WebcastChatMessage.emotes en patch-tiktok-live-connector.js (sin
        // él, `data.emotes` nunca trae estos 3 campos).
        const hasFanClubEmote = Array.isArray(data.emotes) && data.emotes.some((e) => (
            e?.emoteType === 2 || e?.emoteScene === 2 || e?.rewardCondition === 2
        ));

        // Comandos (!play, etc.) nunca van al TTS — pedido explícito. Se
        // filtran ACÁ (no en el panel) para que ni siquiera crucen el
        // socket como candidato a leerse en voz alta.
        if (!comment.startsWith('!') && !hasFanClubEmote) {
            // Pedido explícito (overlay de chat en vivo): mismo broadcast
            // que ya usaba el TTS -- va SIN filtrar por los ajustes de TTS
            // (esos se aplican del lado del cliente, ver TtsChat.jsx), así
            // que sirve tal cual para mostrar el chat completo también.
            // `avatar` es nuevo acá (el TTS no lo necesita, lo ignora sin
            // problema) -- solo para poder mostrar la fotito en el overlay.
            this.broadcast.emit('tts_chat_message', {
                id: data.msgId || `${Date.now()}-${data.userId || data.uniqueId || 'chat'}`,
                username: data.nickname || data.uniqueId || 'Usuario',
                uniqueId: data.uniqueId || '',
                avatar: data.profilePictureUrl || '',
                comment: comment.slice(0, 300),
                isModerator: Boolean(data.isModerator || identity.isModeratorOfAnchor),
                isSuperFan: badgeText.includes('superfan') || badgeText.includes('super_fan') || badgeText.includes('super fan'),
                isSubscriber: Boolean(data.isSubscriber || identity.isSubscriberOfAnchor),
                fanLevel: Math.max(0, Number(data.teamMemberLevel) || Number(data.user?.fansClubInfo?.fansLevel) || 0),
            });
        }

        this.processPlayCommand(comment, data, identity);
        this.processRouletteComment(data);
    },

    // Contador de espectadores en vivo (overlay de chat, pedido explícito)
    // -- TikTok manda WebcastRoomUserSeqMessage cada tanto, sin intervalo
    // fijo, mientras alguien esté en vivo (ver comentario grande en
    // server.js sobre por qué antes nunca se escuchaba este evento).
    // BUG real reportado ("los viewers se quedan en 0"): el campo que se
    // leía acá, `data.viewerCount`, NO EXISTE -- el README de
    // tiktok-live-connector lo documenta así, pero quedó desactualizado
    // respecto al esquema real que trae la versión instalada. El tipo real
    // (node_modules/tiktok-live-proto/dist/node/v3.d.ts,
    // WebcastRoomUserSeqMessage) es:
    //   { common, ranks, total, popStr, seats, popularity, totalUser, anonymous }
    // -- sin ningún `viewerCount`. `total` es el que mejor encaja como
    // "espectadores actuales" (`totalUser` parece ser un acumulado
    // histórico de usuarios distintos, no el conteo en vivo). Viene como
    // string (los campos numéricos grandes del protobuf se serializan como
    // string para no perder precisión), de ahí el Number(...).
    handleRoomUserEvent(data) {
        // Log de UNA sola vez por Tenant (no por mensaje -- este evento
        // puede llegar seguido): si `total` termina siendo el campo
        // equivocado (ya pasó antes con otros campos de esta librería, ver
        // handleGiftEvent/handleChatEvent), esto es lo que permite
        // corregirlo con datos reales en vez de adivinar de nuevo a ciegas.
        if (!this.loggedRoomUserSample) {
            this.loggedRoomUserSample = true;
            console.log(`[${this.logId}] [TIKTOK] Muestra de roomUser (una sola vez):`, JSON.stringify(data));
        }
        const count = Number(data?.total);
        if (!Number.isFinite(count) || count < 0) return;
        this.viewerCount = Math.round(count);
        this.broadcast.emit('viewer_count_update', { viewerCount: this.viewerCount });
    },

    // Acumula `coins` de `username` en `accumMap`, respetando la ventana de
    // GIFT_ACCUMULATE_WINDOW_MS: si su último regalo fue hace más de eso,
    // el acumulado se pierde y arranca de cero con este regalo; si no, se
    // suma al que ya tenía. `grantedUnits` (arranca en 0, lo actualiza cada
    // caller) es cuántas "unidades" de ese acumulado ya se cobraron —
    // existe para que un acumulado que sigue creciendo (varios regalos
    // seguidos dentro de la ventana) pueda otorgar entradas de a una a
    // medida que cruza cada múltiplo del umbral, en vez de volver a
    // otorgar las mismas de nuevo cada vez que se reevalúa.
    accumulateGiftCoins(accumMap, username, coins) {
        const now = Date.now();
        const prev = accumMap[username];
        if (prev && now - prev.lastAt <= GIFT_ACCUMULATE_WINDOW_MS) {
            prev.total += coins;
            prev.lastAt = now;
        } else {
            accumMap[username] = { total: coins, lastAt: now, grantedUnits: 0 };
        }
        return accumMap[username];
    },
};
