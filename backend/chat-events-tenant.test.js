// Del mensaje real de TikTok al overlay de chat: el despacho real de la
// librería (ver tiktokProtoFixtures.js) alimenta los manejadores reales del
// tenant (lib/tenant/chatOverlay.js y lib/tenant/events.js) y se revisa lo
// que se emite al room del chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { make, user, dispatch } = require('./tiktokProtoFixtures');

const ana = () => user({ uniqueId: 'ana_fan', nickname: 'Ana', avatar: 'https://p16/ana.png', fanLevel: 25, superfan: true });
const subMessage = (fields) => make('WebcastSubNotifyMessage', { user: ana(), messageType: 0, ...fields });
const envelope = (info) => make('WebcastEnvelopeMessage', {
    envelopeInfo: make('MessageRedEnvelopInfo', { envelopeId: '99', businessType: 1, sendUserName: 'Rey', diamondCount: 1000, peopleCount: 50, ...info }),
    display: 1,
});
const joinMessage = () => make('WebcastBarrageMessage', { user: ana(), content: make('MessageCommonText', { key: 'ttlive_superfan_commentnotif_superfanjoined' }) });

function chatTenant() {
    const emitted = [];
    const context = {
        module: { exports: {} },
        require: (name) => (name.endsWith('/db') ? { setChatSettings: async () => {} } : name.includes('chatOverlay') ? require('./lib/chatOverlay') : {}),
        console: { log() {}, error() {} }, setTimeout, clearTimeout, Date, Map, Set,
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/chatOverlay'), 'utf8'), context);
    const tenant = Object.create(context.module.exports);
    tenant.licenseId = 'l1';
    tenant.logId = 'ana/l1';
    tenant.io = { to: (room) => ({ emit: (name, payload) => emitted.push({ room, name, payload: JSON.parse(JSON.stringify(payload)) }) }) };
    tenant.initChatOverlayState();
    // Lo mismo que conecta lib/tenant/connection.js.
    const feed = (messages) => {
        for (const { event, data } of dispatch(messages)) {
            if (event === 'decodedData' && data.method === 'WebcastSubNotifyMessage') tenant.handleSubscribeEvent(data.data);
            if (event === 'barrage') tenant.handleBarrageEvent(data);
            if (event === 'envelope') tenant.handleEnvelopeEvent(data);
        }
    };
    const items = () => emitted.filter((e) => e.name === 'chat_item').map((e) => e.payload);
    return { tenant, feed, items, emitted };
}

test('connection.js escucha decodedData (suscripciones), barrage (Superfan) y envelope (cofres)', () => {
    const source = fs.readFileSync(require.resolve('./lib/tenant/connection'), 'utf8');
    assert.match(source, /on\('decodedData'[\s\S]*?WebcastSubNotifyMessage[\s\S]*?handleSubscribeEvent/);
    assert.match(source, /on\('barrage', \(data\) => this\.handleBarrageEvent\(data\)\)/);
    assert.match(source, /on\('envelope', \(data\) => this\.handleEnvelopeEvent\(data\)\)/);
});

test('del mensaje real al overlay: suscripción, Superfan y cofre llegan al room del chat', () => {
    const { feed, items, emitted } = chatTenant();
    feed([
        { method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '2', oldSubscribeStatus: 1 }) },
        { method: 'WebcastEnvelopeMessage', message: envelope({}) },
    ]);
    assert.deepEqual(items().map((i) => i.kind), ['subscribe', 'chest']);
    assert.ok(emitted.every((e) => e.room === 'l1:chat'), 'solo al room del chat');
    assert.ok(items().every((i) => i.id && i.at));
    assert.equal(items()[0].user.badges.subscriber, true);
    assert.equal(items()[0].user.badges.fanLevel, 25);
});

test('la misma suscripción por los dos caminos (aviso y Superfan) se muestra una sola vez', () => {
    const { feed, items } = chatTenant();
    feed([{ method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '1' }) }]);
    feed([{ method: 'WebcastBarrageMessage', message: joinMessage() }]);
    assert.equal(items().length, 1);
    const other = chatTenant();
    other.feed([{ method: 'WebcastBarrageMessage', message: joinMessage() }]);
    other.feed([{ method: 'WebcastSubNotifyMessage', message: subMessage({ subMonth: '1' }) }]);
    assert.equal(other.items().length, 1, 'también en el orden contrario');
});

test('un cofre repetido (mismo id) no se muestra dos veces; uno distinto sí', () => {
    const { feed, items } = chatTenant();
    feed([{ method: 'WebcastEnvelopeMessage', message: envelope({}) }]);
    feed([{ method: 'WebcastEnvelopeMessage', message: envelope({}) }]);
    feed([{ method: 'WebcastEnvelopeMessage', message: envelope({ envelopeId: '100' }) }]);
    assert.deepEqual(items().map((i) => i.chest.id), ['99', '100']);
});

// ── Regalos: valor, rachas y el directorio de regalos ──
function giftsTenant({ catalog = {} } = {}) {
    const context = {
        module: { exports: {} },
        require: (name) => (name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : name.includes('giftCatalog') ? require('./lib/giftCatalog')
            : name.includes('giftDirectory') ? { record() {}, load() {}, coinsFor: (id) => catalog[Number(id)] || 0 }
            : name.includes('stickerCatalog') ? require('./lib/stickerCatalog') : name.includes('chatOverlay') ? require('./lib/chatOverlay') : {}),
        setTimeout, clearTimeout, Date, console, Math, Number, String, Map, Set, Object, Array,
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/events'), 'utf8'), context);
    const tenant = Object.create(context.module.exports);
    tenant.openGiftCombos = new Map();
    tenant.closedGiftCombos = new Map();
    tenant.seenGifts = new Map();
    tenant.broadcast = { emit() {} };
    tenant.pushFeed = () => {};
    const chat = [];
    tenant.pushChatItem = (item) => { if (item) chat.push(item.gift); };
    for (const fn of ['processGiftKing', 'processGiftZub', 'processGiftElim', 'processGiftRoulette', 'processGiftGifterBoard', 'processGiftVersus', 'processGiftExtensible', 'processGiftGoal', 'processAlertTrigger']) tenant[fn] = () => {};
    const send = (fields) => {
        for (const { event, data } of dispatch([{ method: 'WebcastGiftMessage', message: make('WebcastGiftMessage', { user: ana(), ...fields }) }])) {
            if (event === 'gift') tenant.handleGiftEvent(data);
        }
    };
    return { tenant, chat, send };
}
const giftOf = (id, name, coins, type = 1) => make('Gift', { id: String(id), name, diamondCount: coins, type });

test('racha de 6 rosas: un solo mensaje, x6 y 6 monedas, aunque lleguen las actualizaciones', () => {
    const { chat, send } = giftsTenant();
    for (let n = 1; n <= 5; n++) send({ giftId: '5655', repeatCount: n, repeatEnd: 0, gift: giftOf(5655, 'Rose', 1) });
    assert.equal(chat.length, 0, 'mientras la racha sigue no se muestra nada');
    send({ giftId: '5655', repeatCount: 6, repeatEnd: 1, gift: giftOf(5655, 'Rose', 1) });
    assert.equal(chat.length, 1);
    assert.deepEqual([chat[0].count, chat[0].unitCoins, chat[0].coins], [6, 1, 6]);
});

test('racha cerrada por tiempo y cierre real que llega tarde: el total no se cuenta dos veces', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { chat, send } = giftsTenant();
    send({ giftId: '5655', repeatCount: 3, repeatEnd: 0, gift: giftOf(5655, 'Rose', 1) });
    t.mock.timers.tick(60 * 1000);
    assert.deepEqual(chat.map((g) => [g.count, g.coins]), [[3, 3]], 'se cerró sola con lo último');
    send({ giftId: '5655', repeatCount: 5, repeatEnd: 1, gift: giftOf(5655, 'Rose', 1) });
    assert.deepEqual(chat.map((g) => [g.count, g.coins]), [[3, 3], [2, 2]], 'solo lo que faltaba: 3 + 2 = 5 rosas, 5 monedas');
});

test('regalos caros: uno de 500 y varios de un regalo caro', () => {
    const { chat, send } = giftsTenant();
    send({ giftId: '7934', repeatCount: 1, repeatEnd: 1, gift: giftOf(7934, 'Regalo', 500, 0) });
    send({ giftId: '9999', repeatCount: 3, repeatEnd: 1, gift: giftOf(9999, 'Universo', 34999, 1) });
    assert.deepEqual(chat.map((g) => [g.count, g.unitCoins, g.coins]), [[1, 500, 500], [3, 34999, 104997]]);
});

test('sin valor en el mensaje: se usa el directorio de regalos; si no está, el chat no inventa', () => {
    const { chat, send } = giftsTenant({ catalog: { 777: 250 } });
    send({ giftId: '777', repeatCount: 2, repeatEnd: 1, gift: giftOf(777, 'Sin valor', 0, 0) });
    send({ giftId: '888', repeatCount: 1, repeatEnd: 1, gift: giftOf(888, 'Desconocido', 0, 0) });
    assert.deepEqual(chat.map((g) => [g.name, g.unitCoins, g.coins]), [['Sin valor', 250, 500], ['Desconocido', null, null]]);
});
