/**
 * Shared layout: the single source of truth for *where things are*.
 *
 * Every export target must place the same anchors, blobs and motes as the canvas
 * renderer. The only honest way to guarantee that is to compute the layout once,
 * from one seeded RNG stream, and have the renderer and all four exporters read
 * it. Duplicating "rng.range(...) ×6" in the CSS builder is how you end up with an
 * export that is tonally right and structurally unrelated.
 *
 * Call order inside each layout function is therefore part of the contract: the
 * stream is sequential, so reordering two draws changes every value after them.
 */

import { makeRng, hashSeed } from '../core/rng.js';
import { TAU } from '../core/color.js';

/* ------------------------------------------------------------------- mesh */

export function meshLayout(cfg) {
  const n = 2 + Math.round(cfg.density * 3);
  const cells = n - 1;
  const rng = makeRng(hashSeed(cfg.seed, 'mesh', n));
  const nodes = [];
  for (let i = 0; i < n * n; i++) {
    const gx = i % n;
    const gy = (i / n) | 0;
    const base = (gx + gy) / (cells * 2);
    const jitter = rng.range(-0.14, 0.14);
    const phase = rng.range(0, TAU);
    nodes.push({
      gx,
      gy,
      x: gx / cells,
      y: gy / cells,
      // Clamped: an out-of-range ramp sample would read past the LUT.
      t: Math.min(1, Math.max(0, base + jitter)),
      phase,
    });
  }
  return {
    n,
    cells,
    nodes,
    freq: 1.1 / Math.max(0.4, cfg.scale),
    warp: 0.03 + cfg.intensity * 0.13,
    drift: 0.035,
  };
}

/* ------------------------------------------------------------------ blobs */

export function blobLayout(cfg) {
  const count = 4 + Math.round(cfg.density * 18);
  const rng = makeRng(hashSeed(cfg.seed, 'blobs', count));
  const out = [];
  for (let i = 0; i < count; i++) {
    const bx = rng.range(0.05, 0.95);
    const by = rng.range(0.05, 0.95);
    const phase = rng.range(0, TAU);
    const orbit = rng.range(0.35, 1);
    const pulseSpeed = rng.range(0.35, 1.1);
    const radius = rng.range(0.16, 0.46);
    const colorIdx = 1 + Math.floor(rng.next() * 4);
    const alpha = 0.34 + rng.next() * 0.44;
    const coreRand = rng.next();
    const coreScale = coreRand > 0.45 ? rng.range(0.06, 0.16) : 0;
    out.push({ bx, by, phase, orbit, pulseSpeed, radius, colorIdx, alpha, coreScale });
  }
  return { count, items: out };
}

/* -------------------------------------------------------------- particles */

export function particleLayout(cfg) {
  const count = 24 + Math.round(cfg.density * 280);
  const rng = makeRng(hashSeed(cfg.seed, 'particles', count));
  const dir = (cfg.direction * Math.PI) / 180;
  const drift = 0.055 * (0.35 + cfg.intensity);
  const out = [];
  for (let i = 0; i < count; i++) {
    const bx = rng.range(0, 1);
    const by = rng.range(0, 1);
    const ang = dir + rng.range(-0.55, 0.55);
    const spd = drift * rng.range(0.35, 1.6);
    const size = 0.8 + rng.next() * rng.next() * 3.6;
    const colorIdx = 1 + Math.floor(rng.next() * 4);
    const wobble = rng.range(0, TAU);
    const wobbleAmp = rng.range(0.002, 0.012) * (0.3 + cfg.intensity);
    out.push({ bx, by, ang, spd, size, colorIdx, wobble, wobbleAmp });
  }
  return { count, items: out, drift };
}

/* ------------------------------------------------------------------ field */

export function noiseParams(cfg) {
  return {
    freq: 0.95 / Math.max(0.4, cfg.scale),
    secondFreq: 0.95 / Math.max(0.4, cfg.scale) * 1.72,
    octaves: Math.max(2, Math.min(5, 2 + Math.round(cfg.density * 4))),
    gamma: 1.55 - cfg.intensity * 0.95,
    mid: 0.5 - (cfg.intensity - 0.5) * 0.22,
    drift: 0.045,
  };
}

export function flowParams(cfg) {
  return {
    freq: 1.7 / Math.max(0.4, cfg.scale),
    detailFreq: (1.7 / Math.max(0.4, cfg.scale)) * 1.28,
    bands: 1 + cfg.density * 4.5,
    warp: 0.35 + cfg.intensity * 1.15,
  };
}

export function textureParams(cfg) {
  return {
    freq: 1.05 / Math.max(0.4, cfg.scale),
    stretch: 3.1,
    strata: 3 + cfg.density * 11,
    contrast: 0.4 + cfg.intensity * 1.6,
  };
}

/** Colour for a palette index, clamped — exporters and renderers share this. */
export function paletteRgbAt(cfg, idx) {
  const list = cfg.palette;
  const i = Math.min(list.length - 1, Math.max(0, idx));
  const hex = list[i].replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
