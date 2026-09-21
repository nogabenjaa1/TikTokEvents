const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');

const SECRET = 'a'.repeat(64);

// The real webhook handler from server.js, with the outside world stubbed.
function webhook({ secret = SECRET, orderStatus = { orderPayment: { id: 'PAY1' }, approved: true } } = {}) {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf('function logSafe(');
  const end = source.indexOf('// Aplica una compra ya APROBADA por MercadoPago');
  assert.ok(start > 0 && end > start, 'the webhook handler moved: update this slice');

  const logs = { info: [], error: [] };
  const fetched = [];
  const applied = [];
  let handler;
  process.env.MP_WEBHOOK_SECRET = secret;
  const context = {
    app: { post: (route, ...args) => { if (route === '/api/payments/webhook') handler = args.at(-1); } },
    webhookLimiter: null,
    WebhookSignatureValidator, InvalidWebhookSignatureError,
    process,
    console: { log: (...args) => logs.info.push(args.join(' ')), error: (...args) => logs.error.push(args) },
    getMpAccessToken: () => 'token',
    fetch: async (url) => { fetched.push(url); return { ok: true, json: async () => ({ external_reference: 'ref' }) }; },
    evaluateOrderStatus: () => orderStatus,
    parseExternalReference: () => ({ licenseId: 'license-1', planType: 'month', diceTier: undefined, spotifyAddon: false }),
    applyApprovedPaymentIfNew: async (purchase) => { applied.push(purchase); return { applied: true }; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(typeof handler, 'function');

  async function send({ query = {}, headers = {}, body = {} }) {
    const res = { code: null, sendStatus(code) { this.code = code; return this; } };
    await handler({ query, headers, body }, res);
    // The purchase is applied after the 200 goes out: give that tail a turn.
    await new Promise((resolve) => setImmediate(resolve));
    return res.code;
  }
  return { send, logs, fetched, applied };
}

// Signs like MercadoPago does: the id goes in lowercase inside the manifest.
function signed({ dataId, requestId = 'req-1', secret = SECRET }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = crypto.createHmac('sha256', secret).update(`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

test('a payment notification is acknowledged and ignored without touching the signature or MercadoPago', async () => {
  const { send, logs, fetched, applied } = webhook();
  const code = await send({ query: { 'data.id': '177675203382', type: 'payment' }, headers: { 'x-signature': 'ts=1,v1=nope', 'x-request-id': 'r' } });
  assert.equal(code, 200, 'MercadoPago must get a 200 or it keeps retrying');
  assert.deepEqual(logs.error, [], 'a topic we do not use is not an error');
  assert.equal(logs.info.length, 1);
  assert.match(logs.info[0], /payment/);
  assert.deepEqual(fetched, []);
  assert.deepEqual(applied, []);
});

test('the topic can also come in the body, and a missing one is ignored too', async () => {
  const { send, logs, applied } = webhook();
  assert.equal(await send({ query: { 'data.id': '44235931091' }, body: { type: 'merchant_order' } }), 200);
  assert.equal(await send({ query: { 'data.id': '44235931091' } }), 200);
  assert.deepEqual(logs.error, []);
  assert.deepEqual(applied, []);
});

test('the topic that reaches the log is cleaned: a forged one cannot add lines', async () => {
  const { send, logs } = webhook();
  await send({ query: { type: 'payment\n[MP] ✅ Pago aplicado — licencia 1' } });
  assert.equal(logs.info.length, 1);
  assert.doesNotMatch(logs.info[0], /\n/);
});

test('an order with a bad signature is still rejected, and the log says where it came from', async () => {
  const { send, logs, fetched, applied } = webhook();
  const code = await send({
    query: { 'data.id': 'ORD01ABC', type: 'order' },
    headers: signed({ dataId: 'ORD01ABC', secret: 'b'.repeat(64) }),
    body: { action: 'order.processed', live_mode: false, application_id: '111', user_id: '222\n[MP] falso' },
  });
  assert.equal(code, 401);
  assert.equal(logs.error.length, 1);
  const [message, details] = logs.error[0];
  assert.match(message, /firma inválida/);
  assert.equal(details.reason, 'SignatureMismatch');
  assert.equal(details.topic, 'order');
  assert.equal(details.liveMode, 'false');
  assert.equal(details.applicationId, '111');
  assert.doesNotMatch(details.userId, /\n/, 'nothing unauthenticated is printed as is');
  assert.deepEqual(fetched, []);
  assert.deepEqual(applied, []);
});

test('an order with a valid signature (alphanumeric id, any case) is fetched and applied', async () => {
  const { send, logs, fetched, applied } = webhook();
  const code = await send({ query: { 'data.id': 'ORD01ABC', type: 'order' }, headers: signed({ dataId: 'ORD01ABC' }) });
  assert.equal(code, 200);
  assert.deepEqual(logs.error, []);
  assert.deepEqual(fetched, ['https://api.mercadopago.com/v1/orders/ORD01ABC'], 'the original id, not the lowercase one');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].licenseId, 'license-1');
  assert.equal(applied[0].mpPaymentId, 'PAY1');
});

test('an order that is not approved is fetched but applies nothing', async () => {
  const { send, fetched, applied } = webhook({ orderStatus: { orderPayment: null, approved: false } });
  assert.equal(await send({ query: { 'data.id': 'ORD01ABC', type: 'order' }, headers: signed({ dataId: 'ORD01ABC' }) }), 200);
  assert.equal(fetched.length, 1);
  assert.deepEqual(applied, []);
});

test('without a configured secret an order is refused before anything else', async () => {
  const { send, fetched } = webhook({ secret: '' });
  assert.equal(await send({ query: { 'data.id': 'ORD01ABC', type: 'order' }, headers: signed({ dataId: 'ORD01ABC' }) }), 400);
  assert.deepEqual(fetched, []);
});
