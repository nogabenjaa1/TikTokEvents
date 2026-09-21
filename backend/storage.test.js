const test = require('node:test');
const assert = require('node:assert/strict');

// The Supabase Storage REST calls the admin cleanup relies on, against a fake fetch: listing every file,
// deleting them, and the guard that keeps a folder name from ever being a path.

const BASE = 'https://proj.supabase.co';

function loadStorage(env = { SUPABASE_URL: `${BASE}/rest/v1/`, SUPABASE_SERVICE_ROLE_KEY: 'service-key' }) {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
  }
  delete require.cache[require.resolve('./storage')];
  return require('./storage');
}

const file = (name, { size = 1000, created = '2026-01-01T00:00:00.000Z' } = {}) => ({ name, id: `id-${name}`, created_at: created, updated_at: created, metadata: { size, mimetype: 'image/png' } });
const folder = (name) => ({ name, id: null, created_at: null, updated_at: null, last_accessed_at: null, metadata: null });
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, text = 'error') => ({ ok: false, status, json: async () => ({ message: text }), text: async () => text });

// A bucket: folders name -> entries. `handler` sees every call so tests can also assert on the requests.
function fakeBucket({ root = [], folders = {}, deleteResult = () => ok({}) } = {}) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, headers: init.headers, body });
    if (url === `${BASE}/storage/v1/object/list/alert-media`) {
      const entries = body.prefix === '' ? root : folders[body.prefix] || [];
      return ok(entries.slice(body.offset, body.offset + body.limit));
    }
    if (init.method === 'DELETE') return deleteResult(url.slice(`${BASE}/storage/v1/object/alert-media/`.length));
    throw new Error(`unexpected request to ${url}`);
  };
  return calls;
}

test('the Data API address is trimmed to the bare project, and the service key travels in both headers', async () => {
  const storage = loadStorage();
  assert.equal(storage.isConfigured(), true);
  const calls = fakeBucket({ root: [file('loose.png')] });
  await storage.listAllFiles();
  assert.equal(calls[0].url, `${BASE}/storage/v1/object/list/alert-media`, 'no /rest/v1/ in the middle');
  assert.equal(calls[0].headers.apikey, 'service-key');
  assert.equal(calls[0].headers.Authorization, 'Bearer service-key');
});

test('without the Supabase variables it says so instead of calling out', async () => {
  const storage = loadStorage({});
  assert.equal(storage.isConfigured(), false);
  const calls = fakeBucket();
  await assert.rejects(() => storage.listAllFiles(), /SUPABASE_URL/);
  await assert.rejects(() => storage.deleteFiles(['a/b.png']), /SUPABASE_URL/);
  assert.equal(calls.length, 0);
});

test('every file of every folder is listed with its size and date, and pages of 100 are followed', async () => {
  const storage = loadStorage();
  const many = Array.from({ length: 103 }, (_, i) => file(`f${i}.png`, { size: i + 1, created: '2026-03-04T05:06:07.000Z' }));
  const calls = fakeBucket({
    root: [folder('lic1'), folder('lic2'), file('loose.png', { size: 7 }), folder('not a safe/folder'), folder('../up')],
    folders: { lic1: many, lic2: [file('only.mp3', { size: 55 })] },
  });
  const { files, truncated } = await storage.listAllFiles();
  assert.equal(truncated, false);
  assert.equal(files.length, 1 + 103 + 1);
  assert.deepEqual(files.find((f) => f.path === 'loose.png'), { path: 'loose.png', size: 7, createdAt: Date.parse('2026-01-01T00:00:00.000Z') });
  assert.deepEqual(files.find((f) => f.path === 'lic1/f102.png'), { path: 'lic1/f102.png', size: 103, createdAt: Date.parse('2026-03-04T05:06:07.000Z') });
  assert.ok(files.some((f) => f.path === 'lic2/only.mp3'));
  const asked = calls.map((c) => `${c.body.prefix}@${c.body.offset}`);
  assert.deepEqual(asked.filter((a) => a.startsWith('lic1')), ['lic1@0', 'lic1@100'], 'the second page of 3 ends the folder');
  assert.ok(!asked.some((a) => a.includes('safe') || a.includes('..')), 'a folder with a suspicious name is never listed');
  assert.ok(calls.every((c) => c.body.limit === 100));
});

test('missing size or date does not break listing: the size is 0 and the date unknown', async () => {
  const storage = loadStorage();
  fakeBucket({ root: [{ name: 'odd.png', id: 'x', created_at: null, metadata: null }] });
  const { files } = await storage.listAllFiles();
  assert.deepEqual(files, [{ path: 'odd.png', size: 0, createdAt: null }]);
});

test('when the time budget runs out it returns what it has and says the list is incomplete', async () => {
  const storage = loadStorage();
  fakeBucket({ root: [folder('lic1'), file('loose.png')], folders: { lic1: [file('a.png')] } });
  const partial = await storage.listAllFiles({ budgetMs: -1 });
  assert.equal(partial.truncated, true);
  assert.deepEqual(partial.files.map((f) => f.path), ['loose.png']);
});

test('a failing or odd list response is an error, not an empty bucket that would look clean', async () => {
  const storage = loadStorage();
  global.fetch = async () => fail(500);
  await assert.rejects(() => storage.listAllFiles(), /list falló \(500\)/);
  global.fetch = async () => ok({ message: 'not a list' });
  await assert.rejects(() => storage.listAllFiles(), /Respuesta inesperada/);
});

test('deleting files reports how many went and how many did not, whether Supabase refused or the network failed', async () => {
  const storage = loadStorage();
  const calls = fakeBucket({ deleteResult: (path) => {
    if (path === 'a/gone.png') return fail(404);
    if (path === 'a/boom.png') throw new Error('network down');
    return ok({});
  } });
  const result = await storage.deleteFiles(['a/one.png', 'a/gone.png', 'a/boom.png', 'b/two.png']);
  assert.deepEqual(result, { deleted: 2, failed: 2 });
  assert.ok(calls.every((c) => c.method === 'DELETE'));
  assert.equal(calls[0].url, `${BASE}/storage/v1/object/alert-media/a/one.png`);
  assert.deepEqual(await storage.deleteFiles([]), { deleted: 0, failed: 0 });
});

test('deleting a license folder removes its files only, never a subfolder entry, and reports the outcome', async () => {
  const storage = loadStorage();
  const calls = fakeBucket({ folders: { lic1: [file('a.png'), folder('nested'), file('b.mp3')] } });
  const result = await storage.deletePrefix('lic1');
  assert.deepEqual(result, { deleted: 2, failed: 0 });
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/alert-media/')[1]), ['lic1/a.png', 'lic1/b.mp3']);
  const empty = fakeBucket({ folders: {} });
  assert.deepEqual(await storage.deletePrefix('lic-empty'), { deleted: 0, failed: 0 });
  assert.equal(empty.filter((c) => c.method === 'DELETE').length, 0);
});

test('a folder name that could be a path is refused before any request, so a bad id can never empty the bucket', async () => {
  const storage = loadStorage();
  const calls = fakeBucket({ root: [file('precious.png')] });
  for (const bad of ['', '.', '..', '../other', 'a/b', 'a b', 'a;b', 'x'.repeat(65), null, undefined, '/', '%2e%2e']) {
    await assert.rejects(() => storage.deletePrefix(bad), /Carpeta no válida/, JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await storage.deletePrefix('4a8f2c1e-1111-2222-3333-444455556666').catch(() => 'threw'), { deleted: 0, failed: 0 }, 'a real license id is fine');
});

test('the old best-effort delete still never throws', async () => {
  const storage = loadStorage();
  global.fetch = async () => { throw new Error('network down'); };
  const quiet = console.error;
  console.error = () => {};
  try { await storage.deleteFile('a/b.png'); } finally { console.error = quiet; }
});
