const test = require('node:test');
const assert = require('node:assert/strict');
const { findOrphans, usageByLicense, licenseIdOfPath, MIN_ORPHAN_AGE_MS } = require('./lib/storageOrphans');

// An orphan is a file in the bucket that no alert and no goal sound uses. The rule that matters most: never
// delete anything that could be in use, including an upload that has just finished and is not saved yet.

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const file = (path, { size = 100, hoursOld = 48 } = {}) => ({ path, size, createdAt: hoursOld === null ? null : NOW - hoursOld * HOUR });

test('the age limit is 24 hours', () => {
  assert.equal(MIN_ORPHAN_AGE_MS, 24 * HOUR);
});

test('a file no alert uses and older than a day is an orphan; a file in use never is', () => {
  const { orphans, totals } = findOrphans({
    files: [file('lic1/used.png'), file('lic1/stray.mp3', { size: 500 }), file('lic2/old-upload.gif', { size: 700 })],
    referenced: new Set(['lic1/used.png']),
    now: NOW,
  });
  assert.deepEqual(orphans.map((f) => f.path), ['lic1/stray.mp3', 'lic2/old-upload.gif']);
  assert.deepEqual(totals, { files: 3, bytes: 1300, orphans: 2, orphanBytes: 1200 });
});

test('a recent file is left alone: an upload finishes a moment before its alert is saved', () => {
  const { orphans } = findOrphans({
    files: [file('lic1/just-uploaded.png', { hoursOld: 0.01 }), file('lic1/yesterday-ish.png', { hoursOld: 23.9 }), file('lic1/two-days.png', { hoursOld: 48 })],
    referenced: new Set(),
    now: NOW,
  });
  assert.deepEqual(orphans.map((f) => f.path), ['lic1/two-days.png']);
});

test('a file with no known date is treated as recent, never as an orphan', () => {
  const { orphans } = findOrphans({ files: [file('lic1/mystery.png', { hoursOld: null }), { path: 'lic1/nan.png', size: 1, createdAt: NaN }], referenced: new Set(), now: NOW });
  assert.deepEqual(orphans, []);
});

test('exactly at the limit counts as old enough, and a different limit can be given', () => {
  const at = findOrphans({ files: [file('a/x.png', { hoursOld: 24 })], referenced: new Set(), now: NOW });
  assert.equal(at.orphans.length, 1);
  const strict = findOrphans({ files: [file('a/x.png', { hoursOld: 2 })], referenced: new Set(), now: NOW, minAgeMs: HOUR });
  assert.equal(strict.orphans.length, 1);
});

test('sizes that are missing or not numbers count as zero, and an empty bucket has nothing to report', () => {
  const { totals } = findOrphans({ files: [{ path: 'a/x', createdAt: NOW - 48 * HOUR }, { path: 'a/y', size: 'abc', createdAt: NOW - 48 * HOUR }], referenced: new Set(), now: NOW });
  assert.deepEqual([totals.bytes, totals.orphanBytes, totals.orphans], [0, 0, 2]);
  assert.deepEqual(findOrphans({ files: [], referenced: new Set(), now: NOW }), { orphans: [], totals: { files: 0, bytes: 0, orphans: 0, orphanBytes: 0 } });
});

test('the license of a file is the folder it lives in', () => {
  assert.equal(licenseIdOfPath('4a8f-1/alert.png'), '4a8f-1');
  assert.equal(licenseIdOfPath('a/b/c.png'), 'a');
  assert.equal(licenseIdOfPath('loose.png'), null);
  assert.equal(licenseIdOfPath('/leading.png'), null);
  assert.equal(licenseIdOfPath(''), null);
});

test('usage by license lists who takes the most space, biggest first, and ignores loose files', () => {
  const usage = usageByLicense([
    file('a/1.png', { size: 100 }), file('a/2.png', { size: 300 }),
    file('b/1.mp4', { size: 900 }),
    file('c/1.png', { size: 50 }),
    file('loose.png', { size: 5000 }),
  ], 2);
  assert.deepEqual(usage, [{ licenseId: 'b', files: 1, bytes: 900 }, { licenseId: 'a', files: 2, bytes: 400 }]);
  assert.equal(usageByLicense([], 5).length, 0);
  assert.equal(usageByLicense([file('a/1.png'), file('b/1.png'), file('c/1.png')]).length, 3, 'default limit is generous');
});
