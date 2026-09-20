const test = require('node:test');
const assert = require('node:assert/strict');
const { createGiftDirectory, sanitizeGift, MAX_GIFTS } = require('./lib/giftDirectoryCore');

const silent = { error() {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a gift received from TikTok is cleaned and needs an id and a name', () => {
  assert.deepEqual(sanitizeGift({ giftId: 6064, name: '  GG ', diamondCount: 1, giftPictureUrl: 'https://p16.tiktokcdn.com/gg.png' }),
    { id: 6064, name: 'GG', coins: 1, icon: 'https://p16.tiktokcdn.com/gg.png' });
  assert.equal(sanitizeGift({ giftId: 0, name: 'x' }), null, 'no valid id');
  assert.equal(sanitizeGift({ giftId: 'abc', name: 'x' }), null);
  assert.equal(sanitizeGift({ giftId: 5, name: '   ' }), null, 'no name');
  assert.equal(sanitizeGift(null), null);
});

test('coins and icon are sanitized: whole non-negative coins, https icons only, bounded sizes', () => {
  assert.equal(sanitizeGift({ id: 1, name: 'A', coins: -4 }).coins, 0);
  assert.equal(sanitizeGift({ id: 1, name: 'A', coins: 'x' }).coins, 0);
  assert.equal(sanitizeGift({ id: 1, name: 'A', coins: 99999999999 }).coins, 9_999_999);
  assert.equal(sanitizeGift({ id: 1, name: 'A', icon: 'javascript:alert(1)' }).icon, '');
  assert.equal(sanitizeGift({ id: 1, name: 'A', icon: 'http://insecure/x.png' }).icon, '');
  assert.equal(sanitizeGift({ id: 1, name: 'A', icon: `https://x/${'a'.repeat(600)}` }).icon, '');
  assert.equal(sanitizeGift({ id: 1, name: 'a'.repeat(200) }).name.length, 60);
});

test('a new gift is recorded once and saved in the background; the same gift again writes nothing', async () => {
  const saved = [];
  const directory = createGiftDirectory({ listRows: async () => [], upsertRow: async (gift) => { saved.push(gift); }, log: silent });
  assert.equal(directory.record({ giftId: 77, name: 'Super GG', diamondCount: 30, giftPictureUrl: 'https://x/gg.png' }), true);
  assert.equal(directory.record({ giftId: 77, name: 'Super GG', diamondCount: 30, giftPictureUrl: 'https://x/gg.png' }), false);
  await flush();
  assert.deepEqual(saved, [{ id: 77, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }]);
  assert.deepEqual(directory.list(), saved);
});

test('a gift that arrives later with the icon or coins it lacked is completed, never downgraded', async () => {
  const saved = [];
  const directory = createGiftDirectory({ listRows: async () => [], upsertRow: async (gift) => { saved.push(gift); }, log: silent });
  directory.record({ id: 5, name: 'Rose', coins: 1 });
  directory.record({ id: 5, name: 'Rose', coins: 1, icon: 'https://x/rose.png' });
  directory.record({ id: 5, name: 'Rose', coins: 1 });
  await flush();
  assert.equal(directory.list()[0].icon, 'https://x/rose.png', 'a later event without icon keeps the known one');
  assert.equal(saved.length, 2, 'only the two real changes were written');
});

test('the saved gifts are read once and merged, even if loading is requested many times', async () => {
  let reads = 0;
  const directory = createGiftDirectory({
    listRows: async () => { reads++; return [{ gift_id: '77', name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }, { gift_id: 'bad', name: 'x' }]; },
    upsertRow: async () => {}, log: silent,
  });
  await Promise.all([directory.load(), directory.load(), directory.load()]);
  assert.equal(reads, 1);
  assert.deepEqual(directory.list(), [{ id: 77, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }], 'rows without a valid id are ignored');
  assert.equal(directory.record({ id: 77, name: 'Super GG', coins: 30, icon: 'https://x/gg.png' }), false, 'what is already saved is not rewritten');
});

test('a database that fails never breaks a LIVE: reading falls back to empty and retries, saving is only logged', async () => {
  const errors = [];
  let attempts = 0;
  const directory = createGiftDirectory({
    listRows: async () => { attempts++; if (attempts === 1) throw new Error('db down'); return [{ gift_id: '1', name: 'Rose', coins: 1, icon: '' }]; },
    upsertRow: async () => { throw new Error('write failed'); },
    log: { error: (message) => errors.push(message) },
  });
  await directory.load();
  assert.deepEqual(directory.list(), []);
  await directory.load();
  assert.equal(directory.list().length, 1, 'the second attempt works');
  assert.doesNotThrow(() => directory.record({ id: 9, name: 'Nuevo', coins: 5 }));
  await flush();
  assert.ok(errors.some((line) => line.includes('No se pudo guardar')), 'the failure is logged');
  assert.ok(directory.list().some((g) => g.id === 9), 'and the gift is still available in memory');
});

test('the directory is bounded so it cannot grow without limit', () => {
  const directory = createGiftDirectory({ listRows: async () => [], upsertRow: async () => {}, log: silent });
  for (let i = 1; i <= MAX_GIFTS; i++) directory.record({ id: i, name: `Regalo ${i}`, coins: 1 });
  assert.equal(directory.list().length, MAX_GIFTS);
  assert.equal(directory.record({ id: MAX_GIFTS + 1, name: 'De más', coins: 1 }), false);
  assert.equal(directory.record({ id: 1, name: 'Regalo 1', coins: 2 }), true, 'known gifts can still be updated');
});
