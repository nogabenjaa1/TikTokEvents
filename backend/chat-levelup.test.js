// Subidas de nivel del club de fans en el chat, con mensajes en el formato
// REAL de TikTok (ver tiktokProtoFixtures.js): WebcastBarrageMessage con
// msgType FANS_LEVEL_UPGRADE (10) y fansLevelParam.currentGrade (el nivel
// nuevo). El nivel anterior no viene en el mensaje.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { make, user, dispatch } = require('./tiktokProtoFixtures');
const { fansLevelUpItem, chatMessageItem, superFanJoinItem, CHAT_SETTINGS_DEFAULTS, sanitizeChatSettings } = require('./lib/chatOverlay');

const BARRAGE = { USER_UPGRADE: 8, FANS_LEVEL_UPGRADE: 10, FANS_LEVEL_ENTRANCE: 11 };
const person = (fields = {}) => user({ uniqueId: 'ana_fan', nickname: 'Ana', avatar: 'https://p16/ana.png', ...fields });
const levelUp = (level, { msgType = BARRAGE.FANS_LEVEL_UPGRADE, badgeLevel = 0, superfan = false } = {}) => {
    const u = person({ fanLevel: badgeLevel, superfan });
    return make('WebcastBarrageMessage', { msgType, user: u, fansLevelParam: make('BarrageTypeFansLevelParam', { currentGrade: level, user: u }) });
};
const barrageOf = (message) => dispatch([{ method: 'WebcastBarrageMessage', message }]).find((e) => e.event === 'barrage').data;

test('subida de nivel: llega como barrage FANS_LEVEL_UPGRADE con el nivel nuevo', () => {
    const item = fansLevelUpItem(barrageOf(levelUp(5)));
    assert.equal(item.kind, 'levelup');
    assert.equal(item.user.uniqueId, 'ana_fan');
    assert.deepEqual(item.levelUp, { level: 5, previous: null });
    assert.equal(item.user.badges.fanLevel, 5, 'la insignia muestra el nivel nuevo');
});

test('subida de nivel: el anterior solo si se sabe (el mensaje no lo trae)', () => {
    assert.equal(fansLevelUpItem(barrageOf(levelUp(12)), { previous: 11 }).levelUp.previous, 11);
    assert.equal(fansLevelUpItem(barrageOf(levelUp(12)), { previous: 12 }).levelUp.previous, null, 'igual o mayor: no es el anterior');
    // La insignia del mismo mensaje puede estar ya actualizada o no: no se usa como "anterior".
    assert.equal(fansLevelUpItem(barrageOf(levelUp(12, { badgeLevel: 11 }))).levelUp.previous, null);
});

test('no se confunde con otros avisos: entrada de miembros, nivel de gifter, unirse a los Superfans', () => {
    assert.equal(fansLevelUpItem(barrageOf(levelUp(5, { msgType: BARRAGE.FANS_LEVEL_ENTRANCE }))), null, 'un miembro que entra a la sala');
    assert.equal(fansLevelUpItem(barrageOf(levelUp(5, { msgType: BARRAGE.USER_UPGRADE }))), null, 'nivel de gifter, no del club');
    assert.equal(fansLevelUpItem(barrageOf(levelUp(0))), null, 'sin nivel no hay subida');
    const join = make('WebcastBarrageMessage', { user: person(), content: make('MessageCommonText', { key: 'ttlive_superfan_commentnotif_superfanjoined' }) });
    assert.equal(fansLevelUpItem(barrageOf(join)), null);
    assert.equal(superFanJoinItem(barrageOf(levelUp(5))), null, 'y una subida no es un Superfan nuevo');
});

test('ajustes: las subidas de nivel se ven por defecto y se pueden apagar', () => {
    assert.equal(CHAT_SETTINGS_DEFAULTS.showLevelUps, true);
    assert.equal(sanitizeChatSettings({ showLevelUps: false }).showLevelUps, false);
});

// ── En el tenant: anterior, duplicados y lo que llega al overlay ──
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
    const barrage = (message) => tenant.handleBarrageEvent(barrageOf(message));
    const items = () => emitted.filter((e) => e.name === 'chat_item').map((e) => e.payload);
    return { tenant, barrage, items };
}

test('el nivel anterior sale de lo que el chat ya vio de esa persona en este LIVE', () => {
    const { tenant, barrage, items } = chatTenant();
    tenant.pushChatItem(chatMessageItem({ uniqueId: 'ana_fan', nickname: 'Ana', teamMemberLevel: 11 }, { rawComment: 'hola' }));
    barrage(levelUp(12));
    const up = items().find((i) => i.kind === 'levelup');
    assert.deepEqual(up.levelUp, { level: 12, previous: 11 });
    assert.equal(up.id > 0 && up.at > 0, true);
});

test('la misma subida repetida (o una vieja que llega tarde) se muestra una sola vez', () => {
    const { barrage, items } = chatTenant();
    barrage(levelUp(5));
    barrage(levelUp(5));
    barrage(levelUp(4));
    barrage(levelUp(6));
    assert.deepEqual(items().map((i) => i.levelUp.level), [5, 6]);
});

test('subir a más de 20: el evento lleva el nivel nuevo y quien ya era de nivel alto conserva su borde', () => {
    const { tenant, barrage, items } = chatTenant();
    barrage(levelUp(21, { superfan: true }));
    const up = items()[0];
    assert.equal(up.levelUp.level, 21);
    assert.equal(up.user.badges.fanLevel, 21);
    assert.equal(up.user.badges.subscriber, true, 'Superfan y nivel alto a la vez');
    tenant.pushChatItem(chatMessageItem({ uniqueId: 'ana_fan', teamMemberLevel: 30 }, { rawComment: 'ya soy nivel 30' }));
    assert.equal(items()[1].user.badges.fanLevel, 30);
});
