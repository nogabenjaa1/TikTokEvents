const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The songs asked with !play that the overlay lists as "next". Spotify shows its real queue late and short, so a song
// Spotify accepted must not vanish from the overlay just because one reading did not list it yet: viewers saw it
// disappear while it was still queued, and asked for it again.

const {
  createSpotifyRequest, publicSpotifyRequest, reconcileSpotifyRequests,
  QUEUE_READ_LIMIT, MISSES_BEFORE_DROP, UNSEEN_TTL_MS, EMPTY_READS_BEFORE_CLEAR,
} = require('./lib/spotifyQueueSync');

const NOW = 1_000_000;
const req = (n, extra = {}) => ({ id: n, uri: `spotify:track:${n}`, title: `Song ${n}`, artist: 'Artist', albumArt: '', requestedBy: `viewer${n}`, playing: false, addedAt: NOW, seen: false, misses: 0, ...extra });
const track = (n, extra = {}) => ({ uri: `spotify:track:${n}`, name: `Song ${n}`, artists: [{ name: 'Artist' }], ...extra });
const live = ({ current = null, queue = [] } = {}) => ({ currently_playing: current, queue });
const uris = (list) => list.map((r) => r.uri.split(':').pop());

test('a song Spotify accepted but does not list yet stays on the overlay, read after read', () => {
  let requests = [req(1)];
  let emptyReads = 0;
  for (let i = 0; i < 10; i++) {
    // Something else is playing and the queue reading has not caught up with the new song.
    const result = reconcileSpotifyRequests(requests, live({ current: track(99) }), { now: NOW + i * 4000, emptyReads });
    ({ requests, emptyReads } = result);
    assert.deepEqual(uris(requests), ['1'], `read ${i + 1}`);
    assert.deepEqual(result.dropped, []);
  }
  assert.equal(requests[0].seen, false, 'it has never been seen, but it is not dropped for that');
});

test('the first time Spotify lists a song it is marked as seen, and it keeps showing as upcoming', () => {
  const result = reconcileSpotifyRequests([req(1)], live({ current: track(99), queue: [track(1)] }), { now: NOW + 5000 });
  assert.deepEqual(result.requests.map((r) => [r.uri, r.seen, r.playing, r.misses]), [['spotify:track:1', true, false, 0]]);
  assert.equal(result.currentRequest, null, 'what is playing is not one of ours');
});

test('a song that reaches the top plays, and after it ends it leaves the list without ever coming back as upcoming', () => {
  let state = { requests: [req(1, { seen: true })], emptyReads: 0 };
  const step = (reading) => { state = { ...reconcileSpotifyRequests(state.requests, reading, { now: NOW, emptyReads: state.emptyReads }) }; return state; };

  let result = step(live({ current: track(1), queue: [] }));
  assert.deepEqual(result.requests.map((r) => r.playing), [true]);
  assert.equal(result.currentRequest.requestedBy, 'viewer1');

  // It ended and another song plays: one reading without it is not enough to drop it...
  result = step(live({ current: track(50), queue: [track(51)] }));
  assert.deepEqual(uris(result.requests), ['1']);
  assert.equal(result.requests[0].playing, true, 'it keeps its playing mark, so it is not shown among the upcoming ones');
  assert.deepEqual(result.dropped, []);

  // ...the second one confirms it.
  result = step(live({ current: track(50), queue: [track(51)] }));
  assert.deepEqual(result.requests, []);
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /ya se tocó/);
  assert.equal(result.dropped[0].request.title, 'Song 1');
  assert.equal(MISSES_BEFORE_DROP, 2);
});

test('a reading that comes back incomplete once does not drop a queued song, and the next good one recovers it', () => {
  const queued = req(1, { seen: true });
  let result = reconcileSpotifyRequests([queued], live({ current: track(99), queue: [track(2)] }), { now: NOW });
  assert.deepEqual(result.requests.map((r) => [r.uri, r.misses, r.playing]), [['spotify:track:1', 1, false]]);
  result = reconcileSpotifyRequests(result.requests, live({ current: track(99), queue: [track(1), track(2)] }), { now: NOW });
  assert.deepEqual(result.requests.map((r) => [r.uri, r.misses, r.seen]), [['spotify:track:1', 0, true]]);
});

test('a song Spotify never lists is dropped after fifteen minutes, not before', () => {
  const short = live({ current: track(99), queue: [track(2)] });
  const almost = reconcileSpotifyRequests([req(1)], short, { now: NOW + UNSEEN_TTL_MS - 1 });
  assert.deepEqual(uris(almost.requests), ['1']);
  const late = reconcileSpotifyRequests([req(1)], short, { now: NOW + UNSEEN_TTL_MS });
  assert.deepEqual(late.requests, []);
  assert.match(late.dropped[0].reason, /nunca la mostró/);
});

test('with a long queue on screen the songs it does not list may be further down, so they never expire', () => {
  const longQueue = Array.from({ length: QUEUE_READ_LIMIT }, (_, i) => track(100 + i));
  const result = reconcileSpotifyRequests([req(1)], live({ current: track(99), queue: longQueue }), { now: NOW + 3 * UNSEEN_TTL_MS });
  assert.deepEqual(uris(result.requests), ['1']);
  const shorter = reconcileSpotifyRequests([req(1)], live({ current: track(99), queue: longQueue.slice(1) }), { now: NOW + 3 * UNSEEN_TTL_MS });
  assert.deepEqual(shorter.requests, [], 'one below the limit is a complete reading');
});

test('three empty readings in a row mean the queue is gone and everything leaves, and any other reading resets the count', () => {
  let requests = [req(1), req(2, { seen: true })];
  let emptyReads = 0;
  for (let i = 1; i < EMPTY_READS_BEFORE_CLEAR; i++) {
    const result = reconcileSpotifyRequests(requests, live(), { now: NOW, emptyReads });
    ({ requests, emptyReads } = result);
    assert.equal(emptyReads, i);
    assert.equal(requests.length, 2, `after ${i} empty readings nothing is dropped yet`);
    assert.deepEqual(requests.map((r) => r.misses), [0, 0], 'an empty reading is ambiguous: it does not count against any song');
  }
  // A reading with something playing in between starts the count over.
  const between = reconcileSpotifyRequests(requests, live({ current: track(99) }), { now: NOW, emptyReads });
  assert.equal(between.emptyReads, 0);
  const again = reconcileSpotifyRequests(between.requests, live(), { now: NOW, emptyReads: between.emptyReads });
  assert.equal(again.requests.length, 2);
  // Three in a row: gone, even the song Spotify never showed.
  let final = { requests, emptyReads: 0 };
  for (let i = 0; i < EMPTY_READS_BEFORE_CLEAR; i++) final = reconcileSpotifyRequests(final.requests, live(), { now: NOW, emptyReads: final.emptyReads });
  assert.deepEqual(final.requests, []);
  assert.equal(final.dropped.length, 2);
  assert.match(final.dropped[0].reason, /nada sonando/);
});

test('the same song asked twice is counted, not just found: the older one takes the playing slot, the newer the queued one', () => {
  const twice = [req(1, { id: 10, seen: true }), req(1, { id: 11, seen: true })];
  const both = reconcileSpotifyRequests(twice, live({ current: track(1), queue: [track(1)] }), { now: NOW });
  assert.deepEqual(both.requests.map((r) => [r.id, r.playing]), [[10, true], [11, false]]);
  assert.equal(both.currentRequest.id, 10);

  // Only one copy is left in Spotify's queue: one of the two has been played.
  const one = reconcileSpotifyRequests(twice, live({ current: track(99), queue: [track(1)] }), { now: NOW });
  assert.deepEqual(one.requests.map((r) => [r.id, r.misses]), [[10, 0], [11, 1]]);
});

test('a song Spotify swapped for another version in the account country still matches the address that was asked for', () => {
  const relinked = { uri: 'spotify:track:777', name: 'Song 1', artists: [{ name: 'Artist' }], linked_from: { uri: 'spotify:track:1' } };
  const playing = reconcileSpotifyRequests([req(1)], live({ current: relinked }), { now: NOW });
  assert.equal(playing.currentRequest.requestedBy, 'viewer1');
  const queued = reconcileSpotifyRequests([req(1)], live({ current: track(99), queue: [relinked] }), { now: NOW });
  assert.deepEqual(queued.requests.map((r) => [r.seen, r.playing]), [[true, false]]);
});

test('a reading that cannot be understood says nothing about the queue: the list stays as it was', () => {
  const list = [req(1, { seen: true, misses: 1 }), req(2)];
  for (const unreadable of [null, undefined, 'error', 42]) {
    const result = reconcileSpotifyRequests(list, unreadable, { now: NOW + 10 * UNSEEN_TTL_MS, emptyReads: 2 });
    assert.deepEqual(result.requests, list, String(unreadable));
    assert.equal(result.emptyReads, 2);
    assert.deepEqual(result.dropped, []);
  }
  assert.deepEqual(reconcileSpotifyRequests(undefined, live({ current: track(1) }), { now: NOW }).requests, []);
});

test('the list it is given is never modified, and a queue restored from before starts counting from now', () => {
  const restored = [{ id: 1, uri: 'spotify:track:1', title: 'Song 1', artist: 'A', albumArt: '', requestedBy: 'v', playing: false }];
  const frozen = restored.map((r) => Object.freeze({ ...r }));
  const result = reconcileSpotifyRequests(Object.freeze(frozen), live({ current: track(99) }), { now: NOW });
  assert.equal(result.requests[0].addedAt, NOW);
  assert.equal(result.requests[0].seen, false);
  assert.equal(restored[0].addedAt, undefined);
  assert.notEqual(result.requests[0], frozen[0]);
});

test('a new request is built from what Spotify found, and what leaves the server hides the tracking fields', () => {
  const found = { uri: 'spotify:track:abc', name: 'Hey', artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'big.jpg' }, { url: 'mid.jpg' }, { url: 'small.jpg' }] } };
  const created = createSpotifyRequest({ id: 7, track: found, username: 'ana', now: NOW });
  assert.deepEqual(created, {
    id: 7, uri: 'spotify:track:abc', title: 'Hey', artist: 'A, B', albumArt: 'small.jpg', requestedBy: 'ana', playing: false,
    addedAt: NOW, seen: false, misses: 0,
  });
  assert.deepEqual(publicSpotifyRequest(created), { id: 7, uri: 'spotify:track:abc', title: 'Hey', artist: 'A, B', albumArt: 'small.jpg', requestedBy: 'ana', playing: false });
  const bare = createSpotifyRequest({ id: 8, track: { uri: 'u', name: 'N' }, username: 'x', now: NOW });
  assert.deepEqual([bare.artist, bare.albumArt], ['', '']);
});

// ── The tenant side (lib/tenant/spotify.js), with Spotify's answers played back one reading at a time ──

function tenantWith(spotifyApi) {
  const logs = [];
  const emitted = [];
  const context = {
    module: { exports: {} },
    require: (name) => (name.endsWith('/spotify') ? spotifyApi : name.endsWith('/db') ? {} : name.includes('tenantHelpers') ? require('./lib/tenantHelpers') : {}),
    console: { log: (...args) => logs.push(args.join(' ')), warn() {}, error() {} }, Date, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/tenant/spotify'), 'utf8'), context);
  const tenant = Object.create(context.module.exports);
  tenant.logId = 'ana/l1';
  tenant.spotifySettings = { maxQueueSize: 8 };
  tenant.spotifyQueueState = { queue: [], nowPlaying: null };
  tenant.spotifyQueueCounter = 0;
  tenant.broadcast = { emit: (name, payload) => emitted.push({ name, payload: JSON.parse(JSON.stringify(payload)) }) };
  tenant.getAllowedSpotifyAccount = async () => ({ license_id: 'l1' });
  tenant.getSpotifyAccessTokenOrDrop = async () => 'token';
  tenant.startSpotifyQueuePolling = () => {};
  return { tenant, logs, emitted, lastQueue: () => emitted.filter((e) => e.name === 'spotify_queue_update').at(-1)?.payload };
}

test('a song asked with !play stays on the overlay while Spotify catches up, and leaves only after it has played', async () => {
  let reading;
  const requested = { uri: 'spotify:track:b', name: 'Song B', artists: [{ name: 'Band' }], album: { images: [{ url: 'b.jpg' }] } };
  const { tenant, logs, emitted, lastQueue } = tenantWith({
    searchTrack: async () => requested, addToQueue: async () => {}, getQueue: async () => reading,
    SpotifyPlaybackError: class extends Error {},
  });
  const songA = { uri: 'spotify:track:a', name: 'Song A', artists: [{ name: 'Band' }] };
  const songC = { uri: 'spotify:track:c', name: 'Song C', artists: [{ name: 'Band' }] };

  await tenant.requestSpotifySong('viewer', 'song b');
  assert.equal(emitted.length, 1);
  assert.deepEqual(lastQueue().queue, [{ id: 1, uri: 'spotify:track:b', title: 'Song B', artist: 'Band', albumArt: 'b.jpg', requestedBy: 'viewer', playing: false }],
    'the overlay is told about it at once, without the tracking fields');

  // Spotify's queue reading has not caught up: the song is accepted but not listed yet. This is what used to make it vanish.
  reading = { currently_playing: songA, queue: [] };
  for (let i = 0; i < 4; i++) await tenant.pollSpotifyQueue();
  assert.deepEqual(lastQueue().queue.map((s) => s.title), ['Song B'], 'still on the overlay after several readings');
  assert.deepEqual(lastQueue().nowPlaying.title, 'Song A');

  // It catches up.
  reading = { currently_playing: songA, queue: [requested] };
  await tenant.pollSpotifyQueue();
  assert.deepEqual(lastQueue().queue.map((s) => s.title), ['Song B']);

  // It starts playing: it moves to "now playing", asked by the viewer, and is no longer among the next ones.
  reading = { currently_playing: requested, queue: [] };
  await tenant.pollSpotifyQueue();
  assert.equal(lastQueue().nowPlaying.title, 'Song B');
  assert.equal(lastQueue().nowPlaying.requestedBy, 'viewer');
  assert.deepEqual(lastQueue().queue, []);

  // It ends and another one plays: it does not come back as an upcoming song for a moment, and then it is gone.
  reading = { currently_playing: songC, queue: [] };
  await tenant.pollSpotifyQueue();
  assert.deepEqual(lastQueue().queue, [], 'a finished song never reappears among the next ones');
  assert.equal(tenant.spotifyQueueState.queue.length, 1, 'kept internally for one more reading, in case that one was incomplete');
  await tenant.pollSpotifyQueue();
  assert.equal(tenant.spotifyQueueState.queue.length, 0);
  assert.ok(logs.some((line) => /"Song B" \(pedida por @viewer\) sale de la lista: ya se tocó/.test(line)), 'the reason is left in the server log');
});

test('the same song asked again while it is still queued shows twice, so viewers can see it is already there', async () => {
  const requested = { uri: 'spotify:track:b', name: 'Song B', artists: [{ name: 'Band' }] };
  const { tenant, lastQueue } = tenantWith({ searchTrack: async () => requested, addToQueue: async () => {}, getQueue: async () => ({ currently_playing: { uri: 'spotify:track:a', name: 'A', artists: [] }, queue: [] }) });
  await tenant.requestSpotifySong('one', 'song b');
  await tenant.pollSpotifyQueue();
  await tenant.requestSpotifySong('two', 'song b');
  await tenant.pollSpotifyQueue();
  assert.deepEqual(lastQueue().queue.map((s) => [s.title, s.requestedBy]), [['Song B', 'one'], ['Song B', 'two']]);
});

test('a queue that was cleared in Spotify empties the overlay after a few readings, and a reading that fails changes nothing', async () => {
  let reading = { currently_playing: { uri: 'spotify:track:a', name: 'A', artists: [] }, queue: [] };
  const requested = { uri: 'spotify:track:b', name: 'Song B', artists: [{ name: 'Band' }] };
  const { tenant, lastQueue } = tenantWith({ searchTrack: async () => requested, addToQueue: async () => {}, getQueue: async () => { if (!reading) throw new Error('503'); return reading; } });
  await tenant.requestSpotifySong('viewer', 'song b');
  reading = null;
  for (let i = 0; i < 5; i++) await tenant.pollSpotifyQueue();
  assert.equal(tenant.spotifyQueueState.queue.length, 1, 'a failing reading is not "nothing is queued"');
  reading = { currently_playing: null, queue: [] };
  for (let i = 0; i < EMPTY_READS_BEFORE_CLEAR; i++) await tenant.pollSpotifyQueue();
  assert.deepEqual(tenant.spotifyQueueState.queue, []);
  assert.deepEqual(lastQueue().queue, []);
});
