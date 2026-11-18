import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTheme, sameTheme, accentHex, accentTokens, contrastRatio,
  hexToOklch, oklchToHex, PAGE_BG, DEFAULT_THEME, ACCENT_PRESETS,
} from './themeModel.js';

test('quien tenía Cute pasa al tema maestro con su acento y su color', () => {
  assert.deepEqual(normalizeTheme({ style: 'cute', accent: 'pink', customColor: '#112233' }),
    { style: 'default', accent: 'pink', customColor: '#112233' });
  assert.deepEqual(normalizeTheme({ style: 'cute', accent: 'custom', customColor: '#14B8A6' }),
    { style: 'default', accent: 'custom', customColor: '#14B8A6' });
});

test('Clásico conserva su acento', () => {
  assert.deepEqual(normalizeTheme({ style: 'default', accent: 'blue', customColor: '#7C3AED' }),
    { style: 'default', accent: 'blue', customColor: '#7C3AED' });
});

test('valores rotos o de versiones retiradas caen a los de fábrica sin lanzar', () => {
  assert.deepEqual(normalizeTheme(null), DEFAULT_THEME);
  assert.deepEqual(normalizeTheme('x'), DEFAULT_THEME);
  // Kawaii/Minimal y el acento verde se retiraron antes; siguen sin romper nada.
  assert.equal(normalizeTheme({ style: 'kawaii', accent: 'green' }).accent, 'purple');
  // Personalizado sin un color válido no se puede pintar: vuelve al de fábrica.
  assert.equal(normalizeTheme({ accent: 'custom', customColor: 'red' }).accent, 'purple');
});

test('dos temas son el mismo sin importar el material viejo', () => {
  assert.equal(sameTheme({ style: 'cute', accent: 'pink' }, { style: 'default', accent: 'pink' }), true);
  assert.equal(sameTheme({ accent: 'custom', customColor: '#111111' }, { accent: 'custom', customColor: '#222222' }), false);
});

test('accentHex usa el color propio solo con Personalizado', () => {
  assert.equal(accentHex({ accent: 'blue', customColor: '#000000' }), '#3B82F6');
  assert.equal(accentHex({ accent: 'custom', customColor: '#14B8A6' }), '#14B8A6');
});

test('ida y vuelta por OKLCH conserva el color', () => {
  for (const hex of ['#7c3aed', '#3b82f6', '#ec4899', '#14b8a6', '#808080']) {
    assert.equal(oklchToHex(hexToOklch(hex)), hex);
  }
});

const ANY_COLORS = ['#7C3AED', '#3B82F6', '#EC4899', '#FFFFFF', '#000000', '#808080', '#FFFF00', '#00FF00', '#14B8A6', '#F5F5DC', '#1A1A2E'];

for (const mode of ['dark', 'light']) {
  test(`(${mode}) cualquier color da un botón legible y un texto de acento de 4.5:1`, () => {
    for (const hex of ANY_COLORS) {
      const { vars } = accentTokens(hex, mode);
      // Texto del botón principal (12px en negrita, pero se exige 4.5:1 igual).
      assert.ok(contrastRatio(vars['--accent'], vars['--on-accent']) >= 4.5,
        `${hex} en ${mode}: botón ${vars['--accent']} / ${vars['--on-accent']}`);
      assert.ok(contrastRatio(vars['--accent-text'], PAGE_BG[mode]) >= 4.5,
        `${hex} en ${mode}: texto ${vars['--accent-text']}`);
      // El botón se distingue del fondo (componente de interfaz: 3:1).
      assert.ok(contrastRatio(vars['--accent'], PAGE_BG[mode]) >= 3,
        `${hex} en ${mode}: el botón se pierde contra el fondo`);
    }
  });
}

test('un gris se lleva a un acento con color y se avisa del ajuste', () => {
  const { adjusted, vars } = accentTokens('#808080', 'dark');
  assert.equal(adjusted, true);
  assert.ok(hexToOklch(vars['--accent']).c > 0.02);
});

test('los acentos de fábrica no se ajustan en oscuro', () => {
  for (const p of ACCENT_PRESETS) {
    assert.equal(accentTokens(p.hex, 'dark').adjusted, false, p.id);
  }
});
