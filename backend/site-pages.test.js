const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SECTION_PATHS, EVENT_TAB_PATHS, SITEMAP_PAGES, isKnownPage } = require('./lib/sitePages');
const analytics = require('./lib/analytics');

const navigation = fs.readFileSync(path.join(__dirname, '../frontend/src/app/navigation.js'), 'utf8');
const objectValues = (name) => {
  const block = navigation.slice(navigation.indexOf(`export const ${name} = {`));
  return [...block.slice(0, block.indexOf('};')).matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
};

test('las páginas del servidor son exactamente las rutas del panel (navigation.js)', () => {
  assert.deepEqual([...SECTION_PATHS].sort(), objectValues('SECTION_PATHS').sort());
  assert.deepEqual([...EVENT_TAB_PATHS].sort(), objectValues('EVENT_TAB_PATHS').sort());
});

test('el sitemap publicado lista las páginas públicas, todas existentes y con el dominio', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../frontend/public/sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>https:\/\/benjaapis\.dev([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, SITEMAP_PAGES.map((p) => p.path));
  for (const loc of locs) assert.ok(isKnownPage(loc), loc);
  const robots = fs.readFileSync(path.join(__dirname, '../frontend/public/robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/benjaapis\.dev\/sitemap\.xml/);
});

test('isKnownPage: existen las secciones y las pestañas de eventos; lo demás es 404', () => {
  for (const p of ['/', '/dashboard', '/membership/', '/tiktokevents', '/tiktokevents/versus', '/privacidad']) assert.ok(isKnownPage(p), p);
  for (const p of ['/nada', '/dashboard/extra', '/tiktokevents/inventado', '/tiktokevents/versus/x', '/wp-admin']) assert.ok(!isKnownPage(p), p);
});

test('analítica: solo rutas conocidas, sin consulta; el origen es solo el dominio externo', () => {
  assert.equal(analytics.cleanPath('/Membership?ref=x#top'), '/membership');
  assert.equal(analytics.cleanPath('/inventada'), null);
  assert.equal(analytics.cleanPath(42), null);
  assert.equal(analytics.referrerSource('https://www.google.com/search?q=tiktok', 'benjaapis.dev'), 'google.com');
  assert.equal(analytics.referrerSource('https://benjaapis.dev/dashboard', 'benjaapis.dev'), null);
  assert.equal(analytics.referrerSource('no es url', 'benjaapis.dev'), null);
});

test('analítica: la huella del visitante cambia cada día y no contiene la IP', () => {
  const a = analytics.visitorHash({ ip: '200.1.2.3', userAgent: 'UA', day: '2026-10-03', secret: 's' });
  const b = analytics.visitorHash({ ip: '200.1.2.3', userAgent: 'UA', day: '2026-10-04', secret: 's' });
  assert.notEqual(a, b);
  assert.ok(!a.includes('200'));
  assert.equal(a, analytics.visitorHash({ ip: '200.1.2.3', userAgent: 'UA', day: '2026-10-03', secret: 's' }));
  assert.ok(analytics.optedOut({ dnt: '1' }) && analytics.optedOut({ 'sec-gpc': '1' }) && !analytics.optedOut({}));
});

// Fragmentos reales de server.js, con lo mínimo alrededor.
const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const fakeRes = () => ({ code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; }, sendFile(f) { this.file = f; return this; }, redirect(c, u) { this.code = c; this.location = u; return this; } });

test('rutas que no existen: 404 de verdad con la página personalizada; la API responde 404 en JSON', () => {
  let handler;
  vm.runInNewContext(slice("const FRONTEND_INDEX = path.join(__dirname, 'public', 'index.html');", '// Red de seguridad final'), {
    app: { use: (fn) => { handler = fn; } }, path, fs: { existsSync: () => true }, __dirname, isKnownPage,
  });
  const unknown = fakeRes(); handler({ path: '/no-existe' }, unknown);
  assert.equal(unknown.code, 404); assert.ok(unknown.file.endsWith('index.html'));
  const known = fakeRes(); handler({ path: '/membership' }, known);
  assert.equal(known.code, 200); assert.ok(known.file);
  const api = fakeRes(); handler({ path: '/api/nada' }, api);
  assert.equal(api.code, 404); assert.equal(api.body.success, false); assert.equal(api.file, undefined);
});

test('http:// se redirige a https:// (301); sin el encabezado del proxy no se toca', () => {
  let handler;
  vm.runInNewContext(slice("app.set('trust proxy', 1);", '// Cabeceras de seguridad estandar'), {
    app: { set() {}, use: (fn) => { handler = fn; } }, process: { env: {} },
  });
  const res = fakeRes(); let nexted = false;
  handler({ headers: { 'x-forwarded-proto': 'http', host: 'benjaapis.dev' }, originalUrl: '/membership?x=1' }, res, () => { nexted = true; });
  assert.equal(res.code, 301); assert.equal(res.location, 'https://benjaapis.dev/membership?x=1'); assert.equal(nexted, false);
  handler({ headers: { 'x-forwarded-proto': 'https', host: 'benjaapis.dev' }, originalUrl: '/' }, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  let internal = false;
  handler({ headers: { host: 'localhost' }, originalUrl: '/health' }, fakeRes(), () => { internal = true; });
  assert.equal(internal, true);
});

test('campo trampa: un envío con "website" lleno se rechaza sin tocar la base', async () => {
  const routes = {};
  vm.runInNewContext(slice('const isBotSubmission', "app.post('/api/free-trial/checkout-session'"), {
    app: { post: (p, ...h) => { routes[p] = h.at(-1); } }, loginLimiter: null,
    auth: { resolveFromRawKey: async () => { throw new Error('no debe consultar la base'); } },
  });
  const res = fakeRes();
  await routes['/api/auth/login']({ body: { key: 'algo', website: 'http://spam' } }, res);
  assert.equal(res.code, 401);
});
