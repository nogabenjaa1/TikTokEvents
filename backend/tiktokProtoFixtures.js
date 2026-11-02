// Mensajes de TikTok LIVE con el formato REAL, para las pruebas: se arman con
// el esquema protobuf que usa la librería (tiktok-live-proto v3), se codifican
// y decodifican como llegan por la conexión, y pasan por el despacho real de
// WebcastPushConnection (tiktok-live-connector/legacy), que es lo que usa el
// proyecto (ver lib/tenant/connection.js). Así una prueba ve exactamente qué
// evento emite la librería y con qué datos, no un objeto inventado.
// No es una prueba (no termina en .test.js): lo usan las pruebas.
const path = require('node:path');

// El paquete solo exporta 'v3' para import (ESM) y no deja resolver ni su
// package.json: se carga directo su archivo de Node (el mismo esquema que usa
// la librería, instalado junto a ella).
const proto = require(path.join(__dirname, 'node_modules', 'tiktok-live-proto', 'dist', 'node', 'v3.js'));
const { WebcastPushConnection } = require('tiktok-live-connector/legacy');

const EMPTY = new Uint8Array(0);
// Un mensaje con todos los valores por defecto del esquema y lo que se pase.
const make = (type, partial = {}) => Object.assign(proto[type].decode(EMPTY), partial);

// Insignias como las manda TikTok en este esquema (v3): cada una es un
// BadgeStruct con su sceneType (1 moderador, 4 y 7 suscriptor/Superfan, 8
// nivel de gifter, 10 club de fans), una imagen (`image`, ImageBadge) y, si
// tiene nivel, privilegeLogExtra.level.
function badge(sceneType, { level = 0, imageUrl = '' } = {}) {
    return make('BadgeStruct', {
        sceneType,
        image: imageUrl ? make('ImageBadge', { displayType: 1, image: make('ImageModel', { urlList: [imageUrl] }) }) : undefined,
        privilegeLogExtra: level > 0 ? make('PrivilegeLogExtra', { level: String(level), privilegeId: '1' }) : undefined,
    });
}

function user({ uniqueId, nickname, avatar = '', fanLevel = 0, superfan = false, moderator = false, gifterLevel = 0 } = {}) {
    const badgeList = [];
    if (moderator) badgeList.push(badge(1, { imageUrl: 'https://p16-webcast.tiktokcdn.com/moderator.png' }));
    if (superfan) badgeList.push(badge(4, { imageUrl: 'https://p16-webcast.tiktokcdn.com/sub_1.png' }));
    if (gifterLevel > 0) badgeList.push(badge(8, { level: gifterLevel, imageUrl: `https://p16-webcast.tiktokcdn.com/grade_${gifterLevel}.png` }));
    if (fanLevel > 0) badgeList.push(badge(10, { level: fanLevel, imageUrl: `https://p16-webcast.tiktokcdn.com/fans_lv${fanLevel}.png` }));
    return make('User', {
        idStr: `${uniqueId}-id`,
        displayId: uniqueId,
        nickname,
        avatarThumb: avatar ? make('ImageModel', { urlList: [avatar] }) : undefined,
        badgeList,
    });
}

// Pasa los mensajes (método + objeto) por el despacho real de la librería y
// devuelve los eventos que emite, en orden: [{ event, data }].
function dispatch(messages) {
    const connection = new WebcastPushConnection('prueba', { processInitialData: false, enableExtendedGiftInfo: false });
    const emitted = [];
    const original = connection.emit.bind(connection);
    connection.emit = (event, ...args) => {
        if (event !== 'rawData') emitted.push({ event, data: event === 'decodedData' ? { method: args[0], data: args[1] } : args[0] });
        return original(event, ...args);
    };
    connection.processProtoMessageFetchResult({
        messages: messages.map(({ method, message }) => {
            const payload = proto[method].encode(message).finish();
            return { method, payload, decodedData: { type: method, data: proto[method].decode(payload) } };
        }),
    });
    return emitted;
}

module.exports = { proto, make, badge, user, dispatch };
