/**
 * Deterministic pseudo-random utilities.
 *
 * Every visual in VeilForge is a pure function of (config, time). No Math.random
 * is ever used in a render path: the same seed must always produce the same
 * frame, otherwise exported CSS/SVG/Canvas cannot be verified against the
 * live preview.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit hash of a string. Stable across engines. */
export function hashString(str) {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Hash any tuple of primitives into a 32-bit seed. */
export function hashSeed(...parts) {
  return hashString(parts.map((p) => String(p)).join(':'));
}

/** mulberry32 — small, fast, good enough distribution for visual jitter. */
export function mulberry32(a) {
  let s = a >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seedable RNG facade with the helpers the generators actually need.
 * All methods draw from the same stream, so call order matters — keep it stable.
 */
export function makeRng(seed) {
  const next = mulberry32(seed >>> 0);
  const rng = {
    next,
    /** Uniform float in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** Uniform integer in [min, max] inclusive. */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    /** Random element of an array. */
    pick(arr) {
      return arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))];
    },
    /** -1 or +1. */
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    /** Standard normal (Box–Muller). */
    gauss() {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Reset to a fresh stream with a derived seed. */
    fork(salt) {
      return makeRng(hashSeed(seed, salt));
    },
  };
  return rng;
}

/** A fresh RNG for one generator at one config — identical input, identical layout. */
export function rngFor(config, generatorId) {
  return makeRng(hashSeed(config.seed, generatorId, config.palette.join(''), config.density.toFixed(3)));
}
