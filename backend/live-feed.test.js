const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const feedModule = require('./lib/tenant/feed');

const { sanitizeFeedItem, FEED_MAX } = feedModule;

function feedTenant() {
  const tenant = Object.create(feedModule);
  tenant.feed = [];
  tenant.feedCounter = 0;
  tenant.sent = [];
  tenant.broadcast = { emit: (name, payload) => tenant.sent.push({ name, payload }) };
  return tenant;
}

test('a gift row keeps what the panel needs, and everything from TikTok is bounded', () => {
  const item = sanitizeFeedItem({ type: 'gift', username: '  ana  ', nickname: 'Ana  Ruiz', avatar: 'https://x/a.png', giftName: 'Rose', giftId: 5655, icon: 'https://x/rose.png', count: 7, coins: 7 });
  assert.deepEqual({ ...item }, { type: 'gift', username: 'ana', nickname: 'Ana Ruiz', avatar: 'https://x/a.png', giftName: 'Rose', giftId: 5655, icon: 'https://x/rose.png', count: 7, coins: 7 });
  const rude = sanitizeFeedItem({ type: 'gift', username: 'x'.repeat(200), nickname: 'n'.repeat(300), giftName: 'g'.repeat(300), avatar: 'javascript:alert(1)', icon: 'http://insecure/x.png', count: 1e12, coins: -5 });
  assert.equal(rude.username.length, 40);
  assert.equal(rude.nickname.length, 60);
  assert.equal(rude.giftName.length, 60);
  assert.equal(rude.avatar, '', 'only https images');
  assert.equal(rude.icon, '');
  assert.equal(rude.count, 999999);
  assert.equal(rude.coins, 0);
});

test('follows and stickers carry no gift data, and unknown or empty events are dropped', () => {
  const follow = sanitizeFeedItem({ type: 'follow', username: 'bob', giftName: 'Rose', icon: 'https://x/r.png', count: 9, coins: 9 });
  assert.deepEqual({ ...follow }, { type: 'follow', username: 'bob', nickname: 'bob', avatar: '', giftName: '', giftId: null, icon: '', count: 1, coins: 0 });
  assert.equal(sanitizeFeedItem({ type: 'sticker', username: 'carla' }).type, 'sticker');
  assert.equal(sanitizeFeedItem({ type: 'like', username: 'x' }), null, 'unknown type');
  assert.equal(sanitizeFeedItem({ type: 'follow', username: '   ' }), null, 'no user');
  assert.equal(sanitizeFeedItem(null), null);
});

test('the feed puts the newest first, tells the panel of each item, and keeps only the latest 50', () => {
  const tenant = feedTenant();
  for (let i = 1; i <= FEED_MAX + 10; i++) tenant.pushFeed({ type: 'follow', username: `user${i}` });
  assert.equal(tenant.feed.length, FEED_MAX);
  assert.equal(tenant.feed[0].username, `user${FEED_MAX + 10}`);
  assert.equal(tenant.feed.at(-1).username, 'user11');
  assert.equal(tenant.sent.length, FEED_MAX + 10);
  assert.ok(tenant.sent.every((message) => message.name === 'feed_item'));
  assert.deepEqual(tenant.feed.map((entry) => entry.id), [...tenant.feed.map((entry) => entry.id)].sort((a, b) => b - a), 'ids go down from newest to oldest');
  assert.equal(tenant.pushFeed({ type: 'nope', username: 'x' }), null);
  assert.equal(tenant.sent.length, FEED_MAX + 10, 'a dropped event is not sent');
});

test('a panel that connects (or reloads) receives what is recent in one message', () => {
  const tenant = feedTenant();
  tenant.pushFeed({ type: 'follow', username: 'ana' });
  tenant.pushFeed({ type: 'gift', username: 'bob', giftName: 'Rose', count: 3, coins: 3 });
  const sent = [];
  tenant.registerFeedHandlers({ emit: (...args) => sent.push(args) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'feed_snapshot');
  assert.deepEqual(Array.from(sent[0][1], (entry) => entry.username), ['bob', 'ana']);
});

// El módulo real de eventos (follows y stickers), sin DB ni TikTok.
function eventsTenant() {
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : name.includes('giftCatalog') ? require('./lib/giftCatalog') : name.includes('giftDirectory') ? { record() {} } : {}),
    setTimeout, clearTimeout, Date, console, Math, Number, String, Map, Set, Object, Array,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/events'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  const feed = [];
  const alerts = [];
  tenant.pushFeed = (item) => feed.push({ ...item });
  tenant.processAlertTrigger = (payload) => alerts.push(payload);
  tenant.processFollowExtensible = () => {};
  tenant.processFollowGoal = () => {};
  return { tenant, feed, alerts };
}

test('a follow goes to the feed (and still fires its alert); a share does not', () => {
  const { tenant, feed, alerts } = eventsTenant();
  tenant.handleSocialEvent({ uniqueId: 'ana', nickname: 'Ana', profilePictureUrl: 'https://x/a.png', action: '1' });
  assert.deepEqual(feed, [{ type: 'follow', username: 'ana', nickname: 'Ana', avatar: 'https://x/a.png' }]);
  assert.equal(alerts.length, 1);
  tenant.handleSocialEvent({ uniqueId: 'bob', action: '3' });
  assert.equal(feed.length, 1, 'not a follow: nothing new');
});

test('a fan club sticker goes to the feed, an ordinary emote does not', () => {
  const { tenant, feed, alerts } = eventsTenant();
  tenant.handleEmoteEvent({ uniqueId: 'carla', nickname: 'Carla', emoteList: [{ emoteType: 2 }] });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].type, 'sticker');
  assert.equal(alerts.length, 1);
  tenant.handleEmoteEvent({ uniqueId: 'dani', emoteList: [{ emoteType: 1 }] });
  assert.equal(feed.length, 1);
});
