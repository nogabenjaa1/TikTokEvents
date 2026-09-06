// Datos falsos para la vista previa del modal de personalización (ver
// OverlayCustomizePanel.jsx) — nombres de prueba genéricos (Test1/Test2/
// Test3...) en vez de depender de una conexión real a TikTok, así el
// streamer puede detectar errores visuales (fondo, color de texto, etc.)
// antes de salir al directo. Un avatar SVG inline (no una URL externa como
// pravatar.cc): la vista previa tiene que funcionar sin internet y sin
// depender de que un servicio de terceros siga arriba.
export const MOCK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#888"/><circle cx="50" cy="38" r="18" fill="#ccc"/><ellipse cx="50" cy="88" rx="30" ry="24" fill="#ccc"/></svg>'
);

// Uno por cada id de OVERLAY_CUSTOMIZE_IDS — la forma exacta que cada
// overlay real espera como `state`/`diceState`, con valores fijos que
// ejercitan las partes de la UI donde más importa ver el color/fondo
// (un nombre de usuario visible, al menos una fila con "primer lugar",
// etc.), nunca datos que dependan de qué esté pasando en un LIVE real.
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
