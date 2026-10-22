/**
 * Periodic Perlin noise and fBm.
 *
 * Key design choice: the gradient table is indexed mod 256, so noise(x) has a
 * period of exactly 256 units. Sampling a 256×256 texture with uv∈[0,1) mapped
 * to 0..256 therefore tiles seamlessly — and every fBm octave (freq = 2^k) also
 * lands on a multiple of 256, so the whole stack tiles. That lets us precompute
 * one texture and animate by translating/scaling uv instead of re-evaluating
 * noise per pixel per frame, which is the difference between 4 ms and 40 ms a
 * frame at 1080p.
 */

import { mulberry32 } from './rng.js';

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Seeded 512-entry permutation table. */
export function buildPerm(seed) {
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function gradDot(perm, ix, iy, dx, dy) {
  const g = GRAD2[perm[(perm[ix] + iy) & 255] & 7];
  return g[0] * dx + g[1] * dy;
}

/**
 * 2D Perlin noise with an explicit period (power of two, <= 256).
 * Indexing `& (period - 1)` is what makes the field tile exactly: x = 0 and
 * x = period resolve to the same lattice point.
 */
export function perlin2(perm, x, y, period = 256) {
  const m = period - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = fade(xf);
  const v = fade(yf);

  const xi0 = x0 & m;
  const yi0 = y0 & m;
  const xi1 = (x0 + 1) & m;
  const yi1 = (y0 + 1) & m;

  const n00 = gradDot(perm, xi0, yi0, xf, yf);
  const n10 = gradDot(perm, xi1, yi0, xf - 1, yf);
  const n01 = gradDot(perm, xi0, yi1, xf, yf - 1);
  const n11 = gradDot(perm, xi1, yi1, xf - 1, yf - 1);

  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.4142;
}

/**
 * Fractal Brownian motion in *cell* coordinates.
 * Each octave doubles both the coordinate and the period, so the stack stays
 * seamless; the low base period is what makes the field read as cloud rather
 * than television static.
 */
export function fbm2(perm, x, y, octaves = 4, basePeriod = 4, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += perlin2(perm, fx, fy, Math.min(256, period)) * amp;
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
    period *= 2;
  }
  return sum / norm;
}

/** Ridged variant - produces the filing/cabinet striations `texture` uses. */
export function ridged2(perm, x, y, octaves = 4, basePeriod = 4, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin2(perm, fx, fy, Math.min(256, period)));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
    period *= 2;
  }
  return sum / norm;
}

/**
 * Precomputed tileable fBm field.
 * `data` is Float32 in [0,1], row-major, size×size.
 */
export class NoiseField {
  constructor(seed, { size = 256, octaves = 5, gain = 0.5, ridged = false, period = 4 } = {}) {
    this.size = size;
    this.octaves = octaves;
    this.ridged = ridged;
    this.period = period;
    const perm = buildPerm(seed);
    const data = new Float32Array(size * size);
    const step = 1 / size;
    for (let y = 0; y < size; y++) {
      const cy = (y * step) * period;
      for (let x = 0; x < size; x++) {
        const cx = (x * step) * period;
        const n = ridged
          ? ridged2(perm, cx, cy, octaves, period, gain)
          : (fbm2(perm, cx, cy, octaves, period, gain) + 1) * 0.5;
        data[y * size + x] = n;
      }
    }
    this.data = data;
  }

  /** Bilinear sample with wrap. uv may be any real number. */
  sample(u, v) {
    const { size, data } = this;
    let sx = u * size;
    let sy = v * size;
    let x0 = Math.floor(sx);
    let y0 = Math.floor(sy);
    const fx = sx - x0;
    const fy = sy - y0;
    x0 = ((x0 % size) + size) % size;
    y0 = ((y0 % size) + size) % size;
    const x1 = (x0 + 1) % size;
    const y1 = (y0 + 1) % size;

    const a = data[y0 * size + x0];
    const b = data[y0 * size + x1];
    const c = data[y1 * size + x0];
    const d = data[y1 * size + x1];

    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }
}

const fieldCache = new Map();

/** Cached NoiseField per (seed, octaves, ridged). Building 256² × 5 octaves costs ~12 ms. */
export function getNoiseField(seed, octaves = 5, ridged = false) {
  const key = `${seed}:${octaves}:${ridged ? 'r' : 'f'}`;
  let f = fieldCache.get(key);
  if (!f) {
    f = new NoiseField(seed, { octaves, ridged });
    if (fieldCache.size > 12) fieldCache.clear();
    fieldCache.set(key, f);
  }
  return f;
}
