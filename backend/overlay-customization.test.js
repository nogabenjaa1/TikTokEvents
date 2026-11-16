const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeOverlayCustomization } = require('./lib/tenantSanitizers');

// Textos fijos y fuente de cada overlay: el servidor los guarda y reenvía al
// overlay de OBS, así que solo deja pasar valores conocidos.
test('los textos fijos y la fuente se aceptan si son válidos', () => {
  const out = sanitizeOverlayCustomization({ versus: { labelText: { type: 'gradient', from: '#112233', to: '#445566', fontSize: 'xlarge' }, font: 'bebas' } });
  assert.deepEqual(out.versus.labelText, { type: 'gradient', color: '#FFFFFF', from: '#112233', to: '#445566', fontSize: 'xlarge' });
  assert.equal(out.versus.font, 'bebas');
});

test('lo desconocido vuelve a lo de siempre (y lo guardado antes no cambia de look)', () => {
  const out = sanitizeOverlayCustomization({ games: { labelText: { type: 'neon', color: 'red', fontSize: 'huge' }, font: 'comic-sans' } });
  assert.deepEqual(out.games.labelText, { type: 'default', color: '#FFFFFF', from: '#7C3AED', to: '#3B82F6', fontSize: 'normal' });
  assert.equal(out.games.font, 'sora');
  assert.equal(sanitizeOverlayCustomization({}).chat.labelText.type, 'default');
});

// Overlay secundario de Eliminación (?screen=elimlist): su personalización
// se guarda aparte de la del overlay de juegos.
test('la lista de participantes de Eliminación tiene su propia personalización', () => {
  const out = sanitizeOverlayCustomization({ elimlist: { background: { type: 'transparent' }, font: 'bebas' } });
  assert.equal(out.elimlist.background.type, 'transparent');
  assert.equal(out.elimlist.font, 'bebas');
  assert.equal(out.games.background.type, 'solid');
  // Un mapa guardado antes de que existiera también la recibe, con lo de siempre.
  assert.equal(sanitizeOverlayCustomization({}).elimlist.background.type, 'solid');
});

test('el overlay cuadrado de Eliminación tiene su propia personalización', () => {
  const out = sanitizeOverlayCustomization({ elim: { background: { type: 'transparent' } } });
  assert.equal(out.elim.background.type, 'transparent');
  assert.equal(sanitizeOverlayCustomization({}).elim.background.type, 'solid');
});
