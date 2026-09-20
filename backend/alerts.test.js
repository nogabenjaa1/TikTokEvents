const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load the real Tenant without opening DB, Spotify or TikTok connections.
const context = { module: { exports: {} }, require: (name) => name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : name.includes('giftCatalog') ? require('./lib/giftCatalog') : ({}), process, console, setTimeout, clearTimeout, setInterval, clearInterval };
vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/alerts'), 'utf8'), context);
const Tenant = { prototype: context.module.exports };

test('gift and follow events emit immediately with isolated text and native combo counts', () => {
  const events = [];
  const tenant = Object.create(Tenant.prototype);
  tenant.alertTriggerCounter = 0;
  tenant.alertConfigs = {
    rose: { text: '{username}|{nickname}|{gift}|{coins}|{count}', durationMs: 1000 },
    follow: { text: 'Follow {username}', durationMs: 1000 },
  };
  tenant.broadcast = { emit: (name, event) => events.push({ name, event }) };
  tenant.processAlertTrigger({ key: 'Rose', username: 'ana', nickname: '$&', giftName: 'Rose', coins: 5, repeatCount: 5 });
  tenant.processAlertTrigger({ key: 'follow', username: 'bob' });
  tenant.processAlertTrigger({ key: 'Rose', username: 'carla', giftName: 'Rose', coins: 1, repeatCount: 1 });
  assert.deepEqual(events.map(({ event }) => event.text), ['ana|$&|Rose|5|5', 'Follow bob', 'carla|carla|Rose|1|1']);
  assert.deepEqual(events.map(({ event }) => event.triggerId), [1, 2, 3]);
  assert.ok(events.every(({ name }) => name === 'alert_triggered'));
});

test('unassigned drafts do not respond to LIVE events', () => {
  const tenant = Object.create(Tenant.prototype);
  tenant.alertConfigs = { '__draft_gift__:one': { text: 'pending' } };
  tenant.broadcast = { emit: () => assert.fail('Draft must not fire') };
  tenant.processAlertTrigger({ key: '__draft_gift__:one', username: 'ana' });
  tenant.processAlertTrigger({ key: 'Rose', username: 'ana' });
});

test('global tiers, specific gifts and follows keep their own text and color in event order', () => {
  const tenant = Object.create(Tenant.prototype);
  const events = [];
  tenant.alertTriggerCounter = 0;
  tenant.alertConfigs = {
    rose: { text: 'Specific {username} {gift}', textColor: '#ff0000' },
    'global:1': { text: 'General {username} {gift}', minCoins: 1 },
    'global:500': { text: 'Premium {username} {gift}', minCoins: 500 },
    follow: { text: 'Follow {username}' },
  };
  tenant.broadcast = { emit: (_, alert) => events.push(alert) };
  tenant.processAlertTrigger({ key: 'Rose', giftName: 'Rose', username: 'ana', coins: 1000, allowGlobalFallback: true });
  tenant.processAlertTrigger({ key: 'Lion', giftName: 'Lion', username: 'bob', coins: 1000, allowGlobalFallback: true });
  tenant.processAlertTrigger({ key: 'Heart', giftName: 'Heart', username: 'carla', coins: 10, allowGlobalFallback: true });
  tenant.processAlertTrigger({ key: 'follow', username: 'dani' });
  assert.deepEqual(events.map((event) => event.text), ['Specific ana Rose', 'Premium bob Lion', 'General carla Heart', 'Follow dani']);
  assert.equal(events[0].textColor, '#ff0000');
});

function alertApi() {
  const rows = new Map();
  const configs = new Map();
  let save;
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  // Register the actual alert routes with isolated storage and database adapters.
  vm.runInNewContext(source.slice(source.indexOf('const NON_GIFT_TRIGGER_TYPES'), source.indexOf("app.delete('/api/alerts/:id'")), {
    app: { get() {}, post: (...args) => { save = args.at(-1); } },
    auth: {}, generalLimiter: null, uploadAlertMedia: null,
    crypto: require('node:crypto'), console,
    db: {
      getAlertConfig: async (id) => rows.get(id),
      listAlertConfigs: async () => [...rows.values()],
      deleteAlertConfig: async (id) => rows.delete(id),
      upsertAlertConfig: async (config) => {
        const row = { id: config.id, license_id: config.licenseId, gift_name: config.giftName,
          trigger_type: config.triggerType, alert_text: config.text, visual_url: config.visualUrl,
          visual_path: config.visualPath, visual_type: config.visualType, audio_url: config.audioUrl, gift_id: config.giftId };
        rows.set(row.id, row);
        return row;
      },
    },
    getOrCreateTenant: () => ({
      setAlertConfig: (key, value) => configs.set(key, value),
      removeAlertConfig: (key) => configs.delete(key),
    }),
  });
  return {
    rows, configs,
    async save(body) {
      let result;
      let status = 200;
      const response = { status(code) { status = code; return this; }, json(data) { result = data; } };
      await save({ body, license: { id: 'license' } }, response);
      return { status, ...result };
    },
  };
}

test('multiple drafts survive editing and assigning a fresh gift without affecting an existing alert', async () => {
  const api = alertApi();
  const original = await api.save({ giftName: 'Rose', text: 'Original {username}' });
  assert.equal(original.success, true);
  const first = await api.save({ text: 'Draft one' });
  const second = await api.save({ text: 'Draft two' });
  assert.equal(first.alert.giftName, '');
  assert.equal(second.alert.giftName, '');
  assert.notEqual(first.alert.id, second.alert.id);
  assert.equal(api.rows.size, 3);
  const edited = await api.save({ alertId: first.alert.id, giftName: '', text: 'Updated draft' });
  assert.equal(edited.alert.id, first.alert.id);
  assert.equal(api.rows.size, 3);
  const conflict = await api.save({ alertId: first.alert.id, giftName: 'Rose', text: 'Do not overwrite' });
  assert.equal(conflict.status, 409);
  const assigned = await api.save({ alertId: first.alert.id, giftName: 'Lion', text: 'Now assigned' });
  assert.equal(assigned.alert.id, first.alert.id);
  assert.equal(assigned.alert.giftName, 'Lion');
  assert.equal(api.rows.size, 3);
  assert.equal(api.rows.get(original.alert.id).alert_text, 'Original {username}');
  assert.equal(api.configs.get('Rose').text, 'Original {username}');
  assert.equal(api.configs.get('Lion').text, 'Now assigned');
});

test('editing an assigned alert offline preserves its gift and media', async () => {
  const api = alertApi();
  api.rows.set('old', { id: 'old', license_id: 'license', gift_name: 'Rose', trigger_type: 'gift',
    visual_url: '/existing.gif', visual_path: 'existing.gif', visual_type: 'gif' });
  const result = await api.save({ alertId: 'old', text: 'New text', giftName: '' });
  assert.equal(result.success, true);
  assert.equal(result.alert.giftName, 'Rose');
  assert.equal(result.alert.visualUrl, '/existing.gif');
  assert.equal(api.rows.size, 1);
});

test('catalog requires this license LIVE connection, reloads each time and rejects a stale connection', async () => {
  const tenant = { liveConnected: false, currentTikTokUsername: 'ana', tiktokConnection: {}, getSeenGifts: () => [] };
  let calls = 0;
  let changeConnection = false;
  let handler;
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf("app.get('/api/setup/:username'");
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (...args) => { handler = args.at(-1); } }, auth: {},
    getOrCreateTenant: () => tenant,
    mergeGiftCatalogs: require('./lib/giftCatalog').mergeGiftCatalogs,
    WebcastPushConnectionV1: class {
      async getAvailableGifts() {
        calls++;
        if (changeConnection) tenant.tiktokConnection = {};
        return [{ id: calls, name: 'Rose', diamond_count: 1, image: { url_list: ['/rose.png'] } }];
      }
    },
  });
  async function load(username = 'ana') {
    const response = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ params: { username }, license: { id: 'license' } }, response);
    return response;
  }
  assert.equal((await load()).code, 409);
  assert.equal(calls, 0);
  tenant.liveConnected = true;
  assert.equal((await load('another-user')).code, 409);
  const first = await load();
  const second = await load();
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.equal(first.data.gifts[0].id, 1);
  assert.equal(second.data.gifts[0].id, 2);
  changeConnection = true;
  assert.equal((await load()).code, 409);
});

test('the catalog merges the room list, the generic list and the gifts already seen in the LIVE, and keeps gifts with no image', async () => {
  const tenant = {
    liveConnected: true, currentTikTokUsername: 'ana', tiktokConnection: { roomId: '777' },
    getSeenGifts: () => [{ id: 4, name: 'Regalo Visto', coins: 10, icon: '' }],
  };
  const created = [];
  let handler;
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf("app.get('/api/setup/:username'");
  const end = source.indexOf('\n});', start) + 4;
  const build = (roomFails) => vm.runInNewContext(source.slice(start, end), {
    app: { get: (...args) => { handler = args.at(-1); } }, auth: {},
    getOrCreateTenant: () => tenant, console: { warn() {}, error() {}, log() {} },
    mergeGiftCatalogs: require('./lib/giftCatalog').mergeGiftCatalogs,
    WebcastPushConnectionV1: class {
      constructor(username, options) { this.options = options; created.push(options); }
      async getAvailableGifts() {
        if (this.options?.clientParams?.room_id) {
          if (roomFails) throw new Error('room list down');
          return [{ id: 1, name: 'Rose', diamond_count: 1, image: { url_list: ['/rose.png'] } }, { id: 3, name: 'Nueva', diamond_count: 5 }];
        }
        return [{ id: 1, name: 'Rose', diamond_count: 1 }, { id: 2, name: 'Vieja', diamond_count: 2, image: { url_list: ['/vieja.png'] } }];
      }
    },
  });
  const load = async () => {
    const response = { headers: {}, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ params: { username: 'ana' }, license: { id: 'license' } }, response);
    return response.data;
  };
  build(false);
  const full = await load();
  assert.deepEqual(full.gifts.map((g) => g.name), ['Rose', 'Vieja', 'Nueva', 'Regalo Visto']);
  assert.equal(full.gifts.find((g) => g.name === 'Rose').icon, '/rose.png', 'the icon comes from whichever list has it');
  assert.equal(full.gifts.find((g) => g.name === 'Nueva').icon, '', 'a gift with no image is still offered');
  assert.equal(created[0].clientParams.room_id, '777', 'the room list is requested with the room id');

  build(true);
  const fallback = await load();
  assert.deepEqual(fallback.gifts.map((g) => g.name), ['Rose', 'Vieja', 'Regalo Visto'], 'a failing room list falls back to the generic one');
});

test('a live gift whose name differs only in case, accents or spacing still finds its alert', () => {
  const tenant = Object.create(Tenant.prototype);
  const events = [];
  tenant.alertTriggerCounter = 0;
  tenant.alertConfigs = { 'corazón grande': { text: 'ok {gift}', durationMs: 1000 }, 'global:1': { text: 'general', minCoins: 1 } };
  tenant.broadcast = { emit: (_, alert) => events.push(alert) };
  tenant.processAlertTrigger({ key: ' Corazon  Grande ', giftName: 'Corazon Grande', username: 'ana', coins: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'ok Corazon Grande');
  tenant.processAlertTrigger({ key: 'otro', giftName: 'otro', username: 'ana', coins: 5 });
  assert.equal(events.length, 1, 'no global fallback unless it is asked for');
});

test('the alerts overlay announces itself, and the panel is told whether one is connected', () => {
  const tenant = Object.create(Tenant.prototype);
  tenant.alertOverlaySockets = new Set();
  const room = [];
  tenant.broadcast = { emit: (name, payload) => room.push({ name, payload }) };
  const handlers = {};
  const overlaySocket = { id: 'obs-1', authMethod: 'key', handshake: { auth: { licenseKey: 'k', overlayScreen: 'alerts' } }, emit() {}, on: (name, fn) => { handlers[name] = fn; } };
  tenant.registerAlertHandlers(overlaySocket);
  assert.deepEqual(JSON.parse(JSON.stringify(room.at(-1))), { name: 'alerts_overlay_status', payload: { connected: true, count: 1 } });

  const panelEmits = [];
  const panelSocket = { id: 'panel-1', authMethod: 'jwt', handshake: { auth: { token: 't' } }, emit: (...args) => panelEmits.push(args), on() {} };
  tenant.registerAlertHandlers(panelSocket);
  assert.deepEqual(JSON.parse(JSON.stringify(panelEmits.at(-1))), ['alerts_overlay_status', { connected: true, count: 1 }], 'a joining panel is told an overlay is already there');
  assert.equal(tenant.alertOverlaySockets.has('panel-1'), false, 'a panel never counts as an overlay');

  handlers.disconnect();
  assert.deepEqual(JSON.parse(JSON.stringify(room.at(-1))), { name: 'alerts_overlay_status', payload: { connected: false, count: 0 } });

  const otherOverlay = { id: 'obs-2', authMethod: 'key', handshake: { auth: { licenseKey: 'k', overlayScreen: 'goal' } }, emit() {}, on() {} };
  tenant.registerAlertHandlers(otherOverlay);
  assert.equal(tenant.alertOverlaySockets.size, 0, 'only the alerts overlay counts');
});

test('an alert is found by the gift id even when the live name does not match the catalog name', () => {
  const tenant = Object.create(Tenant.prototype);
  const events = [];
  tenant.alertTriggerCounter = 0;
  tenant.alertConfigs = {
    rose: { text: 'Rosa {gift}', giftId: '5655' },
    'global:1': { text: 'General', minCoins: 1 },
  };
  tenant.broadcast = { emit: (_, alert) => events.push(alert) };
  tenant.processAlertTrigger({ key: 'Rosa Roja', giftName: 'Rosa Roja', giftId: 5655, username: 'ana', coins: 1 });
  assert.equal(events.length, 1, 'same id, different name: still its alert');
  assert.equal(events[0].text, 'Rosa Rosa Roja');
  tenant.processAlertTrigger({ key: 'Rose', giftName: 'Rose', giftId: 999, username: 'ana', coins: 1 });
  assert.equal(events.length, 2, 'a different id falls back to the name, as before');
  tenant.processAlertTrigger({ key: 'Otro', giftName: 'Otro', giftId: 999, username: 'ana', coins: 1, allowGlobalFallback: true });
  assert.equal(events.at(-1).text, 'General', 'and to the general tier when nothing matches');
});

test('saving a gift alert stores the gift id, keeps it when editing without changing the gift, and drops it when another gift is chosen', async () => {
  const api = alertApi();
  const created = await api.save({ triggerType: 'gift', giftName: 'Rose', giftId: '5655', text: 'hola', durationMs: '3000' });
  assert.equal(created.success, true);
  assert.equal(created.alert.giftId, '5655');
  const kept = await api.save({ alertId: created.alert.id, triggerType: 'gift', text: 'editada', durationMs: '3000' });
  assert.equal(kept.alert.giftId, '5655', 'editing the text alone keeps the gift and its id');
  const changed = await api.save({ alertId: created.alert.id, triggerType: 'gift', giftName: 'Lion', text: 'editada', durationMs: '3000' });
  assert.equal(changed.alert.giftId, null, 'a new gift without an id never inherits the old one');
  const invalid = await api.save({ triggerType: 'gift', giftName: 'Heart', giftId: 'abc; DROP', text: 'x', durationMs: '3000' });
  assert.equal(invalid.alert.giftId, null, 'a non-numeric id is ignored');
  const follow = await api.save({ triggerType: 'follow', giftId: '5655', text: 'seguidor', durationMs: '3000' });
  assert.equal(follow.alert.giftId, null, 'only gift alerts carry an id');
});
