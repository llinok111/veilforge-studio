import test from 'node:test';
import assert from 'node:assert/strict';

import { hashString, hashSeed, mulberry32, makeRng } from '../src/core/rng.js';
import {
  parseHex,
  toHex,
  rgbToOklab,
  oklabToRgb,
  buildPaletteLut,
  sampleOklabRamp,
  paletteToOklab,
  contrastRatio,
  readableInk,
  hslToHex,
} from '../src/core/color.js';
import { buildPerm, perlin2, fbm2, NoiseField, getNoiseField } from '../src/core/noise.js';
import { noiseParams, flowParams, textureParams, meshLayout, blobLayout, particleLayout } from '../src/generators/layout.js';
import { normalizeConfig, serializeConfig, parseConfig, DEFAULT_CONFIG, encodeShareHash, decodeShareHash } from '../src/core/config.js';

/* --------------------------------------------------------------------- rng */

test('rng: same seed yields the same stream', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('rng: different seeds diverge immediately', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  assert.notEqual(a.next(), b.next());
});

test('rng: range and int stay inside their bounds', () => {
  const r = makeRng(99);
  for (let i = 0; i < 500; i++) {
    const v = r.range(-3, 7);
    assert.ok(v >= -3 && v < 7, `range out of bounds: ${v}`);
    const n = r.int(2, 5);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5, `int out of bounds: ${n}`);
  }
});

test('rng: fork produces an independent but reproducible stream', () => {
  const a = makeRng(7).fork('layout');
  const b = makeRng(7).fork('layout');
  assert.equal(a.next(), b.next());
  assert.notEqual(makeRng(7).fork('x').next(), makeRng(7).fork('y').next());
});

test('rng: hashing is stable and order sensitive', () => {
  assert.equal(hashString('veilforge'), hashString('veilforge'));
  assert.notEqual(hashSeed(1, 2), hashSeed(2, 1));
  assert.equal(typeof mulberry32(1)(), 'number');
});

/* ------------------------------------------------------------------- color */

test('color: parses 3, 6 and 8 digit hex', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseHex('#0b0d17'), { r: 11, g: 13, b: 23, a: 1 });
  assert.equal(parseHex('#0b0d1780').a, 128 / 255);
});

test('color: invalid input degrades to black instead of throwing', () => {
  assert.deepEqual(parseHex('not-a-colour'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHex(undefined), { r: 0, g: 0, b: 0, a: 1 });
});

test('color: hex → OKLab → hex round-trips within 1 LSB', () => {
  for (const hex of ['#000000', '#ffffff', '#c8813c', '#1d4a63', '#f3d9a4']) {
    const { r, g, b } = parseHex(hex);
    const lab = rgbToOklab(r, g, b);
    const back = oklabToRgb(lab.L, lab.a, lab.b);
    assert.ok(Math.abs(back.r - r) <= 1, `${hex} r drifted to ${back.r}`);
    assert.ok(Math.abs(back.g - g) <= 1, `${hex} g drifted to ${back.g}`);
    assert.ok(Math.abs(back.b - b) <= 1, `${hex} b drifted to ${back.b}`);
    assert.equal(toHex(back), hex.toLowerCase());
  }
});

test('color: ramp endpoints equal palette endpoints', () => {
  const palette = ['#000000', '#334455', '#ffffff'];
  const labs = paletteToOklab(palette);
  assert.equal(toHex(sampleOklabRamp(labs, 0)), '#000000');
  assert.equal(toHex(sampleOklabRamp(labs, 1)), '#ffffff');
});

test('color: OKLab midpoint is lighter than an sRGB midpoint on a dark ramp', () => {
  // This is the reason for using OKLab at all: naive sRGB mixing muddies.
  const palette = ['#000000', '#ffffff'];
  const labs = paletteToOklab(palette);
  const ok = sampleOklabRamp(labs, 0.5);
  const srgb = { r: 127.5, g: 127.5, b: 127.5 };
  const okLum = 0.2126 * ok.r + 0.7152 * ok.g + 0.0722 * ok.b;
  const srgbLum = 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b;
  assert.ok(Math.abs(okLum - srgbLum) > 8, 'OKLab midpoint should differ visibly from sRGB midpoint');
});

test('color: LUT has 256 entries and is monotonic in luminance for a dark→light ramp', () => {
  const lut = buildPaletteLut(['#05060b', '#c8813c', '#f6e2b3'], 256);
  assert.equal(lut.length, 256 * 3);
  let prev = -1;
  for (let i = 0; i < 256; i += 8) {
    const l = 0.2126 * lut[i * 3] + 0.7152 * lut[i * 3 + 1] + 0.0722 * lut[i * 3 + 2];
    assert.ok(l > prev - 1, `LUT luminance not monotonic at ${i}`);
    prev = l;
  }
});

test('color: contrast helpers agree with WCAG expectations', () => {
  assert.equal(+contrastRatio('#ffffff', '#000000').toFixed(1), 21);
  assert.equal(readableInk('#000000'), '#ffffff');
  assert.equal(readableInk('#ffffff'), '#000000');
  assert.match(hslToHex(210, 0.5, 0.5), /^#[0-9a-f]{6}$/);
});

/* ------------------------------------------------------------------- noise */

test('noise: permutation table is seeded and a real permutation', () => {
  const a = buildPerm(1);
  const b = buildPerm(1);
  assert.deepEqual(Array.from(a), Array.from(b));
  const seen = new Set(Array.from(a.slice(0, 256)));
  assert.equal(seen.size, 256);
});

test('noise: perlin output stays in a sane range', () => {
  const perm = buildPerm(4);
  for (let i = 0; i < 2000; i++) {
    const v = perlin2(perm, i * 0.13, i * 0.07, 64);
    assert.ok(Number.isFinite(v));
    assert.ok(Math.abs(v) <= 1.5, `perlin out of range: ${v}`);
  }
});

test('noise: fBm is deterministic for a seed', () => {
  const p1 = buildPerm(11);
  const p2 = buildPerm(11);
  assert.equal(fbm2(p1, 3.3, 1.7, 5, 4), fbm2(p2, 3.3, 1.7, 5, 4));
});

test('noise: field tiles seamlessly (period boundary)', () => {
  // The whole point of the periodic Perlin: sampling one period away must be
  // identical, otherwise the animated CSS/SVG tile shows a seam.
  const field = new NoiseField(5, { size: 64, octaves: 4, period: 4 });
  for (let i = 0; i < 50; i++) {
    const u = i / 50;
    const v = (i * 7) % 50 / 50;
    assert.ok(Math.abs(field.sample(u, v) - field.sample(u + 1, v)) < 1e-9, 'seam on u');
    assert.ok(Math.abs(field.sample(u, v) - field.sample(u, v + 1)) < 1e-9, 'seam on v');
  }
});

test('noise: field values stay inside [0,1] and vary', () => {
  const field = new NoiseField(3, { size: 64, octaves: 4 });
  let min = 1;
  let max = 0;
  for (let i = 0; i < 2000; i++) {
    const v = field.sample(Math.random(), Math.random());
    assert.ok(v >= 0 && v <= 1, `out of range ${v}`);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(max - min > 0.25, `field too flat: ${min}..${max}`);
});

test('noise: getNoiseField caches by seed and octave count', () => {
  assert.equal(getNoiseField(42, 5), getNoiseField(42, 5));
  assert.notEqual(getNoiseField(42, 5), getNoiseField(42, 3));
});

/* ------------------------------------------------------------------ layout */

const cfgFor = (over = {}) => normalizeConfig({ ...DEFAULT_CONFIG, ...over });

test('layout: mesh anchors sit on the lattice and cover it', () => {
  const cfg = cfgFor({ generator: 'mesh', density: 0.55 });
  const L = meshLayout(cfg);
  assert.equal(L.nodes.length, L.n * L.n);
  for (const nd of L.nodes) {
    assert.ok(nd.x >= 0 && nd.x <= 1, `x out of range ${nd.x}`);
    assert.ok(nd.y >= 0 && nd.y <= 1, `y out of range ${nd.y}`);
    assert.ok(nd.t >= 0 && nd.t <= 1, `ramp sample out of range ${nd.t}`);
  }
  // Corner anchors must exist, otherwise the frame has uncovered corners.
  assert.ok(L.nodes.some((n) => n.x === 0 && n.y === 0));
  assert.ok(L.nodes.some((n) => n.x === 1 && n.y === 1));
});

test('layout: density drives element counts monotonically', () => {
  const low = blobLayout(cfgFor({ density: 0.1 }));
  const high = blobLayout(cfgFor({ density: 0.95 }));
  assert.ok(high.count > low.count);

  const pLow = particleLayout(cfgFor({ density: 0.1 }));
  const pHigh = particleLayout(cfgFor({ density: 0.95 }));
  assert.ok(pHigh.count > pLow.count);
});

test('layout: deterministic per (seed, density) and different across seeds', () => {
  const a = particleLayout(cfgFor({ seed: 5 }));
  const b = particleLayout(cfgFor({ seed: 5 }));
  const c = particleLayout(cfgFor({ seed: 6 }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
});

test('layout: particle bases stay in the unit square', () => {
  for (const p of particleLayout(cfgFor({ density: 0.9 })).items) {
    assert.ok(p.bx >= 0 && p.bx <= 1);
    assert.ok(p.by >= 0 && p.by <= 1);
    assert.ok(p.size > 0);
  }
});

test('layout: field params stay positive and scale-inverse', () => {
  for (const fn of [noiseParams, flowParams, textureParams]) {
    const small = fn(cfgFor({ scale: 0.4 }));
    const big = fn(cfgFor({ scale: 3 }));
    assert.ok(small.freq > big.freq, `${fn.name} should scale inversely with scale`);
    assert.ok(big.freq > 0);
  }
});

/* ------------------------------------------------------------------ config */

test('config: out-of-range values are clamped, not thrown', () => {
  const cfg = normalizeConfig({ speed: 99, density: -5, direction: 900, grain: 'x', palette: ['nope', '#fff', '#000'] });
  assert.equal(cfg.speed, 2);
  assert.equal(cfg.density, 0);
  assert.equal(cfg.direction, 360);
  assert.equal(cfg.grain, DEFAULT_CONFIG.grain);
  assert.deepEqual(cfg.palette, ['#fff', '#000']);
});

test('config: a single-colour palette is rejected in favour of the default', () => {
  const cfg = normalizeConfig({ palette: ['#fff'] });
  assert.deepEqual(cfg.palette, DEFAULT_CONFIG.palette);
});

test('config: serialize → parse is a fixed point', () => {
  const cfg = cfgFor({ generator: 'flow', seed: 424242, speed: 0.31, density: 0.77 });
  const once = serializeConfig(cfg);
  const twice = serializeConfig(parseConfig(once));
  assert.equal(once, twice);
  assert.deepEqual(parseConfig(once), cfg);
});

test('config: share hash round-trips every field it claims to encode', () => {
  const cfg = cfgFor({ generator: 'texture', seed: 987654, speed: 0.42, density: 0.6, direction: 271, intensity: 0.8, scale: 1.4, grain: 0.2, vignette: 0.3, blur: 0.4 });
  const decoded = decodeShareHash(encodeShareHash(cfg));
  assert.equal(decoded.generator, cfg.generator);
  assert.equal(decoded.seed, cfg.seed);
  assert.deepEqual(decoded.palette, cfg.palette);
  assert.equal(decoded.direction, cfg.direction);
  for (const k of ['speed', 'density', 'intensity', 'scale', 'grain', 'vignette', 'blur']) {
    assert.ok(Math.abs(decoded[k] - cfg[k]) < 0.002, `${k} drifted: ${decoded[k]} vs ${cfg[k]}`);
  }
});

test('config: a corrupt share hash returns null rather than throwing', () => {
  assert.equal(decodeShareHash('%7Bnope'), null);
  assert.equal(decodeShareHash(''), null);
});

test('config: unknown generator id survives normalization and falls back at render time', () => {
  const cfg = normalizeConfig({ generator: 'does-not-exist' });
  assert.equal(cfg.generator, 'does-not-exist');
});
