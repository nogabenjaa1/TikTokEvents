import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_AREAS, AREA_TABS, TAB_LABELS, EVENT_TABS, areaOf, areaEntryTab, planLabel, sectionFromPath } from './app/navigation.js';

test('cada pestaña de TikTokEvents vive en exactamente un área', () => {
  for (const tab of EVENT_TABS) {
    const areas = Object.keys(AREA_TABS).filter((a) => AREA_TABS[a].includes(tab.id));
    assert.equal(areas.length, 1, tab.id);
  }
});

test('Color Says vive en Juegos, con su propia ruta', () => {
  assert.ok(AREA_TABS.games.includes('color'));
  assert.equal(areaOf('color', 'king'), 'games');
  assert.equal(sectionFromPath('/colordice').section, 'color');
});

test('el área se deduce de la sección y la pestaña de siempre', () => {
  assert.equal(areaOf('events', 'king'), 'games');
  assert.equal(areaOf('events', 'tts'), 'interaction');
  assert.equal(areaOf('events', 'goal'), 'timers');
  assert.equal(areaOf('overlay', 'king'), 'overlays');
  assert.equal(areaOf('dashboard'), 'home');
  assert.equal(areaOf('membership'), 'membership');
  assert.equal(areaOf('legal'), null);
});

test('las URLs viejas siguen resolviendo a la misma sección y pestaña', () => {
  assert.deepEqual(sectionFromPath('/tiktokevents/spotify'), { section: 'events', tab: 'spotify' });
  assert.deepEqual(sectionFromPath('/tiktokevents'), { section: 'events', tab: 'king' });
  assert.equal(sectionFromPath('/overlays').section, 'overlay');
});

test('un área abre su última pestaña usada, o la primera', () => {
  assert.equal(areaEntryTab('games', {}), 'king');
  assert.equal(areaEntryTab('games', { games: 'color' }), 'color');
  assert.equal(areaEntryTab('games', { games: 'tts' }), 'king');
  assert.equal(areaEntryTab('overlays', {}), null);
});

test('cada área sin pestañas apunta a una sección que existe', () => {
  for (const a of NAV_AREAS) {
    if (AREA_TABS[a.id]) continue;
    assert.ok(a.mode, a.id);
  }
  for (const tabs of Object.values(AREA_TABS)) for (const t of tabs) assert.ok(TAB_LABELS[t], t);
});

test('nombre del plan', () => {
  assert.equal(planLabel('month'), 'Plan mensual');
  assert.equal(planLabel('trial'), 'Prueba gratis');
  assert.equal(planLabel(undefined), 'Sin plan');
});
