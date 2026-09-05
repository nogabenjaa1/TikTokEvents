// Parche de un solo archivo para un bug real de tiktok-live-connector@2.4.4
// (node_modules/tiktok-live-connector/dist/legacy.js): al normalizar un
// mensaje, varios `.map(...)` asumen que el campo array SIEMPRE viene
// presente y explotan con TypeError si TikTok lo omite — lo cual pasa
// seguido (la mayoría de los comentarios no traen "emotes", muchas salas
// chicas no traen "ranksList" de top viewers). Sin este parche, esos
// mensajes nunca llegan a nuestro código (handleChatEvent, etc.) — se
// pierden en silencio (ver el uncaughtException/unhandledRejection
// handler en server.js, que evita que tiren todo el backend abajo pero no
// arregla el mensaje perdido).
//
// No podemos parchear esto desde afuera en tiempo de ejecución (es un
// módulo ESM que usa sus propias referencias internas, invisibles para
// código que solo importa sus exports) — así que se edita el archivo
// instalado directamente, vía `postinstall` (ver package.json), para que
// el parche se vuelva a aplicar en cada `npm install` — local o en cada
// deploy de Render, que siempre instala desde cero.
//
// Cada reemplazo acepta uno o más `froms` candidatos (útil cuando el
// mismo destino final se alcanzó en más de una etapa a lo largo de esta
// conversación — así ninguno queda marcado como "no encontrado" solo por
// no ser el candidato que de casualidad coincidió). Idempotente (si `to`
// ya está presente, no hace nada) y no fatal (si ningún `from` aparece —
// cambió la librería—, solo avisa por consola y sigue: nunca debe romper
// un `npm install`).
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector', 'dist', 'legacy.js');

const REPLACEMENTS = [
    {
        label: 'WebcastChatMessage.emotes',
        froms: ['webcastObject.emotes = webcastObject.emotes.map((emote) => ({'],
        to: 'webcastObject.emotes = (webcastObject.emotes || []).map((emote) => ({',
    },
    {
        label: 'WebcastEmoteChatMessage.emoteList',
        froms: ['webcastObject.emotes = webcastObject.emoteList.map((emote) => ({'],
        to: 'webcastObject.emotes = (webcastObject.emoteList || []).map((emote) => ({',
    },
    {
        label: 'getTopViewerAttributes',
        froms: ['function getTopViewerAttributes(topViewers) {\n\treturn topViewers.map((viewer) => {'],
        to: 'function getTopViewerAttributes(topViewers) {\n\treturn (topViewers || []).map((viewer) => {',
    },
    {
        // El campo real del regalo decodificado del protobuf es
        // `webcastObject.gift` (confirmado leyendo el encode() real de
        // WebcastGiftMessage) — pero este bloque busca
        // `webcastObject.giftDetails`, que NUNCA existe. Como resultado,
        // sobreescribe `webcastObject.gift` (que sí traía el nombre/tipo/
        // diamantes reales) con un resumen chico sin esos datos, ANTES de
        // que nuestro código los vea — por eso ningún regalo se detectaba
        // nunca, en ningún modo de juego, silenciosamente.
        label: 'WebcastGiftMessage.giftDetails (campo real es "gift")',
        froms: ['webcastObject.gift = {\n\t\t\t\t\tgift_id: webcastObject.giftId,\n\t\t\t\t\trepeat_count: webcastObject.repeatCount,\n\t\t\t\t\trepeat_end: webcastObject.repeatEnd ? 1 : 0,\n\t\t\t\t\tgift_type: webcastObject.giftDetails?.giftType\n\t\t\t\t};\n\t\t\t\tif (webcastObject.giftDetails?.giftImage?.url?.length) webcastObject.giftPictureUrl = webcastObject.giftDetails.giftImage.url[0];\n\t\t\t\tif (webcastObject.giftDetails) {\n\t\t\t\t\tObject.assign(webcastObject, webcastObject.giftDetails);\n\t\t\t\t\tdelete webcastObject.giftDetails;\n\t\t\t\t}'],
        to: 'const realGiftDetails = webcastObject.gift;\n\t\t\t\twebcastObject.gift = {\n\t\t\t\t\tgift_id: webcastObject.giftId,\n\t\t\t\t\trepeat_count: webcastObject.repeatCount,\n\t\t\t\t\trepeat_end: webcastObject.repeatEnd ? 1 : 0,\n\t\t\t\t\tgift_type: realGiftDetails?.type\n\t\t\t\t};\n\t\t\t\tif (realGiftDetails?.image?.urlList?.length) webcastObject.giftPictureUrl = realGiftDetails.image.urlList[0];\n\t\t\t\tif (realGiftDetails) {\n\t\t\t\t\tObject.assign(webcastObject, realGiftDetails);\n\t\t\t\t}',
    },
    {
        // getPreferredPictureFormat espera un ARRAY de URLs, pero se lo
        // llama pasándole `webcastUser.avatarLarge` completo — el objeto
        // ImageModel entero, no el array — así que siempre devolvía null.
        // Además, confirmado contra un LIVE real (@notbenjaa1): en los
        // mensajes de chat TikTok casi nunca manda `avatarLarge` — solo
        // `avatarThumb` (72x72) — así que hace falta la cadena de fallback
        // avatarLarge -> avatarMedium -> avatarThumb, no alcanza con
        // corregir solo el primero. Dos `froms`: el texto original de la
        // librería (instalación nueva) y el estado intermedio que ya haya
        // quedado de un deploy anterior con solo la primera mitad del fix.
        label: 'getUserAttributes.profilePictureUrl (array + fallback avatarMedium/avatarThumb)',
        froms: [
            'profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarLarge),',
            'profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarLarge?.urlList),',
        ],
        to: 'profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarLarge?.urlList || webcastUser.avatarMedium?.urlList || webcastUser.avatarThumb?.urlList),',
    },
    {
        // mapBadges() lee `innerBadges.badgeSceneType`, pero el campo real
        // del protobuf (confirmado con BadgeStruct.encode) se llama
        // `sceneType` — sin el prefijo "badge". badgeSceneType da siempre
        // undefined, así que TODO lo que depende de él en getUserAttributes
        // queda roto en silencio: teamMemberLevel (nivel de fan — el que no
        // funcionaba pese a estar bien configurado), gifterLevel, y el
        // chequeo de sceneType===1 de isModerator (ese último sigue
        // "funcionando" solo porque handleChatEvent en tenant.js tiene un
        // fallback aparte a userIdentity.isModeratorOfAnchor, que no pasa
        // por acá — por eso moderadores sí andaba y nivel de fan no).
        // Confirmado contra un LIVE real (@notbenjaa1): usuarios con badge
        // sceneType 10 y level real (ej. 18, 25) siempre daban
        // teamMemberLevel:0 antes de este parche.
        label: 'mapBadges (campo real es "sceneType", no "badgeSceneType")',
        froms: ['let badgeSceneType = innerBadges.badgeSceneType;\n\t\tif (Array.isArray(innerBadges.badges)) innerBadges.badges.forEach((badge) => {\n\t\t\tsimplifiedBadges.push(Object.assign({ badgeSceneType }, badge));\n\t\t});\n\t\tif (Array.isArray(innerBadges.imageBadges)) innerBadges.imageBadges.forEach((badge) => {\n\t\t\tif (badge && badge.image && badge.image.url) simplifiedBadges.push({\n\t\t\t\ttype: "image",\n\t\t\t\tbadgeSceneType,\n\t\t\t\tdisplayType: badge.displayType,\n\t\t\t\turl: badge.image.url\n\t\t\t});\n\t\t});\n\t\tif (innerBadges.privilegeLogExtra?.level && innerBadges.privilegeLogExtra?.level !== "0") simplifiedBadges.push({\n\t\t\ttype: "privilege",\n\t\t\tprivilegeId: innerBadges.privilegeLogExtra.privilegeId,\n\t\t\tlevel: parseInt(innerBadges.privilegeLogExtra.level),\n\t\t\tbadgeSceneType: innerBadges.badgeSceneType\n\t\t});'],
        to: 'let badgeSceneType = innerBadges.sceneType;\n\t\tif (Array.isArray(innerBadges.badges)) innerBadges.badges.forEach((badge) => {\n\t\t\tsimplifiedBadges.push(Object.assign({ badgeSceneType }, badge));\n\t\t});\n\t\tif (Array.isArray(innerBadges.imageBadges)) innerBadges.imageBadges.forEach((badge) => {\n\t\t\tif (badge && badge.image && badge.image.url) simplifiedBadges.push({\n\t\t\t\ttype: "image",\n\t\t\t\tbadgeSceneType,\n\t\t\t\tdisplayType: badge.displayType,\n\t\t\t\turl: badge.image.url\n\t\t\t});\n\t\t});\n\t\tif (innerBadges.privilegeLogExtra?.level && innerBadges.privilegeLogExtra?.level !== "0") simplifiedBadges.push({\n\t\t\ttype: "privilege",\n\t\t\tprivilegeId: innerBadges.privilegeLogExtra.privilegeId,\n\t\t\tlevel: parseInt(innerBadges.privilegeLogExtra.level),\n\t\t\tbadgeSceneType\n\t\t});',
    },
];

function main() {
    if (!fs.existsSync(TARGET)) {
        console.warn('[patch-tiktok-live-connector] No se encontró', TARGET, '— nada que parchear (¿versión distinta instalada?).');
        return;
    }

    let content = fs.readFileSync(TARGET, 'utf8');
    let changed = 0;
    let alreadyApplied = 0;
    let notFound = [];

    for (const { label, froms, to } of REPLACEMENTS) {
        if (content.includes(to)) {
            alreadyApplied++;
            continue;
        }
        const matchedFrom = froms.find((from) => content.includes(from));
        if (matchedFrom) {
            content = content.replace(matchedFrom, to);
            changed++;
        } else {
            notFound.push(label);
        }
    }

    if (changed > 0) {
        fs.writeFileSync(TARGET, content, 'utf8');
        console.log(`[patch-tiktok-live-connector] Aplicados ${changed} parche(s) a legacy.js.`);
    }
    if (alreadyApplied === REPLACEMENTS.length) {
        console.log('[patch-tiktok-live-connector] Ya estaba parcheado, nada que hacer.');
    }
    if (notFound.length > 0) {
        console.warn(`[patch-tiktok-live-connector] No se encontró el texto original para: ${notFound.join(', ')} — probablemente cambió la librería. Revisar a mano.`);
    }
}

main();
