import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDraft, saveDraft } from './gameDraftStorage.js';

// Un localStorage de mentira: mismo trato que le da el resto de la suite a safeStorage.js
// (writeStorage/readStorage atrapan cualquier excepción, así que alcanza con simularla).
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    raw: data,
  };
}

test('nothing saved yet: the fallback comes back untouched', () => {
  globalThis.localStorage = fakeStorage();
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15, snipeTime: 5 }), { mainTime: 15, snipeTime: 5 });
});

test('what was saved is read back, merged over the fallback', () => {
  globalThis.localStorage = fakeStorage();
  saveDraft('tkc_king_draft', { mainTime: 90, selectedGift: { name: 'Rose', coins: 1 } });
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15, snipeTime: 5, selectedGift: null }), {
    mainTime: 90, snipeTime: 5, selectedGift: { name: 'Rose', coins: 1 },
  });
});

test('each game keeps its own draft under its own key', () => {
  globalThis.localStorage = fakeStorage();
  saveDraft('tkc_king_draft', { mainTime: 90 });
  saveDraft('tkc_zub_draft', { mainTime: 45 });
  assert.equal(loadDraft('tkc_king_draft', { mainTime: 15 }).mainTime, 90);
  assert.equal(loadDraft('tkc_zub_draft', { mainTime: 60 }).mainTime, 45);
});

test('a corrupted draft is ignored, never breaks the panel', () => {
  globalThis.localStorage = fakeStorage({ tkc_king_draft: '{not json' });
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15 }), { mainTime: 15 });
});

test('a draft saved as something other than an object is ignored', () => {
  globalThis.localStorage = fakeStorage({ tkc_king_draft: '"just a string"' });
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15 }), { mainTime: 15 });
  globalThis.localStorage = fakeStorage({ tkc_king_draft: '[1,2,3]' });
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15 }), { mainTime: 15 });
  globalThis.localStorage = fakeStorage({ tkc_king_draft: 'null' });
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15 }), { mainTime: 15 });
});

test('a blocked or full localStorage never throws: save is a no-op, load falls back', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('full'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => saveDraft('tkc_king_draft', { mainTime: 90 }));
  assert.deepEqual(loadDraft('tkc_king_draft', { mainTime: 15 }), { mainTime: 15 });
});

test('saving null/undefined fields overwrites the fallback with them (an explicit "unselected")', () => {
  globalThis.localStorage = fakeStorage();
  saveDraft('tkc_king_draft', { selectedGift: null });
  assert.deepEqual(loadDraft('tkc_king_draft', { selectedGift: { name: 'left over' } }), { selectedGift: null });
});
