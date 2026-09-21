import test from 'node:test';
import assert from 'node:assert/strict';
import { isNoise, fingerprint, createClientReporter, cspViolation, MAX_REPORTS_PER_PAGE, DEDUPE_MS } from './errorReportCore.js';

const ORIGIN = 'https://app.test';
const error = (message, extra = {}) => ({ kind: 'error', message, stack: `Error: ${message}\n    at render (${ORIGIN}/assets/index-abc123.js:10:5)`, ...extra });

function harness(options = {}) {
  const sent = [];
  let clock = 1_000_000;
  const reporter = createClientReporter({ send: (payload, raw) => sent.push({ payload, raw }), now: () => clock, origin: ORIGIN, ...options });
  return { reporter, sent, advance: (ms) => { clock += ms; } };
}

test('errors that say nothing about this site are ignored', () => {
  for (const message of ['Script error.', 'Script error', 'ResizeObserver loop completed with undelivered notifications.', 'ResizeObserver loop limit exceeded', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'AbortError: The user aborted a request.', '', '   ', undefined, null]) {
    assert.equal(isNoise({ message, origin: ORIGIN }), true, String(message));
  }
  assert.equal(isNoise({ message: "Cannot read properties of undefined (reading 'map')", origin: ORIGIN }), false);
  assert.equal(isNoise({ message: 'Failed to fetch dynamically imported module: /assets/Goal-abc.js', origin: ORIGIN }), false, 'a chunk that fails to load is a real problem');
});

test('extensions and third-party scripts (ads, payments) are not our code', () => {
  assert.equal(isNoise({ message: 'x is not a function', source: 'chrome-extension://abcdef/content.js', origin: ORIGIN }), true);
  assert.equal(isNoise({ message: 'x is not a function', stack: 'at f (moz-extension://1234/inject.js:1:1)', origin: ORIGIN }), true);
  assert.equal(isNoise({ message: 'ads broke', source: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', origin: ORIGIN }), true);
  assert.equal(isNoise({ message: 'boom', source: `${ORIGIN}/assets/index-abc.js`, origin: ORIGIN }), false, 'our own bundle');
  assert.equal(isNoise({ message: 'boom', source: 'https://pagead2.googlesyndication.com/x.js', origin: '' }), false, 'without an origin nothing is guessed');
  assert.equal(isNoise({ message: 'boom', origin: ORIGIN }), false, 'a rejection has no source file');
});

test('the same error has the same fingerprint whatever the query string or line', () => {
  const a = error('boom', { stack: `at f (${ORIGIN}/assets/index.js?v=1:10:5)` });
  const b = error('boom', { stack: `at f (${ORIGIN}/assets/index.js?v=2:10:5)` });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(error('another')));
  assert.notEqual(fingerprint(a), fingerprint({ ...a, kind: 'promise' }));
});

test('an error is sent once and cleaned up: kind, message, stack and where it happened', () => {
  const { reporter, sent } = harness();
  assert.equal(reporter.report(error('boom', { context: '/panel' })), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].payload).sort(), ['context', 'kind', 'message', 'stack']);
  assert.equal(sent[0].payload.context, '/panel');
  assert.equal(sent[0].raw.message, 'boom');
});

test('the same error inside the window is sent once, and again after it', () => {
  const { reporter, sent, advance } = harness();
  assert.equal(reporter.report(error('boom')), true);
  advance(DEDUPE_MS - 1);
  assert.equal(reporter.report(error('boom')), false);
  advance(2);
  assert.equal(reporter.report(error('boom')), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(reporter.stats(), { sent: 2, suppressed: 1 });
});

test('a page cannot send more than the cap, however many different errors it has', () => {
  const { reporter, sent } = harness();
  for (let i = 0; i < MAX_REPORTS_PER_PAGE + 15; i++) reporter.report(error(`error number ${'x'.repeat(i)}`));
  assert.equal(sent.length, MAX_REPORTS_PER_PAGE);
  assert.equal(reporter.stats().suppressed, 15);
});

test('long messages and stacks are cut before they are sent', () => {
  const { reporter, sent } = harness();
  reporter.report({ kind: 'error', message: 'm'.repeat(2000), stack: 's'.repeat(9000) });
  assert.equal(sent[0].payload.message.length, 300);
  assert.equal(sent[0].payload.stack.length, 2000);
});

test('noise, junk and reports with no message are dropped without being sent', () => {
  const { reporter, sent } = harness();
  for (const raw of [null, undefined, 'text', 5, {}, { kind: 'error' }, { kind: 'error', message: 'Script error.' }, { kind: 'error', message: 'x', source: 'chrome-extension://a/b.js' }]) {
    assert.equal(reporter.report(raw), false, JSON.stringify(raw));
  }
  assert.equal(sent.length, 0);
});

test('an error inside the sending does not report itself in a loop, and never reaches the page', () => {
  let reporter;
  const calls = [];
  reporter = createClientReporter({
    send: (payload) => { calls.push(payload.message); reporter.report(error('raised while sending')); throw new Error('the network layer blew up'); },
    origin: ORIGIN,
  });
  assert.doesNotThrow(() => reporter.report(error('first')));
  assert.deepEqual(calls, ['first'], 'the nested report was refused');
  reporter.report(error('second'));
  assert.deepEqual(calls, ['first', 'second'], 'and the reporter keeps working afterwards');
});

test('a content security policy violation is turned into the report format the server understands', () => {
  const violation = cspViolation({
    effectiveDirective: 'script-src-elem', blockedURI: 'https://evil.example/x.js?token=1', disposition: 'report',
    sourceFile: `${ORIGIN}/assets/index.js`, lineNumber: 42,
  }, `${ORIGIN}/panel`);
  assert.equal(violation.kind, 'csp');
  assert.equal(violation.message, 'script-src-elem habría bloqueado evil.example');
  assert.equal(violation.stack, `at ${ORIGIN}/assets/index.js:42`);
  assert.deepEqual(violation.body, { 'csp-report': {
    'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=1', 'document-uri': `${ORIGIN}/panel`,
    'source-file': `${ORIGIN}/assets/index.js`, 'line-number': 42, disposition: 'report',
  } });
  const inline = cspViolation({ violatedDirective: 'img-src', blockedURI: 'inline', disposition: 'enforce' }, ORIGIN);
  assert.equal(inline.message, 'img-src bloqueó inline');
  assert.equal(inline.body['csp-report'].disposition, 'enforce');
  const empty = cspViolation({}, ORIGIN);
  assert.equal(empty.message, 'una directiva habría bloqueado un recurso');
});

test('one violation of the same policy is sent once per minute, not once per blocked resource load', () => {
  const { reporter, sent, advance } = harness();
  const violation = () => cspViolation({ effectiveDirective: 'img-src', blockedURI: 'https://ads.example/1.png', disposition: 'report' }, ORIGIN);
  assert.equal(reporter.report(violation()), true);
  assert.equal(reporter.report(violation()), false);
  advance(DEDUPE_MS + 1);
  assert.equal(reporter.report(violation()), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].raw.body['csp-report']['blocked-uri'], 'https://ads.example/1.png', 'the original report travels with the payload');
});
