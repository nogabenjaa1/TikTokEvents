import test from 'node:test';
import assert from 'node:assert/strict';
import { addFeedItem, feedCounts, filterFeed, feedCoins, relativeTime, feedDescription, FEED_MAX, BIG_GIFT_COINS } from './feedLogic.js';

const gift = (id, extra) => ({ id, type: 'gift', username: 'ana', nickname: 'Ana', giftName: 'Rose', count: 1, coins: 1, at: 0, ...extra });
const follow = (id, extra) => ({ id, type: 'follow', username: 'bob', nickname: 'Bob', at: 0, ...extra });

test('the newest event goes first and the same id is never added twice', () => {
  let list = [];
  list = addFeedItem(list, gift(1));
  list = addFeedItem(list, follow(2));
  assert.deepEqual(list.map((i) => i.id), [2, 1]);
  assert.equal(addFeedItem(list, follow(2)), list, 'the same event again (snapshot + live): untouched');
  assert.equal(addFeedItem(list, null), list);
  assert.equal(addFeedItem(list, { type: 'gift' }), list, 'an event with no id is ignored');
});

test('only the latest FEED_MAX events are kept', () => {
  let list = [];
  for (let i = 1; i <= FEED_MAX + 5; i++) list = addFeedItem(list, follow(i));
  assert.equal(list.length, FEED_MAX);
  assert.equal(list[0].id, FEED_MAX + 5);
  assert.equal(list.at(-1).id, 6);
});

test('the counts per type feed the filter labels, and filtering keeps the order', () => {
  const list = [gift(5), follow(4), gift(3), { id: 2, type: 'sticker', username: 'c' }, follow(1)];
  assert.deepEqual(feedCounts(list), { all: 5, gift: 2, follow: 2, sticker: 1 });
  assert.deepEqual(filterFeed(list, 'gift').map((i) => i.id), [5, 3]);
  assert.deepEqual(filterFeed(list, 'sticker').map((i) => i.id), [2]);
  assert.equal(filterFeed(list, 'all'), list);
  assert.deepEqual(feedCounts([]), { all: 0, gift: 0, follow: 0, sticker: 0 });
});

test('the coins summary only counts gifts', () => {
  assert.equal(feedCoins([gift(1, { coins: 10 }), follow(2, { coins: 999 }), gift(3, { coins: 5 })]), 15);
  assert.equal(feedCoins([]), 0);
  assert.equal(BIG_GIFT_COINS, 500);
});

test('the time reads as "ahora", seconds, minutes and hours, and is never negative', () => {
  const now = 1_000_000;
  assert.equal(relativeTime(now - 2_000, now), 'ahora');
  assert.equal(relativeTime(now - 5_000, now), 'hace 5 s');
  assert.equal(relativeTime(now - 59_000, now), 'hace 59 s');
  assert.equal(relativeTime(now - 60_000, now), 'hace 1 min');
  assert.equal(relativeTime(now - 25 * 60_000, now), 'hace 25 min');
  assert.equal(relativeTime(now - 2 * 3_600_000, now), 'hace 2 h');
  assert.equal(relativeTime(now + 30_000, now), 'ahora', 'a slightly-ahead server clock does not show a negative time');
});

test('each row says who did what, using the public name when there is one', () => {
  assert.deepEqual(feedDescription(gift(1, { nickname: 'Ana Ruiz', giftName: 'Rose' })), { who: 'Ana Ruiz', action: 'envió', what: 'Rose' });
  assert.deepEqual(feedDescription(gift(1, { nickname: '', username: 'ana', giftName: '' })), { who: 'ana', action: 'envió', what: 'un regalo' });
  assert.equal(feedDescription(follow(2)).action, 'empezó a seguirte');
  assert.equal(feedDescription({ id: 3, type: 'sticker', username: 'c', nickname: 'C' }).action, 'envió un sticker del club de fans');
});
