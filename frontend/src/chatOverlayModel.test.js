import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_DEFAULT_SETTINGS, CHAT_FADE_OUT_MS, visibleChatItems } from './chatOverlayModel.js';

const NOW = 1_800_000_000_000;
const item = (id, ageMs, kind = 'chat') => ({ id, kind, at: NOW - ageMs });

test('a message stays for its time, then while it fades out, then it is gone', () => {
  const settings = { ...CHAT_DEFAULT_SETTINGS, fadeSeconds: 30 };
  assert.deepEqual(visibleChatItems([item(1, 29_000)], settings, NOW).map((i) => i.id), [1]);
  assert.deepEqual(visibleChatItems([item(1, 30_000 + CHAT_FADE_OUT_MS - 1)], settings, NOW).map((i) => i.id), [1], 'still fading');
  assert.deepEqual(visibleChatItems([item(1, 30_000 + CHAT_FADE_OUT_MS)], settings, NOW), []);
});

test('with "never" messages only leave when more arrive than fit', () => {
  const settings = { ...CHAT_DEFAULT_SETTINGS, fadeSeconds: 0, maxMessages: 3 };
  const items = [item(1, 999_999), item(2, 3), item(3, 2), item(4, 1)];
  assert.deepEqual(visibleChatItems(items, settings, NOW).map((i) => i.id), [2, 3, 4], 'the most recent ones stay');
});

test('events can be hidden by kind; chat messages always show', () => {
  const items = [item(1, 1, 'chat'), item(2, 1, 'follow'), item(3, 1, 'gift'), item(4, 1, 'share')];
  const settings = { ...CHAT_DEFAULT_SETTINGS, showFollows: false, showGifts: false, showShares: true };
  assert.deepEqual(visibleChatItems(items, settings, NOW).map((i) => i.id), [1, 4]);
  assert.deepEqual(visibleChatItems(null, CHAT_DEFAULT_SETTINGS, NOW), []);
});

// ── Insignias como íconos (ver chatBadgeIcons) ──
import { chatBadgeIcons } from './chatOverlayModel.js';

test('insignias: íconos propios en un orden fijo, con el nivel solo en el de miembro', () => {
  const icons = chatBadgeIcons({ moderator: true, subscriber: true, topGifterRank: 2, fanLevel: 12, gifterLevel: 30, others: ['https://p16/otro.png'] });
  assert.deepEqual(icons.map((i) => i.kind), ['moderator', 'member', 'topGifter', 'gifter', 'subscriber', 'image']);
  assert.equal(icons.find((i) => i.kind === 'member').level, 12);
  assert.equal(icons.find((i) => i.kind === 'topGifter').rank, 2);
  assert.equal(icons.find((i) => i.kind === 'gifter').level, undefined, 'el donador no muestra número');
  assert.equal(icons.find((i) => i.kind === 'image').url, 'https://p16/otro.png');
  for (const icon of icons) assert.ok(icon.label, 'cada ícono tiene su nombre (lectores de pantalla)');
});

test('insignias: sin datos no se inventa ninguna', () => {
  assert.deepEqual(chatBadgeIcons(null), []);
  assert.deepEqual(chatBadgeIcons({ images: [], moderator: false, subscriber: false, topGifterRank: null, fanLevel: 0, gifterLevel: 0 }), []);
});

test('insignias: un mensaje de antes (solo `images`) muestra esas imágenes, sin repetir íconos', () => {
  const icons = chatBadgeIcons({ images: ['https://p16/a.png', 'https://p16/b.png'], moderator: true });
  assert.deepEqual(icons.map((i) => i.kind), ['image', 'image'], 'sin `others` no se sabe qué imagen es el moderador: se muestran las de TikTok');
  assert.deepEqual(chatBadgeIcons({ images: [], moderator: true, fanLevel: 3 }).map((i) => i.kind), ['moderator', 'member'], 'sin imágenes: los íconos de los roles');
});

import { chatFrameSize, CHAT_OVERLAY_SIZE } from './chatOverlayModel.js';

test('tamaño en OBS: en una fuente horizontal, 960 x 480 como siempre; en una vertical, toda la fuente', () => {
  assert.deepEqual(chatFrameSize(960, 480), CHAT_OVERLAY_SIZE);
  assert.deepEqual(chatFrameSize(1920, 1080), CHAT_OVERLAY_SIZE, 'una fuente grande horizontal no cambia: sigue usando la esquina de 960 x 480');
  assert.deepEqual(chatFrameSize(800, 600), CHAT_OVERLAY_SIZE, 'el tamaño por defecto de OBS, como antes');
  assert.equal(chatFrameSize(540, 960), null);
  assert.equal(chatFrameSize(1080, 1920), null);
});

// ── Destacados: club de fans de nivel alto y Superfan (ver chatHighlight) ──
import { chatHighlight, formatCoins, visibleChatItems as visibleItems, CHAT_DEFAULT_SETTINGS as DEFAULTS, chatBadgeIcons as iconsOf } from './chatOverlayModel.js';

test('destacado: el borde especial es solo para nivel de club de fans MAYOR a 20', () => {
  assert.equal(chatHighlight({ fanLevel: 20 }), null, 'el nivel 20 no lo activa');
  assert.equal(chatHighlight({ fanLevel: 21 }), 'elite');
  assert.equal(chatHighlight({ fanLevel: 50 }), 'elite');
  assert.equal(chatHighlight({ fanLevel: 0 }), null);
  assert.equal(chatHighlight(null), null);
});

test('destacado: Superfan solo, y con nivel alto los dos beneficios juntos', () => {
  assert.equal(chatHighlight({ subscriber: true, fanLevel: 5 }), 'superfan');
  assert.equal(chatHighlight({ subscriber: true, fanLevel: 20 }), 'superfan');
  assert.equal(chatHighlight({ subscriber: true, fanLevel: 21 }), 'both');
});

test('insignias: Superfan con su nombre, y el miembro de nivel alto con su variante', () => {
  const both = iconsOf({ others: [], subscriber: true, fanLevel: 21 });
  const member = both.find((i) => i.kind === 'member');
  assert.equal(member.elite, true);
  assert.equal(member.level, 21);
  const superfan = both.find((i) => i.kind === 'subscriber');
  assert.equal(superfan.label, 'Superfan');
  assert.equal(iconsOf({ others: [], fanLevel: 20 }).find((i) => i.kind === 'member').elite, false, 'nivel 20: insignia común');
  assert.deepEqual(both.map((i) => i.kind), ['member', 'subscriber'], 'las dos se conservan');
});

test('monedas: con separador de miles, y nada si no se sabe el valor', () => {
  assert.equal(formatCoins(6), '6');
  assert.equal(formatCoins(104997), '104,997');
  assert.equal(formatCoins(null), null);
  assert.equal(formatCoins(0), null);
});

test('suscripciones y cofres se pueden ocultar desde los ajustes', () => {
  const items = [{ id: 1, kind: 'subscribe', at: 1 }, { id: 2, kind: 'chest', at: 1 }, { id: 3, kind: 'chat', at: 1 }];
  const settings = { ...DEFAULTS, fadeSeconds: 0 };
  assert.deepEqual(visibleItems(items, settings, 2).map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(visibleItems(items, { ...settings, showSubscribes: false, showChests: false }, 2).map((i) => i.id), [3]);
  assert.equal(DEFAULTS.showSubscribes, true);
  assert.equal(DEFAULTS.showChests, true);
});
