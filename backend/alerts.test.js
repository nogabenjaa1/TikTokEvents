const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load the real Tenant without opening DB, Spotify or TikTok connections.
const context = { module: { exports: {} }, require: (name) => name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : ({}), process, console, setTimeout, clearTimeout, setInterval, clearInterval };
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
          visual_path: config.visualPath, visual_type: config.visualType, audio_url: config.audioUrl };
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
  const tenant = { liveConnected: false, currentTikTokUsername: 'ana', tiktokConnection: {} };
  let calls = 0;
  let changeConnection = false;
  let handler;
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf("app.get('/api/setup/:username'");
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (...args) => { handler = args.at(-1); } }, auth: {},
    getOrCreateTenant: () => tenant,
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
