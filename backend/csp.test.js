const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helmet = require('helmet');
const { cspHeaderValue, helmetDirectives, DIRECTIVES, SCRIPT_HOSTS } = require('./lib/csp');

// The site loads ads (AdSense, Adsterra) and the MercadoPago / Stripe card forms from third-party hosts, so the
// policy ships in REPORT-ONLY mode first: nothing is blocked, the browser only reports what it would have blocked.

const directive = (name) => DIRECTIVES[name] || [];

test('scripts only run from this site and the known ad and payment hosts, never inline or through eval', () => {
  const scripts = directive('script-src');
  assert.ok(scripts.includes("'self'"));
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'blob:']) {
    assert.ok(!scripts.includes(forbidden), `script-src must not allow ${forbidden}`);
  }
  assert.ok(SCRIPT_HOSTS.every((host) => /^https:\/\/(\*\.)?[a-z0-9.-]+$/.test(host)), 'every script host is an https origin without a path');
  for (const needed of ['https://pagead2.googlesyndication.com', 'https://sdk.mercadopago.com', 'https://js.stripe.com', 'https://beastscarnival.com']) {
    assert.ok(scripts.includes(needed), `${needed} would break ads or payments if it were missing`);
  }
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('base-uri'), ["'self'"]);
  assert.deepEqual(directive('default-src'), ["'self'"]);
});

test('images, media, connections and frames stay open to https because TikTok, Spotify, Supabase and the banks change hosts', () => {
  for (const name of ['img-src', 'media-src', 'connect-src', 'frame-src']) assert.ok(directive(name).includes('https:'), name);
  assert.ok(directive('connect-src').includes('wss:'), 'the live sockets');
  assert.ok(directive('style-src').includes("'unsafe-inline'"), 'React inline styles');
  assert.ok(directive('worker-src').includes('blob:'));
});

test('the header value lists every directive, and the report address only when this server serves the page', () => {
  const plain = cspHeaderValue();
  for (const name of Object.keys(DIRECTIVES)) assert.ok(plain.includes(`${name} `), name);
  assert.ok(!plain.includes('report-uri'));
  assert.ok(!/;\s*$/.test(plain), 'no trailing separator');
  const served = cspHeaderValue({ reportUri: '/api/csp-report' });
  assert.ok(served.endsWith('; report-uri /api/csp-report'));
  assert.ok(served.startsWith(plain));
});

test('the helmet directives describe the same policy in camelCase', () => {
  const helmetForm = helmetDirectives({ reportUri: '/api/csp-report' });
  assert.deepEqual(helmetForm.scriptSrc, DIRECTIVES['script-src']);
  assert.deepEqual(helmetForm.objectSrc, DIRECTIVES['object-src']);
  assert.deepEqual(helmetForm.reportUri, ['/api/csp-report']);
  assert.equal('reportUri' in helmetDirectives(), false);
  assert.equal(Object.keys(helmetDirectives()).length, Object.keys(DIRECTIVES).length);
  helmetForm.scriptSrc.push('https://x.test');
  assert.ok(!DIRECTIVES['script-src'].includes('https://x.test'), 'callers get copies, not the shared arrays');
});

// helmet joins the directives with ";" and no space: the same policy, written differently. Compare what they say.
function parsePolicy(header) {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
  }));
}

function headersSetBy(middleware) {
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    removeHeader(name) { delete headers[name.toLowerCase()]; },
    getHeader: (name) => headers[name.toLowerCase()],
  };
  middleware({ headers: {}, method: 'GET' }, res, () => {});
  return headers;
}

test('helmet sends it as Content-Security-Policy-Report-Only, and never as the enforcing header', () => {
  const headers = headersSetBy(helmet({
    contentSecurityPolicy: { useDefaults: false, reportOnly: true, directives: helmetDirectives({ reportUri: '/api/csp-report' }) },
    crossOriginEmbedderPolicy: false,
  }));
  assert.deepEqual(parsePolicy(headers['content-security-policy-report-only']), parsePolicy(cspHeaderValue({ reportUri: '/api/csp-report' })));
  assert.equal(headers['content-security-policy'], undefined, 'nothing is blocked yet');
  assert.equal(headers['cross-origin-embedder-policy'], undefined, 'embedded ads and card forms would break');
});

test('server.js really sends the report-only policy and takes reports on /api/csp-report', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(source, /reportOnly:\s*true/);
  assert.match(source, /helmetDirectives\(\{\s*reportUri:\s*'\/api\/csp-report'\s*\}\)/);
  assert.match(source, /\/api\/csp-report/);
});

test('the frontend host (vercel.json) sends the same report-only policy, so both hosts stay in sync', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'vercel.json'), 'utf8'));
  const header = vercel.headers.flatMap((rule) => rule.headers).find((h) => h.key === 'Content-Security-Policy-Report-Only');
  assert.ok(header, 'vercel.json needs the report-only header');
  assert.equal(header.value, cspHeaderValue(), 'run: node -e with cspHeaderValue() to regenerate it after changing lib/csp.js');
  assert.ok(!vercel.headers.flatMap((rule) => rule.headers).some((h) => h.key === 'Content-Security-Policy'), 'the enforcing header is not enabled yet');
  assert.ok(vercel.rewrites.length >= 1, 'the SPA rewrite is still there');
});

// ── What the site itself loads, checked against the policy ──

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

function allowedScriptHost(url) {
  const { host } = new URL(url);
  return SCRIPT_HOSTS.some((pattern) => {
    const allowed = pattern.replace('https://', '');
    return allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed;
  });
}

test('the page shell has no inline scripts or event-handler attributes, so the strict script policy can be enforced later', () => {
  const html = read('frontend', 'index.html').replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1);
  for (const [, attributes, body] of scripts) {
    assert.ok(/\bsrc\s*=/.test(attributes) && body.trim() === '', `an inline script: <script${attributes}>`);
  }
  assert.deepEqual(html.match(/\son[a-z]+\s*=/gi) || [], [], 'no onload/onclick attributes: they would need unsafe-inline');
});

test('every external script the site loads comes from a host the policy allows', () => {
  const urls = [];
  for (const [, source] of read('frontend', 'index.html').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^"]+)"/gi)) urls.push(source);
  for (const file of [['frontend', 'src', 'mercadopagoSdk.js'], ['frontend', 'src', 'adConfig.js']]) {
    for (const [, source] of read(...file).matchAll(/(?:_SRC|_HOST)\s*=\s*'(https:\/\/[^']+)'/g)) urls.push(source);
  }
  assert.ok(urls.length >= 4, `found ${urls.length} external script addresses`);
  for (const url of urls) assert.ok(allowedScriptHost(url), `${url} is not in script-src: the site would report it (and break when the policy is enforced)`);
});
