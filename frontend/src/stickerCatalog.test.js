import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSticker, addSeenSticker, stickerForId, stickerLabel, stickerTriggerKey } from './stickerCatalog.js';
import { createTtsRelease } from './ttsRelease.js';

const A = '7121025198379731714';
const B = '7121025198379731999';
const URL_A = 'https://p19-webcast.tiktokcdn.com/webcast-sg/aaa~tplv-obj.image';
const URL_B = 'https://p16-webcast.tiktokcdn.com/webcast-sg/bbb~tplv-obj.image';

test('a sticker needs a numeric id and only keeps an https image', () => {
  assert.deepEqual(cleanSticker({ id: A, imageUrl: URL_A }), { id: A, imageUrl: URL_A });
  assert.deepEqual(cleanSticker({ id: A, imageUrl: 'http://x/a.png' }), { id: A, imageUrl: '' });
  assert.deepEqual(cleanSticker({ id: A }), { id: A, imageUrl: '' });
  assert.equal(cleanSticker({ id: 'abc', imageUrl: URL_A }), null);
  assert.equal(cleanSticker({ imageUrl: URL_A }), null);
  assert.equal(cleanSticker(null), null);
});

test('a new sticker is added at the end and the same one is never listed twice', () => {
  let list = [];
  list = addSeenSticker(list, { id: A, imageUrl: URL_A });
  list = addSeenSticker(list, { id: B, imageUrl: URL_B });
  assert.deepEqual(list.map((s) => s.id), [A, B]);
  const again = addSeenSticker(list, { id: A, imageUrl: URL_A });
  assert.equal(again, list, 'nothing changed: the very same list, so nothing repaints');
});

test('a changed image replaces the old one, and a missing image never erases one', () => {
  const list = [{ id: A, imageUrl: URL_A }];
  assert.deepEqual(addSeenSticker(list, { id: A, imageUrl: URL_B }), [{ id: A, imageUrl: URL_B }]);
  assert.equal(addSeenSticker(list, { id: A, imageUrl: '' }), list);
  assert.equal(addSeenSticker(list, { id: A }), list);
});

test('a sticker that is not valid leaves the list as it was', () => {
  const list = [{ id: A, imageUrl: URL_A }];
  assert.equal(addSeenSticker(list, { id: 'no' }), list);
  assert.equal(addSeenSticker(list, undefined), list);
});

test('an alert keeps its sticker even before the catalog has it', () => {
  const list = [{ id: A, imageUrl: URL_A }];
  assert.deepEqual(stickerForId(list, A), { id: A, imageUrl: URL_A });
  assert.deepEqual(stickerForId(list, B), { id: B, imageUrl: '' });
  assert.equal(stickerForId(list, ''), null);
  assert.equal(stickerForId(list, null), null);
});

test('a sticker is told apart by the end of its number', () => {
  assert.equal(stickerLabel({ id: A }), 'Sticker …1714');
  assert.equal(stickerLabel({ id: '12' }), 'Sticker …12');
  assert.equal(stickerLabel(null), 'Sticker');
});

test('the alert key matches the one the server uses', () => {
  assert.equal(stickerTriggerKey(A), `sticker:${A}`);
  assert.equal(stickerTriggerKey(''), 'sticker');
  assert.equal(stickerTriggerKey(null), 'sticker');
});

// ── Telling the server the voice is done ────────────────────────────────────

test('only a message with a waiting alert is reported, and only once', () => {
  const sent = [];
  const release = createTtsRelease((event, id) => sent.push([event, id]));
  assert.equal(release({ id: 'm1', holdsAlert: false }), false);
  assert.equal(release({ id: 'm2' }), false);
  assert.equal(release(null), false);
  assert.deepEqual(sent, []);
  assert.equal(release({ id: 'm3', holdsAlert: true }), true);
  assert.equal(release({ id: 'm3', holdsAlert: true }), false, 'a second report of the same message does nothing');
  assert.deepEqual(sent, [['tts_message_done', 'm3']]);
});

test('the id always goes out as text, like the server keeps it', () => {
  const sent = [];
  const release = createTtsRelease((event, id) => sent.push(id));
  release({ id: 7687851890830328852n, holdsAlert: true });
  release({ id: 12, holdsAlert: true });
  assert.deepEqual(sent, ['7687851890830328852', '12']);
});

test('a message without an id cannot be reported', () => {
  const sent = [];
  const release = createTtsRelease((event, id) => sent.push(id));
  assert.equal(release({ holdsAlert: true }), false);
  assert.equal(release({ id: '', holdsAlert: true }), false);
  assert.deepEqual(sent, []);
});

test('it remembers a bounded number of messages', () => {
  const sent = [];
  const release = createTtsRelease((event, id) => sent.push(id));
  for (let i = 0; i < 500; i++) release({ id: `m${i}`, holdsAlert: true });
  assert.equal(sent.length, 500);
  assert.equal(release({ id: 'm499', holdsAlert: true }), false, 'a recent one is still remembered');
});
