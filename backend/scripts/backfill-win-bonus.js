// Script de un solo uso: el WIN BONUS de Color Says dejó de otorgarse
// automático por dice_tier (ver comentario en db.js/Colorsays.jsx) — ahora
// es una excepción manual por licencia (dice_win_bonus_unlocked). Para que
// nadie que YA pagó por PRO/VIP pierda lo que compró, este script prende
// esa excepción una sola vez para toda licencia con dice_tier pro/vip.
// A propósito NO vive en la cadena de migraciones de db.js (que corre en
// cada arranque del server): si un admin más adelante revoca el bono a
// mano para un streamer puntual, no queremos que un reinicio del server
// se lo vuelva a prender solo.
// Correr con: node scripts/backfill-win-bonus.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../db');

async function main() {
    const rows = await db.listAll();
    const targets = rows.filter(row => (row.dice_tier === 'pro' || row.dice_tier === 'vip') && !row.dice_win_bonus_unlocked);

    if (targets.length === 0) {
        console.log('No hay licencias PRO/VIP pendientes de migrar — nada que hacer.');
        return;
    }

    for (const row of targets) {
        await db.setWinBonusUnlocked(row.id, true);
        console.log(`✅ ${row.username} (${row.dice_tier}) — bono manual activado`);
    }
    console.log(`\nListo: ${targets.length} licencia(s) migrada(s).`);
}

main()
    .catch(err => { console.error('Error en el backfill de win bonus:', err); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode || 0));
