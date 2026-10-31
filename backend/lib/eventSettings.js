// Ajustes guardados de cada evento (Rey del Trono, Zubastinis, Eliminación,
// Ruleta, Extensible, Objetivo): lo que el streamer dejó configurado aunque
// todavía no lo haya iniciado. Antes vivían solo en el navegador (localStorage):
// desde otro navegador o dispositivo había que configurar todo de nuevo. No es
// el estado de una partida (eso sigue en runtimeState.js): solo los parámetros.
//
// Lista blanca por evento y por campo: lo que no está aquí se descarta, y cada
// valor se limita en tipo y tamaño. Nunca se confía en lo que manda el panel.

const MAX_NUMBER = 10_000_000;
const MAX_TEXT = 120;

const num = (max = MAX_NUMBER) => (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : undefined;
};
const bool = () => (v) => (typeof v === 'boolean' ? v : undefined);
const text = (max = MAX_TEXT) => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const oneOf = (...values) => (v) => (values.includes(v) ? v : undefined);
// Un regalo elegido en un selector: nombre, ícono (solo https) y monedas.
const gift = () => (v) => {
    if (v === null) return null;
    if (!v || typeof v !== 'object') return undefined;
    const name = typeof v.name === 'string' ? v.name.trim().slice(0, 60) : '';
    if (!name) return undefined;
    const icon = typeof v.icon === 'string' && /^https:\/\//i.test(v.icon) && v.icon.length <= 500 ? v.icon : '';
    const coins = Number.isFinite(Number(v.coins)) ? Math.max(0, Math.min(MAX_NUMBER, Math.round(Number(v.coins)))) : 0;
    const out = { name, icon, coins };
    if (/^\d{1,20}$/.test(String(v.id ?? ''))) out.id = Number(v.id);
    return out;
};

const SCHEMA = {
    king: { selectedGift: gift(), selectedInstaWin: gift(), mainTime: num(7200), snipeTime: num(7200) },
    zub: { mainTime: num(7200), snipeTime: num(7200), tiebreakTime: num(7200), minCoins: num() },
    elim: {
        selectedGift: gift(), selectedInstaWin: gift(), baseTime: num(7200), rejoinTime: num(7200),
        fastMode: bool(), eliminationsPerRound: num(1000), lockedMode: bool(),
    },
    roulette: {
        entryMode: oneOf('chat', 'gift'), keyword: text(60), entryWindowSec: num(7200), selectedGift: gift(),
        winnerRule: oneOf('first', 'last', 'position'), winnerPosition: num(1000), fastMode: bool(), eliminationsPerRound: num(1000),
    },
    extensible: { baseTimeSec: num(7200), secondsPerFollow: num(3600), secondsPerGift: num(3600), reverseMode: bool() },
    goal: { targetType: oneOf('coins', 'followers'), targetInput: text(12), title: text(60) },
};

const EVENT_SETTINGS_IDS = Object.keys(SCHEMA);

function sanitizeEventEntry(id, raw) {
    const schema = SCHEMA[id];
    if (!schema || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    for (const [field, clean] of Object.entries(schema)) {
        if (!(field in raw)) continue;
        const value = clean(raw[field]);
        if (value !== undefined) out[field] = value;
    }
    return out;
}

// Mapa completo { king: {...}, zub: {...}, ... }: solo los eventos conocidos.
function sanitizeEventSettings(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const id of EVENT_SETTINGS_IDS) {
        const entry = sanitizeEventEntry(id, raw[id]);
        if (entry) out[id] = entry;
    }
    return out;
}

module.exports = { EVENT_SETTINGS_IDS, sanitizeEventSettings, sanitizeEventEntry };
