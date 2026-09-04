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
// Reemplazos idempotentes (si ya están aplicados, no hace nada) y no
// fatales (si el texto original no aparece —cambió la librería—, solo
// avisa por consola y sigue: nunca debe romper un `npm install`).
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector', 'dist', 'legacy.js');

const REPLACEMENTS = [
    {
        label: 'WebcastChatMessage.emotes',
        from: 'webcastObject.emotes = webcastObject.emotes.map((emote) => ({',
        to: 'webcastObject.emotes = (webcastObject.emotes || []).map((emote) => ({',
    },
    {
        label: 'WebcastEmoteChatMessage.emoteList',
        from: 'webcastObject.emotes = webcastObject.emoteList.map((emote) => ({',
        to: 'webcastObject.emotes = (webcastObject.emoteList || []).map((emote) => ({',
    },
    {
        label: 'getTopViewerAttributes',
        from: 'function getTopViewerAttributes(topViewers) {\n\treturn topViewers.map((viewer) => {',
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
        from: 'webcastObject.gift = {\n\t\t\t\t\tgift_id: webcastObject.giftId,\n\t\t\t\t\trepeat_count: webcastObject.repeatCount,\n\t\t\t\t\trepeat_end: webcastObject.repeatEnd ? 1 : 0,\n\t\t\t\t\tgift_type: webcastObject.giftDetails?.giftType\n\t\t\t\t};\n\t\t\t\tif (webcastObject.giftDetails?.giftImage?.url?.length) webcastObject.giftPictureUrl = webcastObject.giftDetails.giftImage.url[0];\n\t\t\t\tif (webcastObject.giftDetails) {\n\t\t\t\t\tObject.assign(webcastObject, webcastObject.giftDetails);\n\t\t\t\t\tdelete webcastObject.giftDetails;\n\t\t\t\t}',
        to: 'const realGiftDetails = webcastObject.gift;\n\t\t\t\twebcastObject.gift = {\n\t\t\t\t\tgift_id: webcastObject.giftId,\n\t\t\t\t\trepeat_count: webcastObject.repeatCount,\n\t\t\t\t\trepeat_end: webcastObject.repeatEnd ? 1 : 0,\n\t\t\t\t\tgift_type: realGiftDetails?.type\n\t\t\t\t};\n\t\t\t\tif (realGiftDetails?.image?.urlList?.length) webcastObject.giftPictureUrl = realGiftDetails.image.urlList[0];\n\t\t\t\tif (realGiftDetails) {\n\t\t\t\t\tObject.assign(webcastObject, realGiftDetails);\n\t\t\t\t}',
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

    for (const { label, from, to } of REPLACEMENTS) {
        if (content.includes(to)) {
            alreadyApplied++;
            continue;
        }
        if (content.includes(from)) {
            content = content.replace(from, to);
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
