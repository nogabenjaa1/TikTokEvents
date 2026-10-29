// Datos falsos para la vista previa del modal de personalización (ver
// OverlayCustomizePanel.jsx) — nombres de prueba genéricos (Test1/Test2/
// Test3...) en vez de depender de una conexión real a TikTok, así el
// streamer puede detectar errores visuales (fondo, color de texto, etc.)
// antes de salir al directo. Un avatar SVG inline (no una URL externa como
// pravatar.cc): la vista previa tiene que funcionar sin internet y sin
// depender de que un servicio de terceros siga arriba.
const MOCK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#888"/><circle cx="50" cy="38" r="18" fill="#ccc"/><ellipse cx="50" cy="88" rx="30" ry="24" fill="#ccc"/></svg>'
);

// Uno por cada id de OVERLAY_CUSTOMIZE_IDS — la forma exacta que cada
// overlay real espera como `state`/`diceState`, con valores fijos que
// ejercitan las partes de la UI donde más importa ver el color/fondo
// (un nombre de usuario visible, al menos una fila con "primer lugar",
// etc.), nunca datos que dependan de qué esté pasando en un LIVE real.
// Filas de prueba del overlay de chat (Overlays > Personalizar y la vista
// previa de Eventos > Chat sin LIVE). Mismo formato que el servidor.
const MOCK_STICKER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#facc15"/><circle cx="22" cy="26" r="5" fill="#1f2937"/><circle cx="42" cy="26" r="5" fill="#1f2937"/><path d="M18 40q14 12 28 0" stroke="#1f2937" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
);

export function chatPreviewItems(now = Date.now()) {
  const user = (n, badges = {}) => ({
    uniqueId: `test${n}`, nickname: `Test${n}`, avatar: MOCK_AVATAR,
    badges: { images: [], moderator: false, subscriber: false, topGifterRank: null, fanLevel: 0, gifterLevel: 0, ...badges },
  });
  return [
    { id: 'p1', at: now - 8000, kind: 'chat', user: user(1, { fanLevel: 12 }), text: 'jajaja qué bueno el directo', emotes: [] },
    { id: 'p2', at: now - 6000, kind: 'follow', user: user(2) },
    { id: 'p3', at: now - 4000, kind: 'gift', user: user(3, { topGifterRank: 1 }), gift: { name: 'Rosa', icon: '', count: 7, coins: 7 } },
    { id: 'p4', at: now - 2000, kind: 'chat', user: user(4, { moderator: true }), text: '!play despacito', emotes: [] },
    { id: 'p5', at: now - 1000, kind: 'share', user: user(5) },
    // Un sticker mandado solo: un mensaje más, como en TikTok.
    { id: 'p6', at: now - 500, kind: 'chat', user: user(6, { fanLevel: 3 }), text: '', parts: [{ type: 'emote', url: MOCK_STICKER }] },
  ];
}

export function buildPreviewMock(overlayId) {
  switch (overlayId) {
    case 'games':
      return {
        king: {
          isActive: true, mode: 'main', timeLeft: 42,
          targetGiftName: 'Rosa', targetGiftCoins: 1, targetGiftIcon: '',
          lastParticipant: { username: 'Test1', avatar: MOCK_AVATAR },
        },
      };
    case 'colors':
      return { diceState: { diceCount: 4, diceResult: [0, 1, 2, 3], rolling: false } };
    case 'taptap':
      return {
        state: {
          leaderboard: [
            { username: 'Test1', avatar: MOCK_AVATAR, likes: 1200 },
            { username: 'Test2', avatar: MOCK_AVATAR, likes: 800 },
            { username: 'Test3', avatar: MOCK_AVATAR, likes: 450 },
          ],
        },
      };
    case 'gifter':
      return {
        state: {
          leaderboard: [
            { username: 'Test1', avatar: MOCK_AVATAR, coins: 5000 },
            { username: 'Test2', avatar: MOCK_AVATAR, coins: 2500 },
            { username: 'Test3', avatar: MOCK_AVATAR, coins: 900 },
          ],
        },
      };
    case 'extensible':
      return { state: { isActive: true, finished: false, baseTime: 60, secondsPerFollow: 5, secondsPerGift: 3, timeLeft: 95 } };
    case 'goal':
      return { state: { isActive: true, finished: false, targetType: 'coins', target: 500, current: 230, title: '' } };
    case 'chat':
      return {
        viewerCount: 128,
        // Mismo formato que manda el servidor (ver backend/lib/chatOverlay.js):
        // un mensaje, un seguidor, un regalo y un compartido, para ver cada estilo.
        messages: chatPreviewItems(),
      };
    case 'versus':
      return {
        state: {
          isActive: true, paused: false, heroLabel: 'HÉROES', villainLabel: 'VILLANOS', extensibleLinkEnabled: false,
          heroAction: 'hablar', villainAction: 'silencio', heroScore: 120, villainScore: 85,
          heroes: [{ id: 'h1', giftName: 'Rosa', giftIcon: '' }, { id: 'h2', giftName: 'Finger Heart', giftIcon: '' }],
          villains: [{ id: 'v1', giftName: 'TikTok', giftIcon: '' }],
          extHeroes: [], extVillains: [],
        },
      };
    case 'ticker':
      return {
        items: [
          { id: 't1', apodo: 'zorro no te lo lleves', giftIcon: '', giftName: 'Rosa' },
          { id: 't2', apodo: 'despertar', giftIcon: '', giftName: 'Dona' },
          { id: 't3', apodo: 'a bailar', giftIcon: '', giftName: 'Corazón' },
        ],
      };
    case 'musicqueue':
      return {
        state: {
          queue: [
            { id: '1', title: 'Canción de prueba', artist: 'Artista Test', albumArt: '', requestedBy: 'Test1', playing: true },
            { id: '2', title: 'Otra canción más', artist: 'Artista Dos', albumArt: '', requestedBy: 'Test2', playing: false },
          ],
        },
      };
    default:
      return {};
  }
}
