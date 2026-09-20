import test from 'node:test';
import assert from 'node:assert/strict';
import { giftKey, addSeenGift, mergeCatalog } from './giftCatalog.js';

test('gift names compare without case, accents or spacing', () => {
  assert.equal(giftKey('Súper  GG'), giftKey('super gg'));
  assert.notEqual(giftKey('Rose'), giftKey('Rosa'));
});

test('a received gift is added once, whatever the case or spacing, and needs a name', () => {
  let list = addSeenGift([], { id: 77, name: '  Super   GG ', coins: 30, icon: 'https://x/gg.png' });
  assert.deepEqual(list, [{ id: 77, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }]);
  assert.equal(addSeenGift(list, { id: 77, name: 'SUPER GG', coins: 30, icon: 'https://x/gg.png' }), list, 'the same gift: the list is returned untouched');
  assert.equal(addSeenGift(list, { name: '   ' }), list);
  assert.equal(addSeenGift(list, null), list);
});

test('a gift seen again with the icon, id or coins it lacked is completed, never downgraded', () => {
  let list = addSeenGift([], { name: 'Rose', coins: 1 });
  list = addSeenGift(list, { id: 5655, name: 'rose', coins: 1, icon: 'https://x/rose.png' });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 5655, name: 'Rose', coins: 1, icon: 'https://x/rose.png' });
  assert.equal(addSeenGift(list, { name: 'Rose', coins: 1 }), list, 'a later event without icon changes nothing');
});

test('bad coins fall back to zero', () => {
  assert.equal(addSeenGift([], { name: 'A', coins: -3 })[0].coins, 0);
  assert.equal(addSeenGift([], { name: 'A', coins: 'x' })[0].coins, 0);
});

test('merging adds the received gifts missing from the TikTok list, keeps the first one first, and sorts the rest', () => {
  const ninguno = { name: 'Ninguno', coins: 0 };
  const base = [ninguno, { name: 'Rose', coins: 1 }, { name: 'Lion', coins: 29999 }];
  const merged = mergeCatalog(base, [{ name: 'Super GG', coins: 30 }, { name: 'rose', coins: 1 }, { name: 'Perfume', coins: 20 }]);
  assert.deepEqual(merged.map((g) => g.name), ['Ninguno', 'Rose', 'Perfume', 'Super GG', 'Lion']);
  assert.equal(merged[0], ninguno);
  assert.equal(mergeCatalog(base, [{ name: 'ROSE', coins: 1 }]), base, 'nothing new: the same list, so panels do not re-preselect');
});

test('with no TikTok list loaded yet nothing is merged', () => {
  assert.deepEqual(mergeCatalog([], [{ name: 'Super GG', coins: 30 }]), []);
});
