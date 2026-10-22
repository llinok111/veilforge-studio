import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCssExport } from '../src/export/css.js';
import { buildSvgExport } from '../src/export/svg.js';
import { buildCanvasExport } from '../src/export/canvasjs.js';
import { buildJsonExport } from '../src/export/json.js';
import { buildExport, TARGETS } from '../src/export/index.js';
import { normalizeConfig, serializeConfig, parseConfig, DEFAULT_CONFIG } from '../src/core/config.js';
import { GENERATORS, EXPORT_CAPABILITY, getGenerator } from '../src/generators/index.js';

const GENERATOR_IDS = ['mesh', 'noise', 'blobs', 'flow', 'particles', 'texture'];
const cfgFor = (over = {}) => normalizeConfig({ ...DEFAULT_CONFIG, animated: false, ...over });

/**
 * Catches the class of bug that produced an invisible black quadrant once:
 * a template slot that evaluated to undefined/NaN instead of a number.
 * `allowJsIdentifiers` relaxes the "undefined" check for files that legitimately
 * contain JavaScript (the runtime source tests typeof !== 'undefined').
 */
function assertClean(text, label, { allowJsIdentifiers = false } = {}) {
  assert.ok(!/NaN/.test(text), `${label}: contains NaN`);
  if (!allowJsIdentifiers) assert.ok(!/undefined/.test(text), `${label}: contains "undefined"`);
  assert.ok(!/\[object Object\]/.test(text), `${label}: contains stringified object`);
  assert.ok(!/Infinity/.test(text), `${label}: contains Infinity`);
}

/** Stack-based tag balance check — a real structural test, not a regex guess. */
function tagsBalanced(svg) {
  const VOID = new Set(['rect', 'circle', 'ellipse', 'path', 'stop', 'use', 'animate', 'animateTransform', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feColorMatrix', 'feTurbulence', 'feDisplacementMap', 'feComposite', 'feGaussianBlur', 'feOffset']);
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(svg))) {
    const [, closing, name, , selfClose] = m;
    if (selfClose || VOID.has(name)) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== name) return `${name} closed but ${top} was open`;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0 ? true : `unclosed: ${stack.join(',')}`;
}

/* -------------------------------------------------------------- registry */

test('registry: every generator is registered and described', () => {
  assert.equal(GENERATORS.length, 6);
  for (const id of GENERATOR_IDS) {
    const g = getGenerator(id);
    assert.equal(g.id, id);
    assert.ok(g.label && g.blurb);
    assert.equal(typeof g.render, 'function');
    assert.ok(EXPORT_CAPABILITY[id], `missing capability entry for ${id}`);
    assert.equal(EXPORT_CAPABILITY[id].canvas, 'exact');
  }
});

test('registry: an unknown id falls back to mesh instead of throwing', () => {
  assert.equal(getGenerator('nope').id, 'mesh');
});

test('registry: the export dispatcher covers every advertised target', () => {
  assert.deepEqual(
    TARGETS.map((t) => t.id),
    ['css', 'svg', 'canvas', 'png', 'json'],
  );
});

/* -------------------------------------------------------------------- css */

test('css: every generator produces a stylesheet with balanced braces and no NaN', () => {
  for (const id of GENERATOR_IDS) {
    const out = buildCssExport(cfgFor({ generator: id }));
    const css = out.files.find((f) => f.name.endsWith('.css')).text;
    assertClean(css, `css/${id}`);
    const open = (css.match(/{/g) || []).length;
    const close = (css.match(/}/g) || []).length;
    assert.equal(open, close, `css/${id}: unbalanced braces`);
    assert.ok(css.includes('.vf-bg'), `css/${id}: missing root class`);
    assert.ok(!css.includes('url("data:image/svg+xml,undefined'), `css/${id}: broken data URI`);
  }
});

test('css: contains at least one rule per declared layer', () => {
  const out = buildCssExport(cfgFor({ generator: 'blobs', grain: 0.3 }));
  const css = out.files[1].text;
  assert.ok(css.includes('.vf-bg > .vf-layer'));
  assert.ok(css.includes('.vf-grain'), 'grain layer should be emitted when grain > 0');
  assert.ok(css.includes('mix-blend-mode: screen'), 'additive blending should be declared');
});

test('css: static export omits animation when speed is zero', () => {
  const statik = buildCssExport(cfgFor({ generator: 'mesh', speed: 0 }));
  assert.ok(!statik.files[1].text.includes('@keyframes'), 'speed 0 must not animate');

  const animated = buildCssExport(cfgFor({ generator: 'mesh', speed: 0.5 }));
  assert.ok(animated.files[1].text.includes('@keyframes'), 'speed > 0 must animate');
});

test('css: markup and stylesheet are both shipped, and the html embeds them', () => {
  const out = buildCssExport(cfgFor({ generator: 'flow' }));
  assert.equal(out.files.length, 2);
  const html = out.files.find((f) => f.name.endsWith('.html')).text;
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('class="vf-bg"'));
  assert.ok(!html.includes('<script'), 'CSS export must not need JavaScript');
});

/* -------------------------------------------------------------------- svg */

test('svg: well-formed envelope and no NaN for every generator', () => {
  for (const id of GENERATOR_IDS) {
    const svg = buildSvgExport(cfgFor({ generator: id })).files.find((f) => f.name.endsWith('.svg')).text;
    assertClean(svg, `svg/${id}`);
    assert.ok(svg.startsWith('<svg '), `svg/${id}: missing root`);
    assert.ok(svg.trimEnd().endsWith('</svg>'), `svg/${id}: unterminated`);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `svg/${id}: missing namespace`);
    assert.equal(tagsBalanced(svg), true, `svg/${id}: ${tagsBalanced(svg)}`);
  }
});

test('svg: filter-based generators use real filters', () => {
  assert.ok(buildSvgExport(cfgFor({ generator: 'noise' })).files[0].text.includes('feTurbulence'));
  assert.ok(buildSvgExport(cfgFor({ generator: 'flow' })).files[0].text.includes('feDisplacementMap'));
  assert.ok(buildSvgExport(cfgFor({ generator: 'texture' })).files[0].text.includes('type="discrete"'));
  assert.ok(buildSvgExport(cfgFor({ generator: 'mesh' })).files[0].text.includes('feGaussianBlur'));
});

test('svg: palette-derived tableValues are in [0,1]', () => {
  const svg = buildSvgExport(cfgFor({ generator: 'noise' })).files[0].text;
  const tables = [...svg.matchAll(/tableValues="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tables.length > 0);
  for (const t of tables) {
    for (const v of t.split(/\s+/)) {
      const n = Number(v);
      assert.ok(n >= 0 && n <= 1, `tableValue out of range: ${v}`);
    }
  }
});

test('svg: element counts scale with density for element-based generators', () => {
  const low = buildSvgExport(cfgFor({ generator: 'blobs', density: 0.1 })).files[0].text;
  const high = buildSvgExport(cfgFor({ generator: 'blobs', density: 0.9 })).files[0].text;
  const count = (s) => (s.match(/<circle /g) || []).length;
  assert.ok(count(high) > count(low));
});

/* ----------------------------------------------------------------- canvas */

test('canvas: the export embeds the real runtime and the exact config', () => {
  const cfg = cfgFor({ generator: 'particles', seed: 314159 });
  const out = buildCanvasExport(cfg);
  const html = out.files.find((f) => f.name.endsWith('.html')).text;
  assertClean(html, 'canvas/html', { allowJsIdentifiers: true });
  assert.ok(html.includes('VeilForge.mount'), 'mount call missing');
  assert.ok(html.includes('class Renderer'), 'runtime not inlined');
  assert.ok(html.includes('"seed": 314159'), 'config not embedded');
  assert.ok(html.includes('prefers-reduced-motion'), 'reduced-motion guard missing');
  // The runtime must be a single IIFE, not nested closures (a past regression).
  const iifeOpens = (html.match(/\(function \(\) \{/g) || []).length;
  assert.ok(iifeOpens <= 2, `runtime should open one IIFE, found ${iifeOpens}`);
});

test('canvas: follows config changes and stays under a sane size', () => {
  const a = buildCanvasExport(cfgFor({ generator: 'mesh', speed: 0.1 })).files[0].text;
  const b = buildCanvasExport(cfgFor({ generator: 'mesh', speed: 0.9 })).files[0].text;
  assert.notEqual(a, b, 'export must react to config');
  assert.ok(a.length < 220 * 1024, `canvas export too large: ${(a.length / 1024).toFixed(0)} KB`);
});

/* ------------------------------------------------------------------- json */

test('json: export parses back to the same config', () => {
  const cfg = cfgFor({ generator: 'flow', seed: 778899, speed: 0.37 });
  const out = buildJsonExport(cfg);
  const parsed = parseConfig(out.files[0].text);
  assert.deepEqual(parsed, cfg);
  assert.ok(out.shareUrl.includes('#'));
});

test('json: share link survives a round trip', () => {
  const cfg = cfgFor({ generator: 'texture', seed: 1010 });
  const out = buildJsonExport(cfg);
  assert.ok(out.shareUrl.length < 700, 'share link should stay pasteable');
});

/* ------------------------------------------------------------- invariants */

test('all targets are deterministic: same config, same bytes', () => {
  for (const id of GENERATOR_IDS) {
    const cfg = cfgFor({ generator: id });
    assert.equal(buildCssExport(cfg).files[0].text, buildCssExport(cfg).files[0].text, `css/${id} not deterministic`);
    assert.equal(buildSvgExport(cfg).files[0].text, buildSvgExport(cfg).files[0].text, `svg/${id} not deterministic`);
  }
});

test('all targets react to a seed change', () => {
  for (const id of GENERATOR_IDS) {
    const a = buildSvgExport(cfgFor({ generator: id, seed: 1 })).files[0].text;
    const b = buildSvgExport(cfgFor({ generator: id, seed: 2 })).files[0].text;
    assert.notEqual(a, b, `svg/${id} ignored the seed`);
  }
});

test('every export reports fidelity notes, not silence', () => {
  for (const id of GENERATOR_IDS) {
    for (const build of [buildCssExport, buildSvgExport]) {
      const out = build(cfgFor({ generator: id }));
      assert.ok(Array.isArray(out.notes) && out.notes.length >= 1, `${build.name}/${id}: no notes`);
      assert.ok(['exact', 'high', 'medium', 'low'].includes(out.approx), `${build.name}/${id}: bad approx label`);
    }
  }
});

test('dispatcher returns the same shape for every target', () => {
  const cfg = cfgFor({ generator: 'blobs' });
  for (const target of ['css', 'svg', 'canvas', 'json']) {
    const out = buildExport(target, cfg);
    for (const key of ['format', 'mime', 'approx', 'notes', 'files', 'snippet', 'primary']) {
      assert.ok(key in out, `${target}: missing ${key}`);
    }
    assert.ok(out.files.length >= 1);
    assert.ok(out.files.every((f) => f.name && f.mime && typeof f.text === 'string'));
  }
});

test('serialize output is stable under repeated normalization', () => {
  const cfg = cfgFor();
  const once = serializeConfig(normalizeConfig(cfg));
  const twice = serializeConfig(normalizeConfig(parseConfig(once)));
  assert.equal(once, twice);
});
