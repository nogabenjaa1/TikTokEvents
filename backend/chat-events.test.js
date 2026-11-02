// Eventos nuevos del chat (suscripciones, Superfan, cofres), insignias y el
// valor de los regalos, con mensajes en el formato REAL de TikTok: armados con
// el esquema protobuf de la librería y pasados por su despacho real (ver
// tiktokProtoFixtures.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, user, dispatch } = require('./tiktokProtoFixtures');
const {
    badgesFrom, subscribeItem, superFanJoinItem, chestItem, giftItem, sanitizeChatSettings, CHAT_SETTINGS_DEFAULTS,
} = require('./lib/chatOverlay');

const ana = () => user({ uniqueId: 'ana_fan', nickname: 'Ana', avatar: 'https://p16/ana.png', fanLevel: 25, superfan: true, moderator: true });
const eventOf = (emitted, name) => emitted.find((e) => e.event === name)?.data;
const decoded = (emitted, method) => emitted.find((e) => e.event === 'decodedData' && e.data.method === method)?.data.data;

// ── Insignias con el esquema real ──
test('insignias: moderador y Superfan se reconocen aunque la librería no los marque', () => {
    const chat = eventOf(dispatch([{ method: 'WebcastChatMessage', message: make('WebcastChatMessage', { user: ana(), content: 'hola' }) }]), 'chat');
    // Lo que hace la librería con este esquema (v3): los marca en false.
    assert.equal(chat.isModerator, false);
    assert.equal(chat.isSubscriber, false);
    const b = badgesFrom(chat);
    assert.equal(b.moderator, true, 'por el tipo de insignia ADMIN (1)');
    assert.equal(b.subscriber, true, 'por el tipo de insignia SUBSCRIBER (4)');
    assert.equal(b.fanLevel, 25);
});

test('insignias: nuevo suscriptor (7) también es Superfan; sin insignias, nada', () => {
    assert.equal(badgesFrom({ userSceneTypes: [7] }).subscriber, true);
    const none = badgesFrom({ userSceneTypes: [] });
    assert.equal(none.subscriber, false);
    assert.equal(none.moderator, false);
});

// ── Suscripciones ──
const subMessage = (fields) => make('WebcastSubNotifyMessage', { user: ana(), messageType: 0, ...fields });

test('suscripción: la librería no la emite como evento propio; llega por decodedData', () => {
    const emitted = dispatch([{ method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '1', oldSubscribeStatus: 0 }) }]);
    assert.ok(!emitted.some((e) => /sub/i.test(e.event) && e.event !== 'decodedData'), 'ningún evento "subscribe" en esta versión');
    assert.ok(decoded(emitted, 'WebcastSubNotifyMessage'), 'sí está en decodedData');
});

test('suscripción nueva, renovación, meses y renovación automática, con lo que manda TikTok', () => {
    const first = subscribeItem(decoded(dispatch([{ method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '1', oldSubscribeStatus: 0, subscribeType: 0 }) }]), 'WebcastSubNotifyMessage'));
    assert.equal(first.kind, 'subscribe');
    assert.equal(first.user.uniqueId, 'ana_fan');
    assert.deepEqual(first.subscribe, { renewal: false, months: 1, auto: false, superfanJoin: false });
    assert.equal(first.user.badges.fanLevel, 25, 'con sus insignias');

    const resub = subscribeItem(decoded(dispatch([{ method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '7', oldSubscribeStatus: 1, subscribeType: 1 }) }]), 'WebcastSubNotifyMessage'));
    assert.deepEqual(resub.subscribe, { renewal: true, months: 7, auto: true, superfanJoin: false });
});

test('suscripción: otros avisos del mismo mensaje (metas, recordatorios al streamer) no se muestran', () => {
    for (const messageType of [1, 3, 5, 13]) {
        const data = decoded(dispatch([{ method: 'WebcastSubNotifyMessage', message: subMessage({ messageType }) }]), 'WebcastSubNotifyMessage');
        assert.equal(subscribeItem(data), null, `messageType ${messageType}`);
    }
    assert.equal(subscribeItem({ messageType: 0 }), null, 'sin usuario no hay mensaje');
});

test('Superfan: el aviso de que alguien se hizo Superfan llega como barrage (la librería no emite superFanJoin con este esquema)', () => {
    // La clave del texto de TikTok va en Text.key (este esquema no tiene
    // ningún campo displayType, que es donde la librería la busca).
    const joinedKey = 'ttlive_superfan_commentnotif_superfanjoined';
    const message = make('WebcastBarrageMessage', {
        common: make('CommonMessageData', { displayText: make('MessageCommonText', { key: joinedKey, defaultPattern: '{0:user} se unió a los Superfans' }) }),
        user: ana(),
        content: make('MessageCommonText', { key: joinedKey, defaultPattern: '{0:user} se unió a los Superfans' }),
    });
    const emitted = dispatch([{ method: 'WebcastBarrageMessage', message }]);
    assert.equal(eventOf(emitted, 'superFanJoin'), undefined, 'limitación de la librería: no lo reconoce');
    const barrage = eventOf(emitted, 'barrage');
    assert.ok(barrage);
    const item = superFanJoinItem(barrage);
    assert.equal(item.kind, 'subscribe');
    assert.equal(item.subscribe.superfanJoin, true);
    assert.equal(item.user.nickname, 'Ana');
    assert.equal(item.user.badges.subscriber, true);
});

test('Superfan: otros avisos (barrage) no son una suscripción', () => {
    const other = make('WebcastBarrageMessage', { user: ana(), content: make('MessageCommonText', { key: 'ttlive_gift_gallery_notice', defaultPattern: 'x' }) });
    const barrage = eventOf(dispatch([{ method: 'WebcastBarrageMessage', message: other }]), 'barrage');
    assert.equal(superFanJoinItem(barrage), null);
    // El aviso de un Superfan que comenta (no que se une) tampoco.
    const comment = make('WebcastBarrageMessage', { user: ana(), content: make('MessageCommonText', { key: 'ttlive_superfan_commentnotif', defaultPattern: 'x' }) });
    assert.equal(superFanJoinItem(eventOf(dispatch([{ method: 'WebcastBarrageMessage', message: comment }]), 'barrage')), null);
});

// ── Cofres ──
const envelope = (info, display = 1) => make('WebcastEnvelopeMessage', {
    envelopeInfo: make('MessageRedEnvelopInfo', { envelopeId: '99', businessType: 1, sendUserName: 'Rey', sendUserAvatar: make('ImageModel', { urlList: ['https://p16/rey.png'] }), diamondCount: 1000, peopleCount: 50, ...info }),
    display,
});

test('cofre: quién lo colocó, sus monedas y para cuántas personas, desde el mensaje real', () => {
    const data = eventOf(dispatch([{ method: 'WebcastEnvelopeMessage', message: envelope({}) }]), 'envelope');
    const item = chestItem(data);
    assert.equal(item.kind, 'chest');
    assert.deepEqual(item.user, { uniqueId: 'Rey', nickname: 'Rey', avatar: 'https://p16/rey.png', badges: badgesFrom({}) });
    assert.deepEqual(item.chest, { id: '99', coins: 1000, people: 50, superfanBox: false });
});

test('cofre de Superfans (businessType 19) y cofre que se oculta', () => {
    const box = chestItem(eventOf(dispatch([{ method: 'WebcastEnvelopeMessage', message: envelope({ businessType: 19, superFanCount: 12, peopleCount: 0 }) }]), 'envelope'));
    assert.equal(box.chest.superfanBox, true);
    assert.equal(box.chest.people, 12, 'para un cofre de Superfans cuenta cuántos Superfans');
    const hidden = eventOf(dispatch([{ method: 'WebcastEnvelopeMessage', message: envelope({}, 2) }]), 'envelope');
    assert.equal(chestItem(hidden), null, 'display HIDE: el cofre se quita, no es uno nuevo');
});

test('cofre sin quien lo colocó ni monedas: se muestra igual, sin inventar datos', () => {
    const item = chestItem(eventOf(dispatch([{ method: 'WebcastEnvelopeMessage', message: envelope({ sendUserName: '', sendUserAvatar: undefined, diamondCount: 0, peopleCount: 0 }) }]), 'envelope'));
    assert.equal(item.user, null);
    assert.deepEqual(item.chest, { id: '99', coins: null, people: null, superfanBox: false });
    assert.equal(chestItem({ display: 1 }), null, 'sin datos del cofre no hay mensaje');
});

test('un cofre no es un regalo: llega por envelope, nunca por gift', () => {
    const emitted = dispatch([{ method: 'WebcastEnvelopeMessage', message: envelope({}) }]);
    assert.ok(!emitted.some((e) => e.event === 'gift'));
});

// ── Valor de los regalos ──
test('regalo: valor por unidad y total, sin inventar cuando no se sabe', () => {
    const six = giftItem({ username: 'a', nickname: 'A', giftName: 'Rosa', count: 6, unitCoins: 1 });
    assert.deepEqual([six.gift.count, six.gift.unitCoins, six.gift.coins], [6, 1, 6]);
    const lion = giftItem({ username: 'a', nickname: 'A', giftName: 'León', count: 1, unitCoins: 29999 });
    assert.deepEqual([lion.gift.unitCoins, lion.gift.coins], [29999, 29999]);
    const many = giftItem({ username: 'a', nickname: 'A', giftName: 'Universo', count: 3, unitCoins: 34999 });
    assert.equal(many.gift.coins, 104997);
    const unknown = giftItem({ username: 'a', nickname: 'A', giftName: 'Misterio', count: 2, unitCoins: 0 });
    assert.equal(unknown.gift.unitCoins, null, 'sin valor conocido: null, no 0');
    assert.equal(unknown.gift.coins, null);
});

test('regalo real: el valor sale de diamondCount del regalo, no de su id', () => {
    const message = make('WebcastGiftMessage', {
        user: ana(), giftId: '5655', repeatCount: 6, repeatEnd: 1,
        gift: make('Gift', { id: '5655', name: 'Rose', diamondCount: 1, type: 1 }),
    });
    const gift = eventOf(dispatch([{ method: 'WebcastGiftMessage', message }]), 'gift');
    assert.equal(String(gift.giftId), '5655');
    assert.equal(gift.diamondCount, 1);
    assert.equal(gift.repeatCount, 6);
});

// ── Ajustes ──
test('ajustes: suscripciones y cofres se ven por defecto y se pueden apagar', () => {
    assert.equal(CHAT_SETTINGS_DEFAULTS.showSubscribes, true);
    assert.equal(CHAT_SETTINGS_DEFAULTS.showChests, true);
    const off = sanitizeChatSettings({ showSubscribes: false, showChests: 0 });
    assert.equal(off.showSubscribes, false);
    assert.equal(off.showChests, false);
    const old = sanitizeChatSettings({ ...CHAT_SETTINGS_DEFAULTS, showSubscribes: undefined, showChests: undefined }, { fontSize: 18 });
    assert.equal(old.showSubscribes, true, 'ajustes guardados antes de esto: se ven');
});
