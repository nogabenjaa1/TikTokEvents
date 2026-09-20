// Directorio de regalos vistos conectado a la base de datos (ver
// giftDirectoryCore.js para qué es y por qué es global).
const db = require('../db');
const { createGiftDirectory } = require('./giftDirectoryCore');

module.exports = createGiftDirectory({
    listRows: () => db.listSeenGifts(),
    upsertRow: (gift) => db.upsertSeenGift(gift),
});
