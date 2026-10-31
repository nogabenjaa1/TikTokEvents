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
