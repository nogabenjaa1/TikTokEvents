const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// When Spotify is read. It used to be every 4 seconds all day long while any panel or overlay was open, and each
// reading also queried the database: that was most of Supabase's egress. Now it is read only when something may
// have changed, and only while the streamer is live.

const { nextSpotifyPollDelay, POLL_FAST_MS, POLL_MAX_MS, POLL_MIN_MS, TRACK_END_MARGIN_MS } = require('./lib/spotifyQueueSync');

const NOW = 1_800_000_000_000;

test('a song just asked with !play that Spotify does not show yet is checked soon, but only for its first minute', () => {
  const fresh = [{ seen: false, addedAt: NOW - 10_000 }];
  assert.equal(nextSpotifyPollDelay({ requests: fresh, now: NOW }), POLL_FAST_MS);
  const old = [{ seen: false, addedAt: NOW - 5 * 60_000 }];
  assert.equal(nextSpotifyPollDelay({ requests: old, now: NOW }), POLL_MAX_MS, 'one that never shows up does not keep the fast reading on forever');
  const seen = [{ seen: true, addedAt: NOW - 1000 }];
  assert.equal(nextSpotifyPollDelay({ requests: seen, now: NOW }), POLL_MAX_MS);
});

test('a playing song is read again right when it should end, never later than the safety check', () => {
  const playing = (progressMs, durationMs, readAt = NOW) => ({ isPlaying: true, progressMs, durationMs, readAt });
  assert.equal(nextSpotifyPollDelay({ playback: playing(170_000, 180_000), now: NOW }), 10_000 + TRACK_END_MARGIN_MS);
  assert.equal(nextSpotifyPollDelay({ playback: playing(10_000, 240_000), now: NOW }), POLL_MAX_MS, 'a long way to go: the 30 s safety check comes first');
  assert.equal(nextSpotifyPollDelay({ playback: playing(179_900, 180_000), now: NOW }), POLL_MIN_MS, 'about to end: not a burst of instant readings');
  assert.equal(nextSpotifyPollDelay({ playback: playing(170_000, 180_000, NOW - 4000), now: NOW }), 6000 + TRACK_END_MARGIN_MS, 'time since the reading counts');
});

test('paused, nothing playing or unknown progress: only the safety check', () => {
  assert.equal(nextSpotifyPollDelay({ playback: { isPlaying: false, progressMs: 1000, durationMs: 180_000 }, now: NOW }), POLL_MAX_MS);
  assert.equal(nextSpotifyPollDelay({ playback: null, now: NOW }), POLL_MAX_MS);
  assert.equal(nextSpotifyPollDelay({ playback: { isPlaying: true, progressMs: 0, durationMs: 0 }, now: NOW }), POLL_MAX_MS);
  assert.equal(nextSpotifyPollDelay(), POLL_MAX_MS);
});

// ── The tenant side: who schedules the next reading, with fake timers ──

function tenantWith({ live = true, playback = null, account = { license_id: 'l1' } } = {}) {
  const timers = [];
  const calls = { queue: 0, playback: 0, skip: 0 };
  const spotifyApi = {
    getQueue: async () => { calls.queue++; return { currently_playing: { uri: 'spotify:track:a', name: 'A', artists: [] }, queue: [] }; },
    getPlaybackState: async () => { calls.playback++; return playback; },
    skipToNext: async () => { calls.skip++; },
    SpotifyPlaybackError: class extends Error {},
  };
  const fakeSetTimeout = (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; };
  const fakeClearTimeout = (timer) => { if (timer) timer.cleared = true; };
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('/spotify') ? spotifyApi : name.endsWith('/db') ? {} : name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : {}),
    console: { log() {}, warn() {}, error() {} }, Date, setInterval, clearInterval, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/spotify'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  Object.assign(tenant, {
    logId: 'ana/l1', liveConnected: live, spotifyPollInterval: null,
    spotifySettings: { maxQueueSize: 8 }, spotifyQueueState: { queue: [], nowPlaying: null }, spotifyQueueCounter: 0,
    broadcast: { emit() {} },
  });
  tenant.getAllowedSpotifyAccount = async () => account;
  tenant.getSpotifyAccessTokenOrDrop = async () => 'token';
  const pending = () => timers.filter((t) => !t.cleared && !t.fired);
  const fire = async () => { const [timer] = pending(); timer.fired = true; await timer.fn(); };
  return { tenant, calls, timers, pending, fire };
}

test('off the LIVE, opening a panel or overlay reads Spotify once and schedules nothing', async () => {
  const { tenant, calls, pending } = tenantWith({ live: false });
  await tenant.maybeStartSpotifyPolling();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.queue, 1, 'one reading so the overlay shows what is playing');
  assert.equal(pending().length, 0, 'no recurring readings off the LIVE');
});

test('live, each reading schedules the next one from the song that is playing', async () => {
  const { tenant, calls, pending, fire } = tenantWith({ playback: { isPlaying: true, progressMs: 170_000, durationMs: 180_000 } });
  await tenant.maybeStartSpotifyPolling();
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].ms, 0, 'going live reads right away');
  await fire();
  assert.equal(calls.queue, 1);
  assert.equal(pending().length, 1, 'exactly one next reading');
  const next = pending()[0].ms;
  assert.ok(next > 10_000 && next <= 10_000 + TRACK_END_MARGIN_MS, `scheduled for the end of the song, got ${next}`);
});

test('when the LIVE ends, the next reading does not schedule another one', async () => {
  const { tenant, calls, pending, fire } = tenantWith();
  await tenant.maybeStartSpotifyPolling();
  tenant.liveConnected = false;
  await fire();
  assert.equal(calls.queue, 1);
  assert.equal(pending().length, 0);
});

test('a !skip reads Spotify again shortly after, instead of waiting for the next scheduled reading', async () => {
  const { tenant, calls, pending } = tenantWith();
  tenant.scheduleSpotifyPoll(30_000);
  await tenant.skipSpotifyTrack();
  assert.equal(calls.skip, 1);
  assert.equal(pending().length, 1, 'the later reading is replaced, not added to');
  assert.equal(pending()[0].ms, 1500);
});

test('a reading already running when another is scheduled does not leave two readings scheduled', async () => {
  const { tenant, pending, fire } = tenantWith();
  tenant.scheduleSpotifyPoll(30_000);
  const run = fire();
  tenant.requestSpotifyPollSoon(1500);
  await run;
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].ms, 1500);
});

test('without a usable account the readings stop', async () => {
  const { tenant, pending, fire } = tenantWith({ account: null });
  tenant.scheduleSpotifyPoll(0);
  await fire();
  assert.equal(pending().length, 0);
});
