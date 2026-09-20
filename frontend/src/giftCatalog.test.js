import test from 'node:test';
import assert from 'node:assert/strict';
import { giftKey, cleanGift, loadExtraGifts, saveExtraGifts, addExtraGift, mergeCatalog, findGiftByName } from './giftCatalog.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('a gift written by hand is cleaned: trimmed name, whole non-negative coins, no junk', () => {
  assert.deepEqual(cleanGift({ name: '  Super   GG ', coins: '99.9' }), { id: null, name: 'Super GG', coins: 99, icon: '' });
  assert.equal(cleanGift({ name: 'x' }), null, 'too short to be a real gift name');
  assert.equal(cleanGift({ name: '' }), null);
  assert.equal(cleanGift(null), null);
  assert.equal(cleanGift({ name: 'Rose', coins: -5 }).coins, 0);
  assert.equal(cleanGift({ name: 'Rose', coins: 'abc' }).coins, 0);
  assert.equal(cleanGift({ name: 'a'.repeat(200) }).name.length, 60);
});

test('gift names compare without case, accents or spacing', () => {
  assert.equal(giftKey('Súper  GG'), giftKey('super gg'));
  assert.notEqual(giftKey('Rose'), giftKey('Rosa'));
});

test('adding a gift never repeats it, and completes a known one that lacked an icon or coins', () => {
  let list = addExtraGift([], { name: 'Super GG' });
  assert.equal(list.length, 1);
  assert.equal(addExtraGift(list, { name: 'super gg' }), list, 'same gift: the list is returned untouched');
  list = addExtraGift(list, { id: 77, name: 'SUPER GG', coins: 30, icon: 'https://x/gg.png' });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 77, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }, 'keeps its own name and gains the missing data');
  assert.equal(addExtraGift(list, { name: '' }), list);
});

test('the extras are remembered in the browser and survive bad or blocked storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadExtraGifts(storage), []);
  saveExtraGifts([{ id: 1, name: 'Super GG', coins: 30, icon: '' }], storage);
  assert.deepEqual(loadExtraGifts(storage), [{ id: 1, name: 'Super GG', coins: 30, icon: '' }]);
  assert.deepEqual(loadExtraGifts(memoryStorage({ tkc_extra_gifts: '{not json' })), []);
  assert.deepEqual(loadExtraGifts(memoryStorage({ tkc_extra_gifts: '"text"' })), []);
  assert.deepEqual(loadExtraGifts({ getItem() { throw new Error('blocked'); } }), []);
  assert.doesNotThrow(() => saveExtraGifts([], { setItem() { throw new Error('full'); } }));
});

test('the extras are capped so the storage cannot grow forever, keeping the most recent', () => {
  let list = [];
  for (let i = 0; i < 250; i++) list = addExtraGift(list, { name: `Regalo ${i}` });
  assert.equal(list.length, 200);
  assert.equal(list.at(-1).name, 'Regalo 249');
  assert.equal(list[0].name, 'Regalo 50');
});

test('merging adds the missing gifts to the TikTok list, keeps the first one first, and sorts the rest', () => {
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

test('writing a gift that already exists finds the real one, whatever the case, accents or spacing', () => {
  const list = [{ id: 1, name: 'Rose', coins: 1, icon: '/rose.png' }, { id: null, name: 'Súper GG', coins: 30, icon: '' }];
  assert.equal(findGiftByName(list, '  rose '), list[0]);
  assert.equal(findGiftByName(list, 'super   gg'), list[1]);
  assert.equal(findGiftByName(list, 'Lion'), null);
  assert.equal(findGiftByName(list, ''), null);
  assert.equal(findGiftByName([], 'Rose'), null);
});
