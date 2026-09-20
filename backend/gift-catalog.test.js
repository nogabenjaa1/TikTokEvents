const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGift, giftNameKey, mergeGiftCatalogs } = require('./lib/giftCatalog');

test('a raw TikTok gift is normalized, and one without an image is kept (with an empty icon)', () => {
  assert.deepEqual(normalizeGift({ id: 5655, name: 'Rose', diamond_count: 1, image: { url_list: ['https://x/rose.png'] } }),
    { id: 5655, name: 'Rose', coins: 1, icon: 'https://x/rose.png' });
  assert.deepEqual(normalizeGift({ id: 9, name: 'Nuevo', diamond_count: 30 }), { id: 9, name: 'Nuevo', coins: 30, icon: '' });
  assert.equal(normalizeGift({ id: 1, diamond_count: 5 }), null, 'no name: nothing to pick');
  assert.equal(normalizeGift(null), null);
});

test('gift names compare without case, accents or extra spaces', () => {
  assert.equal(giftNameKey('  Corazón   Grande '), giftNameKey('corazon grande'));
  assert.notEqual(giftNameKey('Rose'), giftNameKey('Rosa'));
});

test('merging keeps every gift from every source once, preferring the entry that has an icon and coins', () => {
  const generic = [
    { id: 1, name: 'Rose', diamond_count: 1, image: { url_list: ['https://x/rose.png'] } },
    { id: 2, name: 'Lion', diamond_count: 29999 },
  ];
  const room = [
    { id: 2, name: 'lion', diamond_count: 29999, image: { url_list: ['https://x/lion.png'] } },
    { id: 3, name: 'Universe', diamond_count: 34999 },
  ];
  const seen = [{ id: 4, name: 'Nueva Ola', coins: 5, icon: 'https://x/ola.png' }, { id: 1, name: 'ROSE', coins: 1, icon: '' }];
  const merged = mergeGiftCatalogs(generic, room, seen);
  assert.deepEqual(merged.map((g) => g.name), ['Rose', 'Nueva Ola', 'Lion', 'Universe']);
  assert.equal(merged.find((g) => g.name === 'Lion').icon, 'https://x/lion.png', 'the icon from the second source fills the gap');
  assert.equal(merged.find((g) => g.name === 'Rose').icon, 'https://x/rose.png');
  assert.equal(merged.filter((g) => giftNameKey(g.name) === 'rose').length, 1);
});

test('merging tolerates missing or malformed lists', () => {
  assert.deepEqual(mergeGiftCatalogs(undefined, null, [], 'x', [null, {}, { name: 'A', coins: 3 }]), [{ id: null, name: 'A', coins: 3, icon: '' }]);
});
