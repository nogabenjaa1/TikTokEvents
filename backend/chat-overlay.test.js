const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The chat overlay (Events > Chat): what each TikTok event turns into, the settings the panel sends, and who
// receives the chat (only the chat overlays and the panel's Chat tab, never every screen of the license).

const {
  CHAT_SETTINGS_DEFAULTS, sanitizeChatSettings, badgesFrom, chatMessageItem, followItem, shareItem, giftItem,
  isShareSocial, pinnedFromRoomPin, FADE_MAX_SECONDS, MAX_MESSAGES_MAX, FONT_SIZE_MIN, FONT_SIZE_MAX,
} = require('./lib/chatOverlay');

test('settings: defaults, limits, and anything invalid keeps what was there', () => {
  assert.equal(CHAT_SETTINGS_DEFAULTS.newestOnTop, false, 'first message on top and each new one below it, like the TikTok chat');
  assert.equal(CHAT_SETTINGS_DEFAULTS.fadeSeconds, 30);
  const s = sanitizeChatSettings({ fadeSeconds: 99999, maxMessages: 0, fontSize: 4, showGifts: 0, newestOnTop: true });
  assert.equal(s.fadeSeconds, FADE_MAX_SECONDS);
  assert.equal(s.maxMessages, 1);
  assert.equal(s.fontSize, FONT_SIZE_MIN);
  assert.equal(s.showGifts, false);
  assert.equal(s.newestOnTop, true);
  assert.equal(sanitizeChatSettings({ fontSize: 99 }).fontSize, FONT_SIZE_MAX);
  assert.equal(sanitizeChatSettings({ maxMessages: 999 }).maxMessages, MAX_MESSAGES_MAX);
  assert.equal(sanitizeChatSettings({ fadeSeconds: 0 }).fadeSeconds, 0, '0 = never fades');
  const kept = sanitizeChatSettings({ fadeSeconds: 'nope', fontSize: null }, { ...CHAT_SETTINGS_DEFAULTS, fadeSeconds: 45, fontSize: 20 });
  assert.equal(kept.fadeSeconds, 45);
  assert.equal(kept.fontSize, 20);
  assert.deepEqual(Object.keys(sanitizeChatSettings({ evil: 'x', __proto__: { a: 1 } })).sort(), Object.keys(CHAT_SETTINGS_DEFAULTS).sort(), 'no unknown keys');
  assert.deepEqual(sanitizeChatSettings(null), { ...CHAT_SETTINGS_DEFAULTS });
});

test('badges: the real TikTok badge images (https only, no repeats, at most 4) plus what the library resolves', () => {
  const b = badgesFrom({
    userBadges: [
      { url: 'https://p16/fans_lv12.png' }, { url: 'https://p16/fans_lv12.png' }, { url: 'http://insecure/x.png' },
      { url: 'javascript:alert(1)' }, { url: 'https://p16/b.png' }, { url: 'https://p16/c.png' }, { url: 'https://p16/d.png' }, { url: 'https://p16/e.png' },
    ],
    isModerator: true, isSubscriber: false, topGifterRank: 2, teamMemberLevel: 12, gifterLevel: 30,
  });
  assert.deepEqual(b.images, ['https://p16/fans_lv12.png', 'https://p16/b.png', 'https://p16/c.png', 'https://p16/d.png']);
  assert.equal(b.moderator, true);
  assert.equal(b.subscriber, false);
  assert.equal(b.topGifterRank, 2);
  assert.equal(b.fanLevel, 12);
  assert.equal(b.gifterLevel, 30);
  assert.equal(badgesFrom({ userIdentity: { isModeratorOfAnchor: true } }).moderator, true);
  assert.equal(badgesFrom({ topGifterRank: 9 }).topGifterRank, 3, 'only the top 3');
  assert.equal(badgesFrom({}).topGifterRank, null);
});

test('badges: images of roles already drawn as icons are not repeated in "others"', () => {
  // Mismo formato que arma tiktok-live-connector (mapBadges): cada insignia con su badgeSceneType.
  const b = badgesFrom({
    userBadges: [
      { type: 'image', badgeSceneType: 1, url: 'https://p16/moderator.png' },
      { type: 'image', badgeSceneType: 10, url: 'https://p16/fans_lv12.png' },
      { type: 'image', badgeSceneType: 8, url: 'https://p16/gifter_lv30.png' },
      { type: 'image', badgeSceneType: 4, url: 'https://p16/sub_1.png' },
      { type: 'image', badgeSceneType: 6, url: 'https://p16/ranklist_top_gifter_2.png' },
      { type: 'image', badgeSceneType: 3, url: 'https://p16/otro_reconocimiento.png' },
      { type: 'privilege', badgeSceneType: 8, level: 30 },
    ],
    isModerator: true, isSubscriber: true, topGifterRank: 2, teamMemberLevel: 12, gifterLevel: 30,
  });
  assert.deepEqual(b.others, ['https://p16/otro_reconocimiento.png'], 'solo lo que no es un rol ya dibujado');
  assert.equal(b.images.length, 4, 'images se mantiene como antes (compatibilidad)');
  assert.deepEqual(badgesFrom({}).others, []);
  assert.deepEqual(badgesFrom({ userBadges: [{ url: 'https://p16/sin_tipo.png' }] }).others, ['https://p16/sin_tipo.png'], 'sin tipo conocido: es otro reconocimiento');
});

test('a chat message keeps everything, commands and @mentions included, with its stickers', () => {
  const data = { uniqueId: 'ana', nickname: 'Ana  ⭐', profilePictureUrl: 'https://p16/ana.jpg' };
  assert.equal(chatMessageItem(data, { rawComment: '!play despacito' }).text, '!play despacito');
  assert.equal(chatMessageItem(data, { rawComment: '@bob hola' }).text, '@bob hola');
  const onlySticker = chatMessageItem(data, { rawComment: '', emotes: [{ emoteImageUrl: 'https://p16/emote.png' }, { emoteImageUrl: 'http://bad' }] });
  assert.deepEqual(onlySticker.parts, [{ type: 'emote', url: 'https://p16/emote.png' }], 'a sticker sent alone is a message of its own');
  const withSticker = onlySticker;
  assert.equal(withSticker.user.nickname, 'Ana ⭐', 'spaces collapsed');
  assert.equal(chatMessageItem(data, { rawComment: 'x'.repeat(500) }).text.length, 300);
  assert.equal(chatMessageItem({ uniqueId: '' }, { rawComment: 'hola' }), null, 'no user, no message');
  assert.equal(chatMessageItem(data, { rawComment: '   ' }), null, 'nothing to show');
  assert.equal(chatMessageItem({ ...data, profilePictureUrl: 'http://x/a.jpg' }, { rawComment: 'hola' }).user.avatar, '', 'https only');
});

test('follows, shares and gifts become their own chat events', () => {
  assert.deepEqual(followItem({ uniqueId: 'ana', nickname: 'Ana' }).kind, 'follow');
  assert.equal(followItem({}), null);
  assert.equal(shareItem({ uniqueId: 'bob' }).kind, 'share');
  const gift = giftItem({ username: 'carla', nickname: 'Carla', avatar: 'https://p16/c.jpg', giftName: 'Rose', icon: 'https://p16/rose.png', count: 7, coins: 7, badgesSource: { isModerator: true } });
  assert.equal(gift.kind, 'gift');
  assert.deepEqual(gift.gift, { name: 'Rose', icon: 'https://p16/rose.png', count: 7, coins: 7 });
  assert.equal(gift.user.badges.moderator, true, 'the sender keeps their badges');
  assert.equal(giftItem({ username: '', giftName: 'Rose' }), null);
});

test('a share is recognised only when it is not a follow and carries share data', () => {
  assert.equal(isShareSocial({ action: '1', shareType: '1' }), false, 'action 1 is always a follow');
  assert.equal(isShareSocial({ action: '3', shareType: '1' }), true);
  assert.equal(isShareSocial({ action: '3', shareTarget: 'abc' }), true);
  assert.equal(isShareSocial({ action: '3', shareCount: 2 }), true);
  assert.equal(isShareSocial({ action: '3' }), false, 'no share data: ignored');
});

test('a pinned message: pin carries the raw TikTok message, unpin clears it, anything else is ignored', () => {
  const pin = pinnedFromRoomPin({ action: 1, displayDuration: '60', chatMessage: { content: 'Bienvenidos', user: { displayId: 'mod1', nickname: 'Mod', avatarThumb: { urlList: ['https://p16/m.jpg'] } } } });
  assert.equal(pin.action, 'pin');
  assert.equal(pin.item.text, 'Bienvenidos');
  assert.equal(pin.item.user.uniqueId, 'mod1');
  assert.equal(pin.item.user.avatar, 'https://p16/m.jpg');
  assert.equal(pin.item.durationSeconds, 60);
  assert.deepEqual(pinnedFromRoomPin({ action: 2 }), { action: 'unpin' });
  assert.equal(pinnedFromRoomPin({ action: 0 }), null);
  assert.equal(pinnedFromRoomPin({ action: 1, chatMessage: { content: '' } }), null, 'a pin with no text is not shown');
});

// ── The tenant side: rooms, settings and the pinned message ──

function chatTenant() {
  const saved = [];
  const emitted = [];
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('/db') ? { setChatSettings: async (id, s) => { saved.push(s); } } : name.includes('chatOverlay') ? require('./lib/chatOverlay') : {}),
    console: { log() {}, error() {} }, setTimeout, clearTimeout, Date,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/chatOverlay'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.licenseId = 'l1';
  tenant.logId = 'ana/l1';
  tenant.io = { to: (room) => ({ emit: (name, payload) => emitted.push({ room, name, payload: JSON.parse(JSON.stringify(payload)) }) }) };
  Object.defineProperty(tenant, 'broadcast', { get: () => tenant.io.to('l1') });
  tenant.initChatOverlayState();
  return { tenant, emitted, saved };
}

function fakeSocket({ authMethod = 'jwt', overlayScreen } = {}) {
  const handlers = {};
  const rooms = new Set();
  const sent = [];
  return {
    authMethod, handshake: { auth: { overlayScreen } }, rooms, sent,
    join: (room) => rooms.add(room), leave: (room) => rooms.delete(room),
    emit: (name, payload) => sent.push({ name, payload }),
    on: (name, handler) => { handlers[name] = handler; },
    fire: (name, payload) => handlers[name](payload),
  };
}

test('the chat goes only to its own room, not to every screen of the license', () => {
  const { tenant, emitted } = chatTenant();
  tenant.pushChatItem(chatMessageItem({ uniqueId: 'ana' }, { rawComment: 'hola' }));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, 'l1:chat');
  assert.equal(emitted[0].name, 'chat_item');
  assert.equal(emitted[0].payload.kind, 'chat');
  assert.ok(emitted[0].payload.id && emitted[0].payload.at);
  tenant.pushChatItem(null);
  assert.equal(emitted.length, 1, 'nothing to push, nothing sent');
});

test('a chat overlay joins the chat room by itself and gets the recent chat; other overlays do not', () => {
  const { tenant } = chatTenant();
  tenant.pushChatItem(followItem({ uniqueId: 'ana' }));
  const chatOverlay = fakeSocket({ authMethod: 'overlay', overlayScreen: 'chat' });
  tenant.registerChatOverlayHandlers(chatOverlay);
  assert.ok(chatOverlay.rooms.has('l1:chat'));
  assert.equal(chatOverlay.sent[0].name, 'chat_snapshot');
  assert.equal(chatOverlay.sent[0].payload.items.length, 1);
  const alertsOverlay = fakeSocket({ authMethod: 'overlay', overlayScreen: 'alerts' });
  tenant.registerChatOverlayHandlers(alertsOverlay);
  assert.equal(alertsOverlay.rooms.size, 0);
  const panel = fakeSocket();
  tenant.registerChatOverlayHandlers(panel);
  assert.equal(panel.rooms.size, 0, 'the panel only joins while its Chat tab is open');
  panel.fire('chat_overlay_subscribe');
  assert.ok(panel.rooms.has('l1:chat'));
  panel.fire('chat_overlay_unsubscribe');
  assert.equal(panel.rooms.size, 0);
});

test('only the panel can change the settings; they are sanitized, broadcast and saved', async () => {
  const { tenant, emitted, saved } = chatTenant();
  const overlay = fakeSocket({ authMethod: 'overlay', overlayScreen: 'chat' });
  tenant.registerChatOverlayHandlers(overlay);
  overlay.fire('update_chat_settings', { fadeSeconds: 5 });
  assert.equal(tenant.chatSettings.fadeSeconds, 30, 'an overlay link cannot change anything');
  const panel = fakeSocket();
  tenant.registerChatOverlayHandlers(panel);
  panel.fire('update_chat_settings', { fadeSeconds: 15, fontSize: 999, newestOnTop: false });
  assert.equal(tenant.chatSettings.fadeSeconds, 15);
  assert.equal(tenant.chatSettings.fontSize, FONT_SIZE_MAX);
  assert.equal(tenant.chatSettings.newestOnTop, false);
  const update = emitted.find((e) => e.name === 'chat_settings_update');
  assert.equal(update.room, 'l1', 'settings go to the whole license (the panel shows them too)');
  await new Promise((r) => setImmediate(r));
  assert.equal(saved.length, 1);
});

test('only the most recent chat is remembered', () => {
  const { tenant } = chatTenant();
  for (let i = 0; i < 50; i++) tenant.pushChatItem(chatMessageItem({ uniqueId: `u${i}` }, { rawComment: 'hola' }));
  assert.equal(tenant.chatRecent.length, 30);
  assert.equal(tenant.chatRecent.at(-1).user.uniqueId, 'u49');
});

test('a pinned message is kept for overlays that open later, and an unpin or a new LIVE clears it', () => {
  const { tenant, emitted } = chatTenant();
  tenant.handleRoomPinEvent({ action: 1, chatMessage: { content: 'Reglas del LIVE', user: { displayId: 'mod1' } } });
  assert.equal(tenant.chatPinned.text, 'Reglas del LIVE');
  assert.equal(emitted.at(-1).name, 'chat_pinned');
  const late = fakeSocket({ authMethod: 'overlay', overlayScreen: 'chat' });
  tenant.registerChatOverlayHandlers(late);
  assert.equal(late.sent[0].payload.pinned.text, 'Reglas del LIVE');
  tenant.handleRoomPinEvent({ action: 2 });
  assert.equal(tenant.chatPinned, null);
  tenant.handleRoomPinEvent({ action: 1, chatMessage: { content: 'Otra', user: { displayId: 'mod1' } } });
  tenant.pushChatItem(followItem({ uniqueId: 'ana' }));
  tenant.resetChatOverlay();
  assert.equal(tenant.chatPinned, null);
  assert.equal(tenant.chatRecent.length, 0);
});

test('the panel test button shows two messages (one long, with several badges), a follow and a gift, and cannot be spammed; overlays cannot use it', () => {
  const { tenant, emitted } = chatTenant();
  const overlay = fakeSocket({ authMethod: 'overlay', overlayScreen: 'chat' });
  tenant.registerChatOverlayHandlers(overlay);
  overlay.fire('chat_overlay_test');
  assert.equal(emitted.filter((e) => e.name === 'chat_item').length, 0);
  const panel = fakeSocket();
  tenant.registerChatOverlayHandlers(panel);
  panel.fire('chat_overlay_test');
  panel.fire('chat_overlay_test');
  assert.deepEqual(emitted.filter((e) => e.name === 'chat_item').map((e) => e.payload.kind), ['chat', 'chat', 'follow', 'gift']);
});

test('a read-only OBS overlay gets only the viewing part of the chat: it joins and receives, but has no controls', () => {
  const { tenant } = chatTenant();
  const overlay = fakeSocket({ authMethod: 'overlay', overlayScreen: 'chat' });
  const registered = [];
  const on = overlay.on;
  overlay.on = (name, handler) => { registered.push(name); on(name, handler); };
  tenant.registerChatOverlayViewerHandlers(overlay);
  assert.ok(overlay.rooms.has('l1:chat'));
  assert.deepEqual(registered.sort(), ['chat_overlay_subscribe', 'chat_overlay_unsubscribe']);
});

test('tenant.js registers the chat viewing handlers for the read-only overlay (it returns early for those sockets)', () => {
  const source = fs.readFileSync(require.resolve('./tenant'), 'utf8').replace(/\r\n/g, '\n');
  const branch = source.slice(source.indexOf("if (socket.authMethod === 'overlay') {"), source.indexOf('return;', source.indexOf("if (socket.authMethod === 'overlay') {")));
  assert.match(branch, /registerChatOverlayViewerHandlers\(socket\)/);
});

test('emotes go where the person put them: one per TikTok marker, in order; leftovers at the end', () => {
  const { commentParts } = require('./lib/chatOverlay');
  const inv = String.fromCodePoint(0xE001);
  const e = (n, place) => ({ emoteImageUrl: `https://p16/e${n}.png`, placeInComment: place });
  assert.deepEqual(commentParts(`hola [a] mundo [b]`, [e(1, 5), e(2, 14)]), [
    { type: 'text', value: 'hola ' }, { type: 'emote', url: 'https://p16/e1.png' },
    { type: 'text', value: ' mundo ' }, { type: 'emote', url: 'https://p16/e2.png' },
  ]);
  assert.deepEqual(commentParts(`${inv}${inv} jaja`, [e(1, 0), e(2, 1)]).map((p) => p.type), ['emote', 'emote', 'text'], 'invisible markers too');
  assert.deepEqual(commentParts('[a] solo uno', [e(1, 0), e(2, 1)]).map((p) => p.url || p.value), ['https://p16/e1.png', ' solo uno', 'https://p16/e2.png'], 'more emotes than markers: the rest at the end');
});

test('without markers the emote goes at the position TikTok sends; without any, at the end; no images, plain text', () => {
  const { commentParts } = require('./lib/chatOverlay');
  const e = (n, place) => ({ emoteImageUrl: `https://p16/e${n}.png`, placeInComment: place });
  assert.deepEqual(commentParts('holamundo', [e(1, 4)]).map((p) => p.url || p.value), ['hola', 'https://p16/e1.png', 'mundo']);
  assert.deepEqual(commentParts('hola', [{ emoteImageUrl: 'https://p16/x.png' }]).map((p) => p.url || p.value), ['hola', 'https://p16/x.png']);
  assert.deepEqual(commentParts('  hola   que tal  ', []), [{ type: 'text', value: 'hola que tal' }], 'spaces tidied');
  assert.deepEqual(commentParts('hola', [{ image: { urlList: ['https://p16/raw.png'] } }]).at(-1), { type: 'emote', url: 'https://p16/raw.png' }, 'raw emote events too');
  assert.equal(commentParts('', Array.from({ length: 20 }, (_, i) => e(i, i))).length, 10, 'at most 10 emotes');
});
