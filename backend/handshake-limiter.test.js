const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandshakeLimiter, clientIp, isNewSession } = require('./lib/handshakeLimiter');

test('an address can open up to the limit of new connections per window, then is refused until the window ends', () => {
    let clock = 1_000;
    const limiter = createHandshakeLimiter({ windowMs: 60_000, max: 3, now: () => clock });
    assert.deepEqual([1, 2, 3, 4, 5].map(() => limiter.allow('1.1.1.1')), [true, true, true, false, false]);
    assert.equal(limiter.allow('2.2.2.2'), true, 'another address has its own budget');
    clock += 59_999;
    assert.equal(limiter.allow('1.1.1.1'), false, 'still inside the window');
    clock += 2;
    assert.equal(limiter.allow('1.1.1.1'), true, 'a new window starts');
});

test('the list of tracked addresses cannot grow without bound', () => {
    let clock = 0;
    const limiter = createHandshakeLimiter({ windowMs: 1_000, max: 5, maxTracked: 100, now: () => clock });
    for (let i = 0; i < 100; i++) limiter.allow(`10.0.0.${i}`);
    assert.equal(limiter.size(), 100);
    clock += 2_000; // every entry has expired
    limiter.allow('10.9.9.9'); // going over the cap sweeps the expired ones
    assert.ok(limiter.size() <= 2, `size ${limiter.size()}`);
    clock += 2_000;
    limiter.sweep();
    assert.equal(limiter.size(), 0);
});

test('the client address is the last X-Forwarded-For entry, the one written by the trusted proxy', () => {
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7' } }), '203.0.113.7');
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } }), '203.0.113.7', 'what the client wrote first is ignored');
    assert.equal(clientIp({ headers: { 'x-forwarded-for': ' , ' }, socket: { remoteAddress: '::1' } }), '::1');
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.9' } }), '10.0.0.9');
    assert.equal(clientIp({ headers: {} }), 'unknown');
});

test('only the start of a connection counts, not the traffic of one that is already open', () => {
    assert.equal(isNewSession({ method: 'GET', url: '/socket.io/?EIO=4&transport=polling&t=abc' }), true);
    assert.equal(isNewSession({ method: 'GET', url: '/socket.io/?EIO=4&transport=websocket' }), true);
    assert.equal(isNewSession({ method: 'GET', url: '/socket.io/?EIO=4&transport=polling&t=abc&sid=Xy12' }), false, 'a poll of an open connection');
    assert.equal(isNewSession({ method: 'POST', url: '/socket.io/?EIO=4&transport=polling&sid=Xy12' }), false);
    assert.equal(isNewSession({ method: 'GET', url: '/socket.io/?EIO=4&transport=websocket&sid=Xy12' }), false, 'the upgrade to WebSocket');
    assert.equal(isNewSession({ method: 'OPTIONS', url: '/socket.io/?EIO=4&transport=polling' }), false, 'the CORS preflight is not a connection');
});
