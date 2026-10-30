import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  OVERLAY_STYLE_PRESETS, VISUAL_KEYS, defaultOverlayCustomizationMap, applyOverlayPreset, matchOverlayPreset,
  resetOverlayVisual, copyOverlayVisual, backgroundNeedsLightInk, resolveBackgroundStyle, getUsernameOverride,
} from './overlayCustomization.js';

const require = createRequire(import.meta.url);
const { sanitizeOverlayCustomization } = require('../../backend/lib/tenantSanitizers.js');

const fresh = () => defaultOverlayCustomizationMap().games;

test('el aspecto de fábrica se reconoce como el estilo Clásico', () => {
  assert.equal(matchOverlayPreset(fresh()), 'classic');
});

test('cada estilo se reconoce después de aplicarlo y después de pasar por el servidor', () => {
  for (const preset of OVERLAY_STYLE_PRESETS) {
    const applied = applyOverlayPreset(fresh(), preset.id);
    assert.equal(matchOverlayPreset(applied), preset.id, `${preset.id} recién aplicado`);
    // El servidor sanea y reenvía el mapa: si descartara algún valor del
    // estilo (una fuente o un tamaño que no conoce), al volver el panel lo
    // mostraría como "Personalizado" sin que nadie lo tocara.
    const echoed = sanitizeOverlayCustomization({ games: applied }).games;
    for (const key of VISUAL_KEYS) assert.deepEqual(echoed[key], applied[key], `${preset.id}.${key} tras el servidor`);
    assert.equal(matchOverlayPreset(echoed), preset.id, `${preset.id} tras el servidor`);
  }
});

test('un ajuste a mano después de un estilo queda como Personalizado y se conserva', () => {
  const neon = applyOverlayPreset(fresh(), 'neon');
  const tweaked = { ...neon, font: 'poppins' };
  assert.equal(matchOverlayPreset(tweaked), null);
  assert.equal(tweaked.background.from, neon.background.from, 'el resto del estilo sigue igual');
});

test('los estilos son distintos entre sí', () => {
  const sigs = OVERLAY_STYLE_PRESETS.map((p) => JSON.stringify(p.values));
  assert.equal(new Set(sigs).size, sigs.length);
});

test('un estilo no toca el volumen de las Alertas ni la animación del Chat', () => {
  const entry = { ...fresh(), volume: 0.35, messageAnimation: 'zoom' };
  const out = applyOverlayPreset(entry, 'party');
  assert.equal(out.volume, 0.35);
  assert.equal(out.messageAnimation, 'zoom');
});

test('restablecer devuelve el aspecto de fábrica y conserva el volumen', () => {
  const entry = { ...applyOverlayPreset(fresh(), 'arcade'), volume: 0.2, messageAnimation: 'bounce' };
  const out = resetOverlayVisual(entry);
  assert.equal(matchOverlayPreset(out), 'classic');
  assert.equal(out.volume, 0.2);
  assert.equal(out.messageAnimation, 'fade');
});

test('"Usar en todos" copia el aspecto pero no el volumen ni la animación (antes se perdían)', () => {
  const from = applyOverlayPreset(fresh(), 'neon');
  const alerts = { ...fresh(), volume: 0.4 };
  const chat = { ...fresh(), messageAnimation: 'slide-down' };
  const outAlerts = copyOverlayVisual(from, alerts);
  const outChat = copyOverlayVisual(from, chat);
  assert.equal(outAlerts.volume, 0.4);
  assert.equal(outChat.messageAnimation, 'slide-down');
  assert.equal(matchOverlayPreset(outAlerts), 'neon');
  // Copia, no la misma referencia: editar uno no debe cambiar el otro.
  outChat.background.from = '#000000';
  assert.notEqual(from.background.from, '#000000');
});

test('tinta automática: solo un degradado oscuro pasa el texto a claro', () => {
  const withBg = (background) => ({ ...fresh(), background });
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'gradient', from: '#14082E', to: '#3B0A63' })), true);
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'gradient', from: '#FDE68A', to: '#FBCFE8' })), false);
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'solid' })), false);
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'transparent' })), false);
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'rainbow' })), false);
  assert.equal(backgroundNeedsLightInk(withBg({ type: 'gradient', from: 'nope', to: '' })), false);
  // La tinta va en el mismo elemento que lleva el fondo.
  const style = resolveBackgroundStyle(withBg({ type: 'gradient', from: '#14082E', to: '#3B0A63' }));
  assert.equal(style['--ink-default'], '#F8F5FF');
  assert.equal(resolveBackgroundStyle(withBg({ type: 'solid' }))['--ink-default'], undefined);
});

test('el nombre "Original" sigue siendo negro salvo dentro de un fondo oscuro', () => {
  const o = getUsernameOverride(fresh());
  assert.equal(o.cssVars['--tkc-username-color'], 'var(--tkc-name-default, #000000)');
});

test('arcoíris: colores luminosos (sin bandas oscuras) y los mismos en el CSS que en el código', async () => {
  const { RAINBOW_STOPS } = await import('./overlayCustomization.js');
  const { readFileSync } = await import('node:fs');
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  // Antes el azul y el violeta (#3b82f6, #a855f7) daban 0.22.
  for (const c of RAINBOW_STOPS) assert.ok(lum(c) >= 0.3, `${c} demasiado oscuro (${lum(c).toFixed(2)})`);
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  const bg = /\[style\*="--tkc-rainbow-bg"\]::before \{[\s\S]*?linear-gradient\(90deg,([^)]*)\)/.exec(css)[1].split(',');
  const text = /\.tkc-username-rainbow \{\s*background-image: linear-gradient\(90deg,([^)]*)\)/.exec(css)[1].split(',');
  const cycle = [...RAINBOW_STOPS, RAINBOW_STOPS[0]];
  assert.deepEqual(text, cycle, 'texto: una vuelta que cierra en el primer tono');
  assert.deepEqual(bg, [...RAINBOW_STOPS, ...RAINBOW_STOPS, RAINBOW_STOPS[0]], 'fondo: dos vueltas seguidas para el bucle');
  assert.ok(!/hue-rotate/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'el texto arcoíris no debe volver a usar hue-rotate (oscurece)');
});
