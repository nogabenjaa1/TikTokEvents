const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  MAX_STICKER_ALERTS_PER_COMMENT,
  STICKER_REPEAT_WINDOW_MS,
  STICKER_TTS_WAIT_MAX_MS,
  isFanClubEmote,
  stickerFromEmote,
  extractStickers,
  readableCommentText,
  stickerAlertKey,
  stickerIdFromKey,
  pickStickerAlerts,
  createStickerRepeatGuard,
} = require('./lib/stickerCatalog');
const { createStickerDirectory, MAX_STICKERS } = require('./lib/stickerDirectoryCore');

const ID_A = '7121025198379731714';
const ID_B = '7121025198379731999';
const URL_A = 'https://p19-webcast.tiktokcdn.com/webcast-sg/aaa~tplv-obj.image';
const URL_B = 'https://p16-webcast.tiktokcdn.com/webcast-sg/bbb~tplv-obj.image';
// What the library hands us for an emote inside a comment (already simplified) ...
const chatEmote = (id, url, extra = {}) => ({ emoteId: id, emoteImageUrl: url, placeInComment: 3, emoteType: 2, emoteScene: 2, rewardCondition: 2, ...extra });
// ... and for the stand-alone sticker event (the protobuf model as is).
const eventEmote = (id, url) => ({ emoteId: id, image: { urlList: [url] }, emoteType: 2, emoteScene: 2, rewardCondition: 2 });

// ── What counts as a fan club sticker and what comes out of a message ────────

test('only fan club emotes count, whichever of the three markers says so', () => {
  assert.equal(isFanClubEmote({ emoteType: 2 }), true);
  assert.equal(isFanClubEmote({ emoteScene: 2 }), true);
  assert.equal(isFanClubEmote({ rewardCondition: 2 }), true);
  assert.equal(isFanClubEmote({ emoteType: '2' }), true);
  assert.equal(isFanClubEmote({ emoteScene: 'FANS_CLUB' }), true);
  assert.equal(isFanClubEmote({ emoteType: 0, emoteScene: 0, rewardCondition: 0 }), false);
  assert.equal(isFanClubEmote({ emoteType: 1 }), false, 'a normal sticker is not from the club');
  assert.equal(isFanClubEmote({ emoteScene: 'SUBSCRIPTION' }), false);
  assert.equal(isFanClubEmote(null), false);
  assert.equal(isFanClubEmote({}), false);
});

test('a sticker is read the same from a comment and from the sticker event', () => {
  assert.deepEqual({ ...stickerFromEmote(chatEmote(ID_A, URL_A)) }, { id: ID_A, imageUrl: URL_A });
  assert.deepEqual({ ...stickerFromEmote(eventEmote(ID_A, URL_A)) }, { id: ID_A, imageUrl: URL_A });
  assert.deepEqual({ ...stickerFromEmote({ emoteId: 'not-a-number', emoteImageUrl: 'http://insecure/x.png' }) }, { id: '', imageUrl: '' });
  assert.equal(stickerFromEmote({ emoteId: ID_A, emoteImageUrl: 'https://x/' + 'a'.repeat(600) }).imageUrl, '', 'a huge address is dropped');
  assert.equal(stickerFromEmote({ emoteId: ID_A }).imageUrl, '');
});

test('the same sticker many times in one comment is one sticker (spam protection)', () => {
  const emotes = [chatEmote(ID_A, URL_A), chatEmote(ID_A, URL_A), chatEmote(ID_A, URL_A), chatEmote(ID_A, URL_A)];
  const stickers = extractStickers(emotes);
  assert.equal(stickers.length, 1);
  assert.equal(stickers[0].id, ID_A);
});

test('different stickers stay separate and in the order they came', () => {
  const stickers = extractStickers([chatEmote(ID_B, URL_B), chatEmote(ID_A, URL_A), chatEmote(ID_B, URL_B)]);
  assert.deepEqual(stickers.map((s) => s.id), [ID_B, ID_A]);
});

test('any emote with an id is a sticker, and each says whether TikTok marks it as fan club', () => {
  // Nobody could check against a real LIVE that TikTok always marks a channel's emotes as fan club,
  // so an emote with an id still counts: it can have its own alert and shows in the picker.
  const unmarked = chatEmote(ID_A, URL_A, { emoteType: 0, emoteScene: 0, rewardCondition: 0 });
  const bare = { emoteId: ID_B, emoteImageUrl: URL_B };
  const stickers = extractStickers([unmarked, bare, chatEmote('42', URL_A)]);
  assert.deepEqual(stickers.map((s) => [s.id, s.club]), [[ID_A, false], [ID_B, false], ['42', true]]);
});

test('an emote with no id and no fan club marker is not a sticker', () => {
  assert.deepEqual(extractStickers([{ emoteType: 1 }, { emoteId: 'x', emoteType: 0 }, {}]), []);
});

test('a sticker seen both marked and unmarked in one comment counts as fan club', () => {
  const stickers = extractStickers([chatEmote(ID_A, URL_A, { emoteType: 0, emoteScene: 0, rewardCondition: 0 }), chatEmote(ID_A, URL_A)]);
  assert.equal(stickers.length, 1);
  assert.equal(stickers[0].club, true);
});

test('a repeated sticker keeps the image from whichever copy had one', () => {
  const stickers = extractStickers([chatEmote(ID_A, undefined), chatEmote(ID_A, URL_A)]);
  assert.equal(stickers.length, 1);
  assert.equal(stickers[0].imageUrl, URL_A);
});

test('a fan club sticker with no usable id still counts, once, for the general alert', () => {
  const stickers = extractStickers([{ emoteType: 2 }, { emoteScene: 2, emoteId: 'x' }]);
  assert.deepEqual(stickers.map((s) => [s.id, s.club]), [['', true]]);
});

test('nothing breaks with a missing or odd emote list', () => {
  assert.deepEqual(extractStickers(undefined), []);
  assert.deepEqual(extractStickers(null), []);
  assert.deepEqual(extractStickers('nope'), []);
  assert.deepEqual(extractStickers([null, undefined, 5]), []);
});

// ── The text the voice reads ─────────────────────────────────────────────────

test('the text left for the voice has no sticker markers and no invisible characters', () => {
  assert.equal(readableCommentText('hola a todos [rosa]'), 'hola a todos');
  assert.equal(readableCommentText('[rosa] hola [otro] amigos'), 'hola amigos');
  assert.equal(readableCommentText('[rosa][rosa][rosa]'), '', 'only stickers: nothing to read');
  const invisible = `hola${String.fromCharCode(0xFFFC)}${String.fromCharCode(0x200B)}${String.fromCharCode(0xE001)} mundo`;
  assert.equal(readableCommentText(invisible), 'hola mundo');
  assert.equal(readableCommentText('  muchos     espacios  '), 'muchos espacios');
  assert.equal(readableCommentText(undefined), '');
  assert.equal(readableCommentText(null), '');
});

// ── Alerts keys and which alerts a comment fires ─────────────────────────────

test('the alert of a sticker is keyed by its id, the general one keeps its old key', () => {
  assert.equal(stickerAlertKey(ID_A), `sticker:${ID_A}`);
  assert.equal(stickerAlertKey(''), 'sticker');
  assert.equal(stickerAlertKey(undefined), 'sticker');
  assert.equal(stickerIdFromKey(`sticker:${ID_A}`), ID_A);
  assert.equal(stickerIdFromKey('sticker'), '');
  assert.equal(stickerIdFromKey('follow'), '');
  assert.equal(stickerIdFromKey('sticker:abc'), '');
  assert.equal(stickerIdFromKey('Rose'), '');
});

const own = { A: { name: 'own-a' }, B: { name: 'own-b' } };
const generic = { name: 'generic' };
const find = (id) => ({ [ID_A]: own.A, [ID_B]: own.B })[id] || null;

test('each sticker fires its own alert and the general one stays quiet', () => {
  const picked = pickStickerAlerts([{ id: ID_A }, { id: ID_B }], { findSpecific: find, generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['own-a', 'own-b']);
});

test('the general alert fires once, only for a sticker that has no alert of its own', () => {
  const picked = pickStickerAlerts([{ id: '1', club: true }, { id: ID_A, club: true }, { id: '2', club: true }], { findSpecific: find, generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['own-a', 'generic'], 'two unmatched stickers, one general alert');
  assert.equal(picked[1].sticker.id, '1');
});

test('a sticker TikTok does not mark as fan club never fires the general alert, only its own', () => {
  assert.deepEqual(pickStickerAlerts([{ id: '1', club: false }], { findSpecific: find, generic }), []);
  const picked = pickStickerAlerts([{ id: '1', club: false }, { id: ID_A, club: false }], { findSpecific: find, generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['own-a']);
});

test('the general alert does not go past the cap either', () => {
  const alerts = { 1: { name: 'a' }, 2: { name: 'b' }, 3: { name: 'c' } };
  const stickers = [{ id: '1', club: true }, { id: '2', club: true }, { id: '3', club: true }, { id: '4', club: true }];
  const picked = pickStickerAlerts(stickers, { findSpecific: (id) => alerts[id] || null, generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['a', 'b', 'c']);
});

test('the cap counts fired alerts, so plain stickers before them do not use it up', () => {
  const stickers = [...Array.from({ length: 5 }, (_, i) => ({ id: String(10 + i), club: false })), { id: ID_A, club: false }, { id: ID_B, club: false }];
  const picked = pickStickerAlerts(stickers, { findSpecific: find, generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['own-a', 'own-b']);
});

test('with no general alert an unmatched sticker fires nothing', () => {
  assert.deepEqual(pickStickerAlerts([{ id: '1', club: true }], { findSpecific: find, generic: null }), []);
  assert.deepEqual(pickStickerAlerts([], { findSpecific: find, generic }), []);
  assert.deepEqual(pickStickerAlerts(undefined, { findSpecific: find, generic }), []);
});

test('a sticker without a known id can only fire the general alert', () => {
  const picked = pickStickerAlerts([{ id: '', club: true }], { findSpecific: () => assert.fail('no id, nothing to look up'), generic });
  assert.deepEqual(picked.map((p) => p.alert.name), ['generic']);
});

test('a comment full of different stickers is capped', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: String(1000 + i) }));
  const picked = pickStickerAlerts(many, { findSpecific: (id) => ({ name: id }), generic });
  assert.equal(picked.length, MAX_STICKER_ALERTS_PER_COMMENT);
});

// ── Same user, same sticker, twice at once ───────────────────────────────────

test('the same user and sticker inside the window counts once, anything else counts', () => {
  const guard = createStickerRepeatGuard();
  const t = 1_000_000;
  assert.equal(guard.allow('ana', ID_A, t), true);
  assert.equal(guard.allow('ana', ID_A, t + 100), false, 'delivered twice');
  assert.equal(guard.allow('ana', ID_B, t + 100), true, 'another sticker');
  assert.equal(guard.allow('bob', ID_A, t + 100), true, 'another user');
  assert.equal(guard.allow('ana', ID_A, t + STICKER_REPEAT_WINDOW_MS + 1), true, 'a new comment later');
});

test('a blocked repeat does not extend the window', () => {
  const guard = createStickerRepeatGuard({ windowMs: 1000 });
  assert.equal(guard.allow('ana', ID_A, 0), true);
  assert.equal(guard.allow('ana', ID_A, 900), false);
  assert.equal(guard.allow('ana', ID_A, 1001), true, 'measured from the last one that counted');
});

test('the guard forgets old entries and never grows past its limit', () => {
  const guard = createStickerRepeatGuard({ windowMs: 1000, maxEntries: 50 });
  for (let i = 0; i < 500; i++) guard.allow(`user${i}`, ID_A, i);
  // The oldest were dropped: an early user is allowed again, the latest still blocked.
  assert.equal(guard.allow('user0', ID_A, 501), true);
  assert.equal(guard.allow('user499', ID_A, 501), false);
});

// ── The per-license catalog ──────────────────────────────────────────────────

function directory({ rows = [], failList = false, failSave = false } = {}) {
  const saved = [];
  const errors = [];
  const dir = createStickerDirectory({
    listRows: async () => { if (failList) throw new Error('db down'); return rows; },
    upsertRow: async (sticker) => { if (failSave) throw new Error('db down'); saved.push(sticker); },
    log: { error: (message) => errors.push(message) },
  });
  return { dir, saved, errors };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a new sticker is saved once and reported as new', async () => {
  const { dir, saved } = directory();
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), true);
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), false, 'seen again: nothing to tell');
  await settle();
  assert.deepEqual(saved, [{ id: ID_A, imageUrl: URL_A }]);
  assert.deepEqual(dir.list(), [{ id: ID_A, imageUrl: URL_A }]);
});

test('what was saved before is there after loading, and is not saved again', async () => {
  const { dir, saved } = directory({ rows: [{ emote_id: ID_A, image_url: URL_A }, { emote_id: 'junk', image_url: '' }] });
  await dir.load();
  assert.deepEqual(dir.list().map((s) => s.id), [ID_A], 'a row with no valid id is skipped');
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), false);
  await settle();
  assert.deepEqual(saved, []);
});

test('the first time a known sticker shows up after starting, a changed image is refreshed; later ones are not', async () => {
  const { dir, saved } = directory({ rows: [{ emote_id: ID_A, image_url: URL_A }] });
  await dir.load();
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_B }), true, 'TikTok changed the address');
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), false, 'no ping-pong between two addresses');
  await settle();
  assert.deepEqual(saved, [{ id: ID_A, imageUrl: URL_B }]);
});

test('a sticker first seen without an image gets it when a later one brings it', async () => {
  const { dir, saved } = directory();
  assert.equal(dir.record({ id: ID_A, imageUrl: '' }), true);
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), true);
  assert.equal(dir.record({ id: ID_A, imageUrl: '' }), false, 'no image never erases one');
  await settle();
  assert.equal(saved.length, 2);
  assert.equal(dir.list()[0].imageUrl, URL_A);
});

test('a sticker without a valid id is not kept, and there is a cap per license', async () => {
  const { dir } = directory();
  assert.equal(dir.record({ id: '', imageUrl: URL_A }), false);
  assert.equal(dir.record({ id: 'abc' }), false);
  assert.equal(dir.record(null), false);
  for (let i = 0; i < MAX_STICKERS + 20; i++) dir.record({ id: String(100000 + i), imageUrl: '' });
  assert.equal(dir.list().length, MAX_STICKERS);
});

test('a broken database never breaks the live: it only leaves a line in the log', async () => {
  const { dir, errors } = directory({ failList: true, failSave: true });
  await dir.load();
  assert.equal(dir.record({ id: ID_A, imageUrl: URL_A }), true, 'still remembered in memory');
  await settle();
  assert.equal(errors.length, 2);
  assert.match(errors[0], /catálogo/);
  assert.match(errors[1], new RegExp(ID_A));
});

// ── The tenant: alerts, waiting for the voice, panels ────────────────────────

function stickerTenant({ alertConfigs = {}, readyPanels = [], rows = [] } = {}) {
  const timers = [];
  const upserts = [];
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('stickerDirectoryCore') ? require('./lib/stickerDirectoryCore')
      : name.endsWith('stickerCatalog') ? require('./lib/stickerCatalog')
        : name === '../../db' ? { listSeenStickers: async () => rows, upsertSeenSticker: async (licenseId, sticker) => { upserts.push([licenseId, sticker]); } }
          : {}),
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    console,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/stickers'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  const emitted = [];
  const fired = [];
  const feed = [];
  Object.assign(tenant, {
    licenseId: 'lic-1', alertConfigs, stickerDirectory: null, stickerRepeatGuard: null,
    panelSockets: new Set(readyPanels), pendingStickerAlerts: new Map(),
    broadcast: { emit: (name, payload) => emitted.push({ name, payload }) },
    pushFeed: (item) => feed.push({ ...item }),
    emitAlertTriggered: (alert, info) => fired.push({ alert: alert.name, ...info }),
  });
  return { tenant, timers, upserts, emitted, fired, feed };
}

const ana = { username: 'ana', nickname: 'Ana', avatar: 'https://x/ana.png', userKey: '1' };
const alertA = { name: 'own-a' };
const alertB = { name: 'own-b' };
const alertAny = { name: 'generic' };

test('a sticker with no alert is still noted, shown in the activity feed and announced to the panel once', async () => {
  const { tenant, emitted, fired, feed, upserts } = stickerTenant();
  const held = tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A, imageUrl: URL_A, club: true }] });
  assert.equal(held, false);
  assert.deepEqual(fired, []);
  assert.deepEqual(feed.map((f) => [f.type, f.username, f.icon]), [['sticker', 'ana', URL_A]]);
  assert.deepEqual(emitted.map((e) => [e.name, e.payload.id]), [['sticker_seen', ID_A]]);
  tenant.processStickerUse({ ...ana, userKey: '2', username: 'bob', stickers: [{ id: ID_A, imageUrl: URL_A, club: true }] });
  assert.equal(emitted.length, 1, 'already known: the panel is not told again');
  assert.equal(feed.length, 2);
  await settle();
  assert.deepEqual(upserts, [['lic-1', { id: ID_A, imageUrl: URL_A }]]);
});

test('an emote TikTok does not mark as fan club is still kept for the picker, but is not news on its own', async () => {
  const { tenant, emitted, fired, feed, upserts } = stickerTenant({ alertConfigs: { sticker: alertAny } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A, imageUrl: URL_A, club: false }] });
  assert.deepEqual(emitted.map((e) => [e.name, e.payload.id]), [['sticker_seen', ID_A]], 'the panel can offer it in the picker');
  assert.deepEqual(fired, [], 'the general alert is for the fan club ones');
  assert.deepEqual(feed, [], 'nothing to show in the activity feed');
  await settle();
  assert.deepEqual(upserts, [['lic-1', { id: ID_A, imageUrl: URL_A }]]);
});

test('an emote not marked as fan club that has its own alert does fire it, and shows in the feed', () => {
  const { tenant, fired, feed } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA, sticker: alertAny } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A, imageUrl: URL_A, club: false }] });
  assert.deepEqual(fired.map((f) => f.alert), ['own-a']);
  assert.equal(feed.length, 1);
});

test('the sample of how TikTok marks the emotes is logged once per session, with no user data', () => {
  const lines = [];
  const { tenant } = stickerTenant();
  tenant.logId = 'ana/1234';
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    tenant.noteEmoteSample('chat', [chatEmote(ID_A, URL_A, { emoteType: 0, emoteScene: 0, rewardCondition: 0 })]);
    tenant.noteEmoteSample('emote', [chatEmote(ID_B, URL_B)]);
    tenant.noteEmoteSample('chat', []);
  } finally {
    console.log = realLog;
  }
  assert.equal(lines.length, 1, 'only the first one');
  assert.match(lines[0], /\[EMOTE\]/);
  assert.match(lines[0], /llegó como chat/);
  assert.match(lines[0], new RegExp(`"emoteId":"${ID_A}"`));
  assert.match(lines[0], /"emoteType":0/);
  assert.match(lines[0], /"conImagen":true/);
  assert.doesNotMatch(lines[0], /https:/, 'the image address is not printed');
});

test('nothing is logged for a missing or odd emote list', () => {
  const { tenant } = stickerTenant();
  const realLog = console.log;
  console.log = () => assert.fail('no sample to log');
  try {
    tenant.noteEmoteSample('chat', undefined);
    tenant.noteEmoteSample('chat', null);
    tenant.noteEmoteSample('chat', [null]);
    tenant.noteEmoteSample('chat', ['x']);
  } finally {
    console.log = realLog;
  }
});

test('the alert of a sticker fires once with the user of that comment', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA, sticker: alertAny } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A, imageUrl: URL_A }] });
  assert.deepEqual(fired, [{ alert: 'own-a', username: 'ana', nickname: 'Ana', count: 1 }]);
});

test('the same sticker listed twice still fires once, and shows once in the feed', () => {
  const { tenant, fired, feed } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A, imageUrl: URL_A }, { id: ID_A, imageUrl: URL_A }] });
  assert.equal(fired.length, 1);
  assert.equal(feed.length, 1);
});

test('two stickers with an alert each fire both, in order; a third without one falls back to the general alert once', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA, [`sticker:${ID_B}`]: alertB, sticker: alertAny } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }, { id: ID_B }] });
  assert.deepEqual(fired.map((f) => f.alert), ['own-a', 'own-b']);
  fired.length = 0;
  tenant.processStickerUse({ ...ana, userKey: '2', stickers: [{ id: '31', club: true }, { id: '32', club: true }, { id: ID_A, club: true }] });
  assert.deepEqual(fired.map((f) => f.alert), ['own-a', 'generic']);
});

test('the same user sending the same sticker again right away does not fire twice', () => {
  const { tenant, fired, feed } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA } });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }] });
  assert.equal(fired.length, 1);
  assert.equal(feed.length, 1, 'one action, one row');
});

test('with a panel that can say when the voice is done, the alerts wait for it', () => {
  const { tenant, fired, timers } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1'] });
  const held = tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  assert.equal(held, true, 'tells the voice message to ask the panel for the notice');
  assert.deepEqual(fired, [], 'not while the voice is reading');
  assert.equal(tenant.pendingStickerAlerts.size, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, STICKER_TTS_WAIT_MAX_MS);

  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.deepEqual(fired.map((f) => [f.alert, f.username]), [['own-a', 'ana']]);
  assert.equal(tenant.pendingStickerAlerts.size, 0);
  assert.equal(timers[0].cleared, true, 'the safety timer is not left running');
  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.equal(fired.length, 1, 'a second notice does nothing');
});

test('nothing waits when the comment has no text to read or no panel can say when it is done', () => {
  const noText = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1'] });
  assert.equal(noText.tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: false }), false);
  assert.equal(noText.fired.length, 1);

  const noPanel = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA } });
  assert.equal(noPanel.tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true }), false);
  assert.equal(noPanel.fired.length, 1);
  assert.equal(noPanel.timers.length, 0);

  const noAlert = stickerTenant({ readyPanels: ['panel-1'] });
  assert.equal(noAlert.tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true }), false, 'no alert, nothing to wait for');
  assert.equal(noAlert.timers.length, 0);
});

test('with two panels open the alerts come out when both are done, and a stranger cannot release them', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1', 'panel-2'] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  tenant.acknowledgeTtsMessage('overlay-9', 'm1');
  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.equal(fired.length, 0, 'panel-2 is still reading');
  tenant.acknowledgeTtsMessage('panel-2', 'm1');
  assert.equal(fired.length, 1);
});

test('closing the panel that was still reading releases the alerts; closing another does not', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1', 'panel-2'] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  tenant.forgetPanelSocket('panel-3');
  assert.equal(fired.length, 0);
  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.equal(fired.length, 0);
  tenant.forgetPanelSocket('panel-2');
  assert.equal(fired.length, 1);
  assert.equal(tenant.panelSockets.has('panel-2'), false);
});

test('a panel closing while another one is still reading does not release the alerts', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1', 'panel-2'] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  tenant.forgetPanelSocket('panel-2');
  assert.equal(fired.length, 0, 'panel-1 is still reading');
  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.equal(fired.length, 1);
});

test('if no notice ever arrives the alerts come out anyway after the maximum wait', () => {
  const { tenant, fired, timers } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1'] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  timers[0].fn();
  assert.equal(fired.length, 1);
  tenant.acknowledgeTtsMessage('panel-1', 'm1');
  assert.equal(fired.length, 1, 'the late notice finds nothing to release');
});

test('dropping the tenant clears the waiting alerts and their timers', () => {
  const { tenant, fired, timers } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1'] });
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  tenant.clearStickerHolds();
  assert.equal(timers[0].cleared, true);
  assert.equal(tenant.pendingStickerAlerts.size, 0);
  assert.equal(tenant.panelSockets.size, 0);
  assert.equal(fired.length, 0);
});

function fakeSocket(id, authMethod) {
  const handlers = {};
  return { id, authMethod, on: (name, fn) => { handlers[name] = fn; }, handlers };
}

test('only a panel session that says it can answer is waited for, and it stops being waited for when it leaves', () => {
  const { tenant } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA } });
  const panel = fakeSocket('panel-1', 'jwt');
  const overlay = fakeSocket('obs-1', 'key');
  const oldPanel = fakeSocket('panel-old', 'jwt');
  tenant.registerStickerHandlers(panel);
  tenant.registerStickerHandlers(overlay);
  tenant.registerStickerHandlers(oldPanel);
  assert.equal(tenant.panelSockets.size, 0, 'nobody is waited for until they say so');

  panel.handlers.tts_ack_ready();
  overlay.handlers.tts_ack_ready();
  assert.deepEqual([...tenant.panelSockets], ['panel-1'], 'an overlay never reads anything');

  panel.handlers.disconnect();
  assert.equal(tenant.panelSockets.size, 0);
});

test('the notice from a panel is checked before it is used', () => {
  const { tenant, fired } = stickerTenant({ alertConfigs: { [`sticker:${ID_A}`]: alertA }, readyPanels: ['panel-1'] });
  const panel = fakeSocket('panel-1', 'jwt');
  tenant.registerStickerHandlers(panel);
  tenant.processStickerUse({ ...ana, stickers: [{ id: ID_A }], messageId: 'm1', holdForTts: true });
  for (const junk of [undefined, null, 5, {}, '', 'x'.repeat(500)]) panel.handlers.tts_message_done(junk);
  assert.equal(fired.length, 0);
  panel.handlers.tts_message_done('m1');
  assert.equal(fired.length, 1);
});

// ── The comment handler: what the voice gets and when the alerts go ──────────

// The real events module, with what it calls around stubbed.
function chatTenant({ holds = false } = {}) {
  const context = {
    module: { exports: {} },
    require: (name) => (name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : name.includes('giftCatalog') ? require('./lib/giftCatalog')
      : name.includes('giftDirectory') ? { record() {} } : name.includes('stickerCatalog') ? require('./lib/stickerCatalog') : {}),
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/events'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  const spoken = [];
  const stickerCalls = [];
  const commands = [];
  tenant.broadcast = { emit: (name, payload) => { if (name === 'tts_chat_message') spoken.push(payload); } };
  tenant.processStickerUse = (payload) => { stickerCalls.push(payload); return holds; };
  tenant.noteEmoteSample = () => {};
  tenant.processPlayCommand = (comment) => commands.push(comment);
  tenant.processRouletteComment = () => {};
  return { tenant, spoken, stickerCalls, commands };
}
const chat = (extra) => ({ uniqueId: 'ana', nickname: 'Ana', userId: '9', msgId: 'm-1', content: 'hola', emotes: [], ...extra });

test('a comment with text and a sticker is read without the sticker marker, and its alert waits for the voice', () => {
  const { tenant, spoken, stickerCalls, commands } = chatTenant({ holds: true });
  tenant.handleChatEvent(chat({ content: 'hola a todos [rosa]', emotes: [chatEmote(ID_A, URL_A), chatEmote(ID_A, URL_A)] }));
  assert.equal(stickerCalls.length, 1);
  assert.equal(stickerCalls[0].holdForTts, true);
  assert.equal(stickerCalls[0].messageId, 'm-1');
  assert.deepEqual(stickerCalls[0].stickers.map((s) => s.id), [ID_A], 'repeated in the comment: one');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].comment, 'hola a todos');
  assert.equal(spoken[0].id, 'm-1', 'the same id the alerts wait on');
  assert.equal(spoken[0].holdsAlert, true, 'the panel must say when it is done');
  assert.deepEqual(commands, ['hola a todos']);
});

test('the alerts are decided before the voice message goes out, so they can wait for it', () => {
  const order = [];
  const { tenant } = chatTenant();
  tenant.processStickerUse = () => { order.push('stickers'); return true; };
  tenant.broadcast = { emit: (name) => order.push(name) };
  tenant.handleChatEvent(chat({ emotes: [chatEmote(ID_A, URL_A)] }));
  assert.deepEqual(order, ['stickers', 'tts_chat_message']);
});

test('a comment that is only stickers fires now and reads nothing', () => {
  for (const content of ['', '[rosa]', '[rosa][rosa]']) {
    const { tenant, spoken, stickerCalls } = chatTenant();
    tenant.handleChatEvent(chat({ content, emotes: [chatEmote(ID_A, URL_A)] }));
    assert.equal(stickerCalls.length, 1, `content ${JSON.stringify(content)}`);
    assert.equal(stickerCalls[0].holdForTts, false);
    assert.deepEqual(spoken, []);
  }
});

test('a command with a sticker is not read and does not make the alert wait', () => {
  const { tenant, spoken, stickerCalls, commands } = chatTenant();
  tenant.handleChatEvent(chat({ content: '!play una cancion [rosa]', emotes: [chatEmote(ID_A, URL_A)] }));
  assert.equal(stickerCalls[0].holdForTts, false);
  assert.deepEqual(spoken, []);
  assert.deepEqual(commands, ['!play una cancion'], 'the command is read without the marker too');
});

test('an ordinary comment is exactly as before: read as is, no sticker logic, nothing to wait for', () => {
  const { tenant, spoken, stickerCalls, commands } = chatTenant();
  tenant.handleChatEvent(chat({ content: 'hola [smile] a todos' }));
  assert.deepEqual(stickerCalls, []);
  assert.equal(spoken[0].comment, 'hola [smile] a todos', 'TikTok emoji codes are not touched');
  assert.equal(spoken[0].holdsAlert, false);
  assert.deepEqual(commands, ['hola [smile] a todos']);
});

test('an emote with no id and no fan club marker is not a sticker: its comment goes through untouched', () => {
  const { tenant, spoken, stickerCalls } = chatTenant();
  tenant.handleChatEvent(chat({ content: 'hola [rosa]', emotes: [{ emoteType: 0, emoteScene: 0, rewardCondition: 0 }] }));
  assert.deepEqual(stickerCalls, []);
  assert.equal(spoken[0].comment, 'hola [rosa]');
});

test('an emote that TikTok does not mark as fan club still counts as a sticker for the alerts and the voice text', () => {
  const { tenant, spoken, stickerCalls } = chatTenant();
  tenant.handleChatEvent(chat({ content: 'hola [rosa]', emotes: [chatEmote('5555', URL_A, { emoteType: 0, emoteScene: 0, rewardCondition: 0 })] }));
  assert.equal(stickerCalls.length, 1);
  assert.deepEqual(stickerCalls[0].stickers.map((s) => [s.id, s.club]), [['5555', false]]);
  assert.equal(spoken[0].comment, 'hola');
});

test('the emote sample is taken from every emote list that arrives, comment or sticker event', () => {
  const samples = [];
  const { tenant } = chatTenant();
  tenant.noteEmoteSample = (source, emotes) => samples.push([source, emotes.length]);
  tenant.processStickerUse = () => false;
  tenant.handleChatEvent(chat({ content: 'hola', emotes: [chatEmote(ID_A, URL_A)] }));
  tenant.handleEmoteEvent({ uniqueId: 'ana', emoteList: [eventEmote(ID_A, URL_A), eventEmote(ID_B, URL_B)] });
  assert.deepEqual(samples, [['chat', 1], ['emote', 2]]);
});

test('an empty comment with no stickers is dropped, as always', () => {
  const { tenant, spoken, stickerCalls } = chatTenant();
  tenant.handleChatEvent(chat({ content: '   ' }));
  tenant.handleChatEvent(chat({ content: undefined }));
  assert.deepEqual(spoken, []);
  assert.deepEqual(stickerCalls, []);
});
