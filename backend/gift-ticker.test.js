const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// La tira de regalos (overlay 'ticker'): bug real, una alerta de un regalo
// que nunca había llegado en un directo salía sin imagen, porque el ícono
// solo se buscaba en el directorio global de regalos vistos.
function load({ directory = [] } = {}) {
  const saved = [];
  const db = { setAlertGiftIcon: async (id, licenseId, icon) => saved.push({ id, licenseId, icon }) };
  const context = {
    module: { exports: {} },
    require: (name) => (
      name.includes('giftCatalog') ? require('./lib/giftCatalog')
      : name.includes('tenantHelpers') ? require('./lib/tenantHelpers')
      : name.includes('giftDirectory') ? { load: async () => {}, list: () => directory }
      : name.includes('/db') ? db
      : {}
    ),
    console, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/alerts'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.licenseId = 'lic-1';
  const sent = [];
  tenant.broadcast = { emit: (name, payload) => sent.push({ name, payload }) };
  return { tenant, saved, sent };
}

test('la tira usa la imagen guardada con la alerta si el regalo nunca llegó en vivo', async () => {
  const { tenant } = load({ directory: [{ id: 1, name: 'Rose', icon: 'https://cdn/rose.png' }] });
  tenant.alertConfigs = {
    rose: { id: 'a', triggerType: 'gift', giftName: 'Rose', giftId: '1', apodo: 'Rosita' },
    galaxy: { id: 'b', triggerType: 'gift', giftName: 'Galaxy', giftId: '99', giftIcon: 'https://cdn/galaxy.png', apodo: 'Galaxia' },
  };
  const items = await tenant.getGiftTickerSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(items.map((i) => [i.apodo, i.giftIcon]))), [['Rosita', 'https://cdn/rose.png'], ['Galaxia', 'https://cdn/galaxy.png']]);
});

test('una alerta vieja sin imagen la toma del catálogo del LIVE, la guarda y actualiza la tira', async () => {
  const { tenant, saved, sent } = load();
  tenant.alertConfigs = {
    galaxy: { id: 'b', triggerType: 'gift', giftName: 'Galaxy', giftId: null, apodo: 'Galaxia' },
    follow: { id: 'c', triggerType: 'follow', giftName: 'follow' },
  };
  await tenant.backfillAlertGiftIcons([{ id: 5, name: 'galaxy ', icon: 'https://cdn/galaxy.png' }, { id: 6, name: 'Otro', icon: 'http://inseguro/x.png' }]);
  assert.deepEqual(saved, [{ id: 'b', licenseId: 'lic-1', icon: 'https://cdn/galaxy.png' }]);
  const update = sent.find((e) => e.name === 'ticker_alerts_update');
  assert.equal(update.payload[0].giftIcon, 'https://cdn/galaxy.png');
});

test('sin nada que completar no escribe ni reenvía', async () => {
  const { tenant, saved, sent } = load();
  tenant.alertConfigs = { rose: { id: 'a', triggerType: 'gift', giftName: 'Rose', giftIcon: 'https://cdn/rose.png' } };
  await tenant.backfillAlertGiftIcons([{ id: 1, name: 'Rose', icon: 'https://cdn/otra.png' }]);
  assert.equal(saved.length, 0);
  assert.equal(sent.length, 0);
});
