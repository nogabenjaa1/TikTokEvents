const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Bug real: una prueba gratis extendida a mensual seguía viéndose vencida en
// el panel del streamer hasta que se regeneró la clave. pushLicenseState avisa
// el cambio a los paneles abiertos y corrige el tipo de licencia del Tenant.
function load(row) {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf('async function pushLicenseState');
  const end = source.indexOf('\n}\n', start) + 3;
  const sent = [];
  const sockets = [
    { authMethod: 'jwt', emit: (name, payload) => sent.push({ to: 'panel', name, payload: JSON.parse(JSON.stringify(payload)) }) },
    { authMethod: 'overlay', emit: (name) => sent.push({ to: 'overlay', name }) },
  ];
  const tenant = { licenseType: 'trial' };
  const context = vm.createContext({
    db: { findById: async () => row },
    tenants: new Map([['lic-1', tenant]]),
    io: { in: () => ({ fetchSockets: async () => sockets }) },
    sessionLicense: (r) => ({ licenseType: r.license_type, expiresAt: r.expires_at }),
    console: { error: () => {} },
  });
  vm.runInContext(source.slice(start, end), context);
  return { push: context.pushLicenseState, sent, tenant };
}

test('al extender una licencia, el panel recibe el plan y vencimiento nuevos y el Tenant deja de tratarla como prueba', async () => {
  const { push, sent, tenant } = load({ license_type: 'month', expires_at: 999 });
  await push('lic-1');
  assert.deepEqual(sent, [{ to: 'panel', name: 'license_updated', payload: { licenseType: 'month', expiresAt: 999 } }]);
  assert.equal(tenant.licenseType, 'month');
});

test('si la base falla, el aviso no rompe la operación que lo llamó', async () => {
  const { push, sent } = load(null);
  await push('lic-1');
  assert.equal(sent.length, 0);
});
