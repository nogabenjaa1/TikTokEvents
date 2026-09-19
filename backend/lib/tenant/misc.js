// Color Says (dados) y premio compartido entre juegos.
// Métodos de Tenant (se agregan a su prototipo en tenant.js) -- movidos tal
// cual estaban, sin cambios de lógica.

module.exports = {
    // Handlers de socket de esta área (los registra attachSocket en tenant.js).
    registerMiscHandlers(socket) {
        // ── COLOR SAYS (dados) ───────────────────────
        // El panel tira los dados y decide el resultado (con su propia
        // lógica, ver Colorsays.jsx); acá solo se valida la forma básica y
        // se reenvía al overlay especial de Colores (?screen=colors).
        socket.on('set_dice_state', ({ diceCount, diceResult, rolling } = {}) => {
            this.diceState = {
                diceCount: Number.isInteger(diceCount) ? Math.max(1, Math.min(6, diceCount)) : this.diceState.diceCount,
                diceResult: Array.isArray(diceResult) ? diceResult.slice(0, 6) : this.diceState.diceResult,
                rolling: !!rolling,
            };
            this.broadcast.emit('dice_state_update', this.diceState);
        });

        // ── PREMIO (compartido entre Rey del Trono/Zubastinis/Eliminación/
        // Ruleta) ─────────────────────────────────
        // La imagen llega ya redimensionada por el cliente (~100px de lado)
        // como data URL; igual se valida acá tamaño y formato para que un
        // cliente malicioso no infle la memoria del tenant ni meta HTML.
        socket.on('update_prize', ({ title, image } = {}) => {
            const cleanTitle = typeof title === 'string' ? title.slice(0, 60).trim() : '';
            const cleanImage = (typeof image === 'string' && image.startsWith('data:image/') && image.length <= 500000)
                ? image : null;
            this.prize = (cleanTitle || cleanImage) ? { title: cleanTitle, image: cleanImage } : null;
            this.broadcast.emit('prize_updated', this.prize);
        });
    },
};
