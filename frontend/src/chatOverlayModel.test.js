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
