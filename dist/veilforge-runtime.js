/*! VeilForge runtime — generated from src/ by tools/gen-runtime.mjs. Do not edit. */
(function () {
'use strict';
/* ---- src/core/config.js ---- */
/**
 * Configuration schema: defaults, validation, clamping and migration.
 *
 * A config is the single source of truth for every export target. Any value that
 * reaches a generator has already passed through `normalizeConfig`, so
 * generators can trust ranges and never need defensive checks.
 */

const CONFIG_VERSION = 1;

/** The five knobs the brief asks for, plus the visual extras. */
const SLIDERS = {
  speed: { min: 0, max: 2, step: 0.01, label: 'Speed', hint: '0 freezes the frame' },
  density: { min: 0, max: 1, step: 0.01, label: 'Density', hint: 'Element count / detail' },
  direction: { min: 0, max: 360, step: 1, label: 'Direction', hint: 'Degrees, 0 = →' },
  intensity: { min: 0, max: 1, step: 0.01, label: 'Intensity', hint: 'Effect strength' },
  scale: { min: 0.4, max: 3, step: 0.01, label: 'Scale', hint: 'Feature size' },
  grain: { min: 0, max: 1, step: 0.01, label: 'Grain', hint: 'Film grain overlay' },
  vignette: { min: 0, max: 1, step: 0.01, label: 'Vignette', hint: 'Corner falloff' },
  blur: { min: 0, max: 1, step: 0.01, label: 'Softness', hint: 'Edge diffusion' },
};

const ASPECTS = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '21:9': 21 / 9,
};

const QUALITY = {
  low: 0.45,
  medium: 0.62,
  high: 0.8,
  ultra: 1,
  auto: 0,
};

const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  generator: 'mesh',
  seed: 20261022,
  palette: ['#0b0d17', '#2b1d4e', '#7d3f8c', '#d98a5b', '#f6e2b3'],
  background: '#05060b',
  speed: 0.45,
  density: 0.55,
  direction: 135,
  intensity: 0.7,
  scale: 1,
  grain: 0.22,
  vignette: 0.3,
  blur: 0.32,
  animated: true,
  aspect: '16:9',
  quality: 'auto',
  // Per-generator overrides, keyed by generator id. Empty = use global sliders.
  overrides: {},
});

const NUMERIC_KEYS = Object.keys(SLIDERS);

function isHex(v) {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Coerce anything into a valid config. Never throws: unknown generators fall
 * back to `mesh`, bad hex values to the default palette.
 */
function normalizeConfig(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULT_CONFIG };

  if (typeof raw.generator === 'string') out.generator = raw.generator;
  out.seed = Math.abs(Math.trunc(clampNum(raw.seed, 0, 2 ** 31, DEFAULT_CONFIG.seed))) || 1;

  if (Array.isArray(raw.palette)) {
    const cleaned = raw.palette.filter(isHex).slice(0, 6);
    if (cleaned.length >= 2) out.palette = cleaned;
  }
  if (isHex(raw.background)) out.background = raw.background;

  for (const key of NUMERIC_KEYS) {
    const spec = SLIDERS[key];
    out[key] = clampNum(raw[key], spec.min, spec.max, DEFAULT_CONFIG[key]);
  }

  out.animated = raw.animated !== false;
  if (typeof raw.aspect === 'string' && ASPECTS[raw.aspect]) out.aspect = raw.aspect;
  if (typeof raw.quality === 'string' && raw.quality in QUALITY) out.quality = raw.quality;

  if (raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides)) {
    const ov = {};
    for (const [gen, vals] of Object.entries(raw.overrides)) {
      if (!vals || typeof vals !== 'object') continue;
      const clean = {};
      for (const key of NUMERIC_KEYS) {
        if (vals[key] === undefined) continue;
        const spec = SLIDERS[key];
        clean[key] = clampNum(vals[key], spec.min, spec.max, DEFAULT_CONFIG[key]);
      }
      if (Object.keys(clean).length) ov[gen] = clean;
    }
    out.overrides = ov;
  }

  out.version = CONFIG_VERSION;
  return out;
}

/** Apply per-generator overrides on top of the global config. */
function effectiveConfig(config) {
  const ov = config.overrides?.[config.generator];
  if (!ov) return config;
  return { ...config, ...ov };
}

/** Serialise to a stable, human-diffable JSON string (2-space, sorted-ish keys). */
function serializeConfig(config) {
  const c = normalizeConfig(config);
  const ordered = {
    version: c.version,
    generator: c.generator,
    seed: c.seed,
    palette: c.palette,
    background: c.background,
    speed: c.speed,
    density: c.density,
    direction: c.direction,
    intensity: c.intensity,
    scale: c.scale,
    grain: c.grain,
    vignette: c.vignette,
    blur: c.blur,
    animated: c.animated,
    aspect: c.aspect,
    quality: c.quality,
    overrides: c.overrides,
  };
  return JSON.stringify(ordered, null, 2);
}

function parseConfig(text) {
  const data = JSON.parse(text);
  return normalizeConfig(data);
}

/** Compact string for URL hashes: base36 seed keeps links short. */
function encodeShareHash(config) {
  const c = normalizeConfig(config);
  const payload = {
    g: c.generator,
    s: c.seed.toString(36),
    p: c.palette,
    b: c.background,
    // Direction is in degrees, everything else is 0..2; scaling all of them by
    // 1000 keeps the payload fixed-width and integer-only.
    v: [c.speed, c.density, c.direction, c.intensity, c.scale, c.grain, c.vignette, c.blur].map(
      (n) => Math.round(n * 1000),
    ),
    a: c.aspect,
  };
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeShareHash(hash) {
  try {
    const payload = JSON.parse(decodeURIComponent(String(hash || '').replace(/^#/, '')));
    if (!payload || typeof payload !== 'object') return null;
    const [speed, density, direction, intensity, scale, grain, vignette, blur] = payload.v || [];
    return normalizeConfig({
      generator: payload.g,
      seed: parseInt(payload.s, 36),
      palette: payload.p,
      background: payload.b,
      speed: speed / 1000,
      density: density / 1000,
      direction: direction / 1000,
      intensity: intensity / 1000,
      scale: scale / 1000,
      grain: grain / 1000,
      vignette: vignette / 1000,
      blur: blur / 1000,
      aspect: payload.a,
    });
  } catch {
    return null;
  }
}

/** Structural diff, used by the exporter to tell the user what changed. */
function diffConfig(a, b) {
  const out = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const av = JSON.stringify(a[key]);
    const bv = JSON.stringify(b[key]);
    if (av !== bv) out[key] = { from: a[key], to: b[key] };
  }
  return out;
}

/* ---- src/core/color.js ---- */
/**
 * Colour maths.
 *
 * Gradient interpolation happens in OKLab rather than sRGB: naive sRGB mixing
 * produces the grey/muddy midpoint that makes generated backgrounds look cheap.
 * OKLab keeps perceptual lightness and chroma stable across a blend, which is
 * the difference between "AI product hero" and "1998 WordArt".
 */

const D2R = Math.PI / 180;

function clamp(v, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Parse #rgb / #rrggbb / #rrggbbaa into {r,g,b,a} with 0-255 channels. */
function parseHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

function toHex({ r, g, b }) {
  const f = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
}

/** sRGB(0-255) → OKLab {L,a,b}. */
function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** OKLab → sRGB(0-255). Channels are clamped; out-of-gamut colours desaturate. */
function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(bb) };
}

/** Convert a palette of hex strings into OKLab triples. */
function paletteToOklab(palette) {
  return palette.map((hex) => {
    const { r, g, b } = parseHex(hex);
    return rgbToOklab(r, g, b);
  });
}

/** Sample an OKLab ramp at t∈[0,1]; returns sRGB 0-255. */
function sampleOklabRamp(labs, t) {
  if (labs.length === 0) return { r: 0, g: 0, b: 0 };
  if (labs.length === 1) return oklabToRgb(labs[0].L, labs[0].a, labs[0].b);
  const x = clamp(t) * (labs.length - 1);
  const i = Math.min(labs.length - 2, Math.floor(x));
  const f = x - i;
  const A = labs[i];
  const B = labs[i + 1];
  return oklabToRgb(lerp(A.L, B.L, f), lerp(A.a, B.a, f), lerp(A.b, B.b, f));
}

/**
 * Build a 256-entry RGB lookup table from a palette.
 * Per-pixel code indexes this instead of doing colour maths 200k times a frame.
 */
function buildPaletteLut(palette, size = 256) {
  const labs = paletteToOklab(palette);
  const lut = new Uint8ClampedArray(size * 3);
  for (let i = 0; i < size; i++) {
    const c = sampleOklabRamp(labs, i / (size - 1));
    lut[i * 3] = c.r;
    lut[i * 3 + 1] = c.g;
    lut[i * 3 + 2] = c.b;
  }
  return lut;
}

/** CSS gradient stops from a palette (OKLab-sampled, so midpoints stay clean). */
function cssRampStops(palette, steps = 7) {
  const labs = paletteToOklab(palette);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = sampleOklabRamp(labs, t);
    out.push(`${i === 0 ? '' : ''}${toHex(c)} ${(t * 100).toFixed(2)}%`);
  }
  return out.join(', ');
}

/** WCAG relative luminance, used by the contrast self-check in the UI. */
function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black or white text for a background, whichever contrasts more. */
function readableInk(hex) {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}

function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rgb;
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return toHex({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 });
}

const TAU = Math.PI * 2;
const DEG = D2R;

/* ---- src/core/rng.js ---- */
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
function hashString(str) {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Hash any tuple of primitives into a 32-bit seed. */
function hashSeed(...parts) {
  return hashString(parts.map((p) => String(p)).join(':'));
}

/** mulberry32 — small, fast, good enough distribution for visual jitter. */
function mulberry32(a) {
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
function makeRng(seed) {
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
function rngFor(config, generatorId) {
  return makeRng(hashSeed(config.seed, generatorId, config.palette.join(''), config.density.toFixed(3)));
}

/* ---- src/core/noise.js ---- */
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



const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Seeded 512-entry permutation table. */
function buildPerm(seed) {
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
function perlin2(perm, x, y, period = 256) {
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
function fbm2(perm, x, y, octaves = 4, basePeriod = 4, gain = 0.5) {
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
function ridged2(perm, x, y, octaves = 4, basePeriod = 4, gain = 0.5) {
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
class NoiseField {
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
function getNoiseField(seed, octaves = 5, ridged = false) {
  const key = `${seed}:${octaves}:${ridged ? 'r' : 'f'}`;
  let f = fieldCache.get(key);
  if (!f) {
    f = new NoiseField(seed, { octaves, ridged });
    if (fieldCache.size > 12) fieldCache.clear();
    fieldCache.set(key, f);
  }
  return f;
}

/* ---- src/engine/field.js ---- */
/**
 * Low-resolution field buffers.
 *
 * Per-pixel generators (noise, flow, mesh, texture) would cost 20-60 ms a frame
 * if they wrote every device pixel. Instead they paint a small buffer and let the
 * GPU-composited `drawImage` upscale it. That is also visually correct here:
 * backgrounds want soft gradients, not crisp pixels.
 */

function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

class FieldBuffer {
  constructor() {
    this.canvas = createCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.image = this.ctx.createImageData(1, 1);
  }

  /** Resize if needed. ImageData is only reallocated on size change. */
  ensure(w, h) {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      this.image = this.ctx.createImageData(W, H);
    }
    this.w = W;
    this.h = H;
    return this;
  }

  /**
   * Fill the buffer with `fn(u, v, out)` where out is a 4-slot array.
   * Writing through a single reused array avoids 4 allocations per pixel.
   */
  paint(fn) {
    const { w, h, image } = this;
    const data = image.data;
    const out = [0, 0, 0, 255];
    let i = 0;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++, i += 4) {
        const u = (x + 0.5) / w;
        out[3] = 255;
        fn(u, v, out);
        data[i] = out[0];
        data[i + 1] = out[1];
        data[i + 2] = out[2];
        data[i + 3] = out[3];
      }
    }
    this.ctx.putImageData(image, 0, 0);
    return this.canvas;
  }

  /** Composite the buffer onto a target context, scaled to fill it. */
  blit(ctx, dw, dh, smooth = true) {
    ctx.save();
    ctx.imageSmoothingEnabled = smooth;
    if (smooth && 'imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, 0, 0, this.w, this.h, 0, 0, dw, dh);
    ctx.restore();
  }
}

/** Small radial-gradient sprite cache (blob glows, particle halos). */
const spriteCache = new Map();

function getGlowSprite(rgb, size = 64, softness = 0.5) {
  const key = `${rgb.join(',')}:${size}:${softness}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  const [R, G, B] = rgb;
  const inner = Math.max(0.001, 1 - softness);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`);
  g.addColorStop(inner * 0.35, `rgba(${R},${G},${B},0.55)`);
  g.addColorStop(inner, `rgba(${R},${G},${B},0.14)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  if (spriteCache.size > 64) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}

/**
 * Seeded grain tile: a balanced black/white speckle with per-pixel alpha.
 *
 * Opaque grey noise composited with `overlay` looks marginally better, but it
 * forces a full-frame blend that dominates the frame budget in software raster.
 * A transparent speckle drawn with `source-over` is ~10× cheaper and reads the
 * same at background amplitudes.
 */
let grainTile = null;
let grainSeed = -1;

function getGrainTile(seed, size = 128) {
  if (grainTile && grainSeed === seed) return grainTile;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0 || 1;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // xorshift32 — cheaper than a full PRNG in a 64k-pixel loop
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const v = (s >>> 0) & 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  grainSeed = seed;
  return c;
}

/* ---- src/generators/layout.js ---- */
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




/* ------------------------------------------------------------------- mesh */

function meshLayout(cfg) {
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

function blobLayout(cfg) {
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

function particleLayout(cfg) {
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

function noiseParams(cfg) {
  return {
    freq: 0.95 / Math.max(0.4, cfg.scale),
    secondFreq: 0.95 / Math.max(0.4, cfg.scale) * 1.72,
    octaves: Math.max(2, Math.min(5, 2 + Math.round(cfg.density * 4))),
    gamma: 1.55 - cfg.intensity * 0.95,
    mid: 0.5 - (cfg.intensity - 0.5) * 0.22,
    drift: 0.045,
  };
}

function flowParams(cfg) {
  return {
    freq: 1.7 / Math.max(0.4, cfg.scale),
    detailFreq: (1.7 / Math.max(0.4, cfg.scale)) * 1.28,
    bands: 1 + cfg.density * 4.5,
    warp: 0.35 + cfg.intensity * 1.15,
  };
}

function textureParams(cfg) {
  return {
    freq: 1.05 / Math.max(0.4, cfg.scale),
    stretch: 3.1,
    strata: 3 + cfg.density * 11,
    contrast: 0.4 + cfg.intensity * 1.6,
  };
}

/** Colour for a palette index, clamped — exporters and renderers share this. */
function paletteRgbAt(cfg, idx) {
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

/* ---- src/generators/mesh.js ---- */
/**
 * Mesh gradient.
 *
 * A coarse lattice of colour anchors sampled from the palette, evaluated with
 * smoothstep-weighted bilinear interpolation and then domain-warped by a noise
 * field. The warp is what stops it reading as "four squares of colour": it makes
 * the anchor boundaries curve like light through frosted glass.
 *
 * Anchor positions, ramp samples and drift phases come from `meshLayout`, which
 * the CSS and SVG exporters read too — so an exported mesh gradient is anchored
 * to the same lattice, not to a similarly-sized random one.
 */



const mesh = {
  id: 'mesh',
  label: 'Mesh gradient',
  blurb: 'Bicubic lattice of colour anchors, domain-warped and drifting.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const { palette, lut, noiseField } = kit;
    const t = time * cfg.speed;
    const L = meshLayout(cfg);

    // Pre-expanded anchor colours: the inner loop must not touch the LUT.
    const count = L.nodes.length;
    const colors = new Float64Array(count * 3);
    const phases = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const s = Math.round(L.nodes[i].t * 255) * 3;
      colors[i * 3] = lut[s];
      colors[i * 3 + 1] = lut[s + 1];
      colors[i * 3 + 2] = lut[s + 2];
      phases[i] = L.nodes[i].phase;
    }

    const dir = (cfg.direction * Math.PI) / 180;
    const driftX = Math.cos(dir) * L.drift * t;
    const driftY = Math.sin(dir) * L.drift * t;
    const n = L.n;
    const cells = L.cells;

    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      // ---- domain warp -------------------------------------------------
      const nx = noiseField.sample(u * L.freq + driftX, v * L.freq + driftY);
      const ny = noiseField.sample(u * L.freq + 5.7 + driftX, v * L.freq + 2.3 + driftY);
      let px = u + (nx - 0.5) * L.warp * 2;
      let py = v + (ny - 0.5) * L.warp * 2;

      px = px < 0 ? 0 : px > 1 ? 1 : px;
      py = py < 0 ? 0 : py > 1 ? 1 : py;

      // ---- lattice lookup ---------------------------------------------
      let ix = (px * cells) | 0;
      let iy = (py * cells) | 0;
      if (ix > cells - 1) ix = cells - 1;
      if (iy > cells - 1) iy = cells - 1;
      let fx = px * cells - ix;
      let fy = py * cells - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);

      const i00 = iy * n + ix;
      const i10 = i00 + 1;
      const i01 = i00 + n;
      const i11 = i01 + 1;

      // Slow per-anchor breathing keeps adjacent cells from settling.
      const b00 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i00]);
      const b10 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i10]);
      const b01 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i01]);
      const b11 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i11]);

      const w00 = (1 - fx) * (1 - fy) * b00;
      const w10 = fx * (1 - fy) * b10;
      const w01 = (1 - fx) * fy * b01;
      const w11 = fx * fy * b11;
      const sum = w00 + w10 + w01 + w11 || 1;

      out[0] = (colors[i00 * 3] * w00 + colors[i10 * 3] * w10 + colors[i01 * 3] * w01 + colors[i11 * 3] * w11) / sum;
      out[1] =
        (colors[i00 * 3 + 1] * w00 + colors[i10 * 3 + 1] * w10 + colors[i01 * 3 + 1] * w01 + colors[i11 * 3 + 1] * w11) / sum;
      out[2] =
        (colors[i00 * 3 + 2] * w00 + colors[i10 * 3 + 2] * w10 + colors[i01 * 3 + 2] * w01 + colors[i11 * 3 + 2] * w11) / sum;
    });

    kit.field.blit(ctx, w, h);
  },
};

/* ---- src/generators/noisefield.js ---- */
/**
 * Dynamic noise field.
 *
 * Two independently drifting samples of the same tileable fBm field are blended
 * (0.62 / 0.38) at different frequencies. A single drifting sample reads as
 * "sliding wallpaper"; the second octave stack incommensurate with the first
 * breaks the translation lock and reads as genuine turbulence.
 */



const noise = {
  id: 'noise',
  label: 'Noise field',
  blurb: 'Tileable fBm turbulence, palette-mapped and evolving in place.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const P = noiseParams(cfg);
    const t = time * cfg.speed;
    const main = kit.noiseField;
    const fallback = P.octaves !== main.octaves ? kit.noise(P.octaves) : main;

    const dir = (cfg.direction * Math.PI) / 180;
    const vx = Math.cos(dir);
    const vy = Math.sin(dir);
    const drift = t * P.drift;

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale * 0.85;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      const A = main.sample(u * P.freq + vx * drift, v * P.freq + vy * drift);
      // Second stack: higher frequency, counter-drifting, offset origin.
      const B = fallback.sample(
        u * P.secondFreq - vy * drift * 1.6 + 0.37,
        v * P.secondFreq + vx * drift * 1.6 + 0.71,
      );
      let n = A * 0.62 + B * 0.38;

      // Contrast around a movable midpoint, then a gamma curve for punch.
      n = (n - P.mid) / Math.max(0.08, 1 - Math.abs(P.mid - 0.5) * 2) + 0.5;
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      n = Math.pow(n, P.gamma);

      const idx = (n * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};

/* ---- src/generators/blobs.js ---- */
/**
 * Light blobs (光斑).
 *
 * Additive radial gradients on a dark base. Additive blending is the whole trick:
 * overlapping blobs sum toward white at the intersections, which is what real
 * out-of-focus highlights do. Drawing them with `source-over` looks like painted
 * circles instead of light.
 *
 * Geometry comes from `blobLayout`, shared with the CSS and SVG exporters.
 */




const blobs = {
  id: 'blobs',
  label: 'Light blobs',
  blurb: 'Additive bokeh spots; overlaps bloom toward white.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const L = blobLayout(cfg);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    const dir = (cfg.direction * Math.PI) / 180;
    const spread = 0.05 + cfg.intensity * 0.16;
    const sizeScale = (0.55 + cfg.scale * 0.7) * minDim;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const b of L.items) {
      const rgb = kit.paletteRgb[Math.min(kit.paletteRgb.length - 1, b.colorIdx)];
      const alpha = b.alpha * (0.45 + cfg.intensity * 0.9);
      const orbit = b.orbit * spread;

      // Lissajous drift, biased along `direction`.
      const cx = (b.bx + Math.cos(b.phase + t * b.pulseSpeed) * orbit * Math.cos(dir)) * w;
      const cy = (b.by + Math.sin(b.phase * 1.37 + t * b.pulseSpeed) * orbit * Math.sin(dir)) * h;
      const r = b.radius * sizeScale * (0.85 + 0.15 * Math.sin(t * b.pulseSpeed * 1.7 + b.phase));

      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a = alpha.toFixed(3);
      const rgba = (k) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${k})`;
      g.addColorStop(0, rgba(a));
      g.addColorStop(0.38, rgba((alpha * 0.5).toFixed(3)));
      g.addColorStop(0.72, rgba((alpha * 0.16).toFixed(3)));
      g.addColorStop(1, rgba(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // Hot core: small, near-white. Reads as the light source, not the haze.
      if (b.coreScale > 0) {
        const cr = r * b.coreScale;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        const ca = (alpha * 0.85).toFixed(3);
        cg.addColorStop(0, `rgba(255,252,245,${ca})`);
        cg.addColorStop(1, 'rgba(255,252,245,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  },
};

/* ---- src/generators/flow.js ---- */
/**
 * Flowing colour.
 *
 * Domain warping again, but the output value is a phase, not a height: the noise
 * displaces the phase of a sine band function, so colour contours stretch and
 * fold like oil on water. A second harmonic at 2.02× breaks the periodicity that
 * makes pure sine bands look like a barcode.
 */




const flow = {
  id: 'flow',
  label: 'Flowing colour',
  blurb: 'Phase-warped colour bands folding like oil on water.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const warpField = kit.noiseField;
    const detailField = kit.noise(4);

    const P = flowParams(cfg);
    const freq = P.freq;
    const bands = P.bands;
    const warp = P.warp;
    const dir = (cfg.direction * Math.PI) / 180;
    const ca = Math.cos(dir);
    const sa = Math.sin(dir);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale * 0.8;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      const n1 = warpField.sample(u * freq + t * 0.02 * ca, v * freq + t * 0.02 * sa);
      const n2 = detailField.sample(
        u * P.detailFreq - t * 0.013 * sa + 0.21,
        v * P.detailFreq + t * 0.013 * ca + 0.63,
      );
      const w1 = (n1 - 0.5) * 2 * warp;
      const w2 = (n2 - 0.5) * 2 * warp * 0.26;

      // Band coordinate along `direction`.
      const along = (u * ca + v * sa) * bands;
      const phase = along * TAU + w1 * TAU + w2 * TAU * 0.5 + t * 0.9;

      let val = 0.5 + 0.5 * Math.sin(phase);
      val = val * 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(phase * 2.02 + 1.1));
      val = val < 0 ? 0 : val > 1 ? 1 : val;

      // Bias toward the palette's light end so bands read as light, not paint.
      const idx = (Math.pow(val, 1.15) * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};

/* ---- src/generators/particles.js ---- */
/**
 * Particle field.
 *
 * Positions are analytic: pos(t) = wrap(base + velocity · t). No integration, no
 * accumulator, no hidden state. That means any frame can be reproduced from
 * (config, t) alone — which is exactly what makes the Canvas export verifiable
 * against the preview at a fixed timestamp.
 *
 * Trails are drawn as a segment from pos(t - Δ) to pos(t) rather than by fading a
 * persistent buffer, for the same reason.
 *
 * Geometry comes from `particleLayout`, shared with the CSS and SVG exporters, so
 * the exported motes sit where the canvas motes sit.
 */



const WRAP = 0.12;

const particles = {
  id: 'particles',
  label: 'Particles',
  blurb: 'Deterministic drifting motes with motion-streak trails.',
  primary: 'density',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const L = particleLayout(cfg);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    // Base wash. Without it a sparse field on a near-black palette reads as an
    // empty frame at thumbnail size, even though hundreds of motes are drawn.
    const c1 = kit.paletteRgb[1] || kit.paletteRgb[0];
    const c2 = kit.paletteRgb[2] || c1;
    const wash = ctx.createRadialGradient(w * 0.46, h * 0.4, 0, w * 0.46, h * 0.4, Math.max(w, h) * 0.78);
    wash.addColorStop(0, `rgba(${c2[0]},${c2[1]},${c2[2]},${(0.2 + cfg.intensity * 0.34).toFixed(3)})`);
    wash.addColorStop(0.55, `rgba(${c1[0]},${c1[1]},${c1[2]},${(0.13 + cfg.intensity * 0.2).toFixed(3)})`);
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    const trailSpan = 0.05 + cfg.intensity * 0.12;
    const scaleFactor = 0.7 + cfg.scale * 0.55;

    // Two passes: soft halos, then crisp cores. Grouping by composite mode keeps
    // state changes down to two for the whole frame.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const alive = [];
    for (const p of L.items) {
      const vx = Math.cos(p.ang) * p.spd;
      const vy = Math.sin(p.ang) * p.spd;
      const wob = Math.sin(t * 0.7 + p.wobble) * p.wobbleAmp;
      const wob2 = Math.cos(t * 0.53 + p.wobble) * p.wobbleAmp;
      const wobQ = Math.sin((t - trailSpan) * 0.7 + p.wobble) * p.wobbleAmp;
      const wob2Q = Math.cos((t - trailSpan) * 0.53 + p.wobble) * p.wobbleAmp;

      alive.push({
        px: wrap(p.bx + vx * t + wob),
        py: wrap(p.by + vy * t + wob2),
        qx: wrap(p.bx + vx * (t - trailSpan) + wobQ),
        qy: wrap(p.by + vy * (t - trailSpan) + wob2Q),
        size: p.size * scaleFactor,
        colorIdx: Math.min(kit.paletteRgb.length - 1, p.colorIdx),
      });
    }

    // Halos
    for (const p of alive) {
      const rgb = kit.paletteRgb[p.colorIdx];
      const r = (p.size * minDim) / 300 + 2;
      const sprite = kit.sprite(rgb, 48, 0.72);
      ctx.globalAlpha = 0.18 + (p.size / 3) * 0.42;
      const d = r * 7.5;
      ctx.drawImage(sprite, p.px * w - d / 2, p.py * h - d / 2, d, d);
    }

    // Cores + streaks
    ctx.globalAlpha = 1;
    for (const p of alive) {
      const rgb = kit.paletteRgb[p.colorIdx];
      const coreR = Math.max(1.2, (p.size * minDim) / 430);

      if (Math.abs(p.px - p.qx) < 0.4 && Math.abs(p.py - p.qy) < 0.4) {
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.1 + p.size * 0.1).toFixed(3)})`;
        ctx.lineWidth = coreR * 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.qx * w, p.qy * h);
        ctx.lineTo(p.px * w, p.py * h);
        ctx.stroke();
      }

      const sprite = kit.sprite(rgb, 32, 0.45);
      const d = coreR * 7;
      ctx.globalAlpha = 0.72 + Math.min(0.28, p.size / 3);
      ctx.drawImage(sprite, p.px * w - d / 2, p.py * h - d / 2, d, d);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

function wrap(v) {
  const span = 1 + WRAP * 2;
  let x = (v + WRAP) % span;
  if (x < 0) x += span;
  return x - WRAP;
}

/* ---- src/generators/texture.js ---- */
/**
 * Abstract texture.
 *
 * Ridged fBm sliced into quantised strata along `direction`: the ridged variant
 * produces creases (|noise| folded at zero), and quantising the result turns those
 * creases into the hard edges of marbled paper / sedimentary bands. A second,
 * finer slice at low weight keeps it from looking like a flat poster.
 */



const texture = {
  id: 'texture',
  label: 'Abstract texture',
  blurb: 'Ridged fBm quantised into marbled strata.',
  primary: 'density',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const ridged = kit.ridgedField;
    const grain = kit.noise(3);

    const P = textureParams(cfg);
    const freq = P.freq;
    const stretch = P.stretch;
    const strata = P.strata;
    const dir = (cfg.direction * Math.PI) / 180;
    const ca = Math.cos(dir);
    const sa = Math.sin(dir);
    const contrast = P.contrast;

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      // Rotate into strata space so `direction` actually rotates the bands.
      const rx = (u - 0.5) * ca + (v - 0.5) * sa + 0.5;
      const ry = -(u - 0.5) * sa + (v - 0.5) * ca + 0.5;

      const n = ridged.sample(rx * freq + t * 0.008, ry * freq * stretch + t * 0.004);
      const fine = grain.sample(rx * freq * 2.2 - t * 0.02, ry * freq * stretch * 2.2 + t * 0.01);

      // Quantise to strata, keep a little of the continuous value for depth.
      const q = Math.floor(n * strata) / strata;
      let val = q * 0.78 + n * 0.16 + fine * 0.06;
      val = 0.5 + (val - 0.5) * contrast;
      val = val < 0 ? 0 : val > 1 ? 1 : val;

      const idx = (val * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};

/* ---- src/generators/index.js ---- */
/**
 * Generator registry.
 *
 * Adding a generator = adding one module with a `render(ctx, w, h, cfg, kit, t)`
 * and registering it here. Nothing else in the engine, the UI or the exporters
 * needs to know about it (the exporters fall back to a documented approximation).
 */








const GENERATORS = [mesh, noise, blobs, flow, particles, texture];

const GENERATOR_MAP = Object.fromEntries(GENERATORS.map((g) => [g.id, g]));

function getGenerator(id) {
  return GENERATOR_MAP[id] || mesh;
}

/**
 * Declared fidelity per (generator, target), aligned with the measured SSIM bands
 * in verify/out/report.md:
 *
 *   exact  — the Canvas export re-runs the engine  (hash-identical)
 *   high   — SSIM >= 0.70 against the reference
 *   medium — SSIM 0.45 - 0.70
 *   low    — SSIM < 0.45; use it for a still-adjacent look, not for motion fidelity
 *
 * These are not marketing labels: the export panel shows them next to the download
 * button, and the harness checks the same generators every run.
 */
const EXPORT_CAPABILITY = {
  mesh: { css: 'medium', svg: 'medium', canvas: 'exact' },
  noise: { css: 'medium', svg: 'medium', canvas: 'exact' },
  blobs: { css: 'high', svg: 'high', canvas: 'exact' },
  flow: { css: 'low', svg: 'low', canvas: 'exact' },
  particles: { css: 'high', svg: 'high', canvas: 'exact' },
  texture: { css: 'low', svg: 'low', canvas: 'exact' },
};

/* ---- src/engine/renderer.js ---- */
/**
 * Canvas2D renderer.
 *
 * Owns the display canvas, the internal-resolution scene canvas, the per-frame
 * "kit" (palette LUT, noise fields, scratch buffers) and the animation loop.
 *
 * Two invariants:
 *  1. `drawAt(t)` is a pure function of (config, t). The animation loop is just a
 *     clock feeding timestamps into it. Exports and the verification harness use
 *     the same entry point with a fixed t, so "preview == export" is testable.
 *  2. Nothing is allocated per frame that can be allocated once. Frame rate at
 *     1080p is the deliverable, not a nice-to-have.
 */







const MAX_INTERNAL_PIXELS = 2_400_000;
const TARGET_FRAME_MS = 16.7;

class Renderer {
  constructor(canvas, config) {
    this.display = canvas;
    this.displayCtx = canvas.getContext('2d', { alpha: false });
    this.scene = createCanvas(2, 2);
    this.sceneCtx = this.scene.getContext('2d', { alpha: false });
    this.config = config;
    this.kit = null;
    this.kitKey = '';
    this.buffers = new Map();
    this.startTime = 0;
    this.lastTs = 0;
    this.running = false;
    this.paused = false;
    this.fixedTime = null;
    this.renderScale = 0.8;
    this.autoQuality = true;
    this.frameMs = [];
    this.fps = 0;
    this.frameCount = 0;
    this.reducedMotion = false;
    this.onStats = null;
    this._raf = 0;
    this._cooldown = 0;

    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.mq.matches;
      this.mq.addEventListener?.('change', (e) => {
        this.reducedMotion = e.matches;
        if (this.reducedMotion) this.drawAt(0);
      });
    }
  }

  setConfig(config) {
    this.config = config;
    this.renderScale = QUALITY[config.quality] || 0;
    this.autoQuality = config.quality === 'auto';
    if (this.autoQuality) this.renderScale = Math.max(0.55, this.renderScale || 0.8);
  }

  resize() {
    const rect = this.display.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dw = Math.round(cssW * dpr);
    const dh = Math.round(cssH * dpr);
    if (this.display.width !== dw || this.display.height !== dh) {
      this.display.width = dw;
      this.display.height = dh;
    }
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;

    const scale = this.renderScale || 0.8;
    let iw = Math.round(cssW * scale);
    let ih = Math.round(cssH * scale);
    const px = iw * ih;
    if (px > MAX_INTERNAL_PIXELS) {
      const k = Math.sqrt(MAX_INTERNAL_PIXELS / px);
      iw = Math.round(iw * k);
      ih = Math.round(ih * k);
    }
    this.iw = Math.max(2, iw);
    this.ih = Math.max(2, ih);

    if (this.scene.width !== this.iw || this.scene.height !== this.ih) {
      this.scene.width = this.iw;
      this.scene.height = this.ih;
    }
  }

  /** Build (or reuse) the per-config render kit. */
  buildKit(cfg) {
    const key = `${cfg.seed}|${cfg.palette.join(',')}|${cfg.blur.toFixed(2)}|${cfg.generator}`;
    if (this.kit && this.kitKey === key) return this.kit;

    const paletteRgb = cfg.palette.map((hex) => {
      const { r, g, b } = parseHex(hex);
      return [r | 0, g | 0, b | 0];
    });

    const kit = {
      palette: cfg.palette,
      paletteRgb,
      lut: buildPaletteLut(cfg.palette, 256),
      noiseField: getNoiseField(cfg.seed, 5, false),
      ridgedField: getNoiseField((cfg.seed ^ 0x9e3779b9) >>> 0, 5, true),
      noise: (octaves) => getNoiseField(cfg.seed, octaves, false),
      sprite: (rgb, size, softness) => getGlowSprite(rgb, size, softness),
      field: null,
      // Softness is implemented by lowering the field resolution, not by a blur
      // filter: free, deterministic, and identical in the exported Canvas code.
      fieldScale: 0.38 - cfg.blur * 0.18,
    };

    this.kit = kit;
    this.kitKey = key;
    return kit;
  }

  bufferFor(key) {
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = new FieldBuffer();
      this.buffers.set(key, buf);
    }
    return buf;
  }

  /** Render one frame at absolute time `t` seconds into the scene canvas. */
  drawScene(cfg, t) {
    const ctx = this.sceneCtx;
    const w = this.iw;
    const h = this.ih;
    const kit = this.buildKit(cfg);
    kit.field = this.bufferFor(cfg.generator);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const gen = getGenerator(cfg.generator);
    kit.field = this.bufferFor(cfg.generator);

    ctx.save();
    gen.render(ctx, w, h, cfg, kit, t);
    ctx.restore();

    this.applyVignette(ctx, w, h, cfg);
    this.applyGrain(ctx, w, h, cfg, t);
  }

  applyVignette(ctx, w, h, cfg) {
    if (cfg.vignette <= 0.001) return;
    const cx = w / 2;
    const cy = h / 2;
    const inner = Math.min(w, h) * 0.28;
    const outer = Math.hypot(w, h) * 0.62;
    const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, `rgba(0,0,0,${(cfg.vignette * 0.28).toFixed(3)})`);
    g.addColorStop(1, `rgba(0,0,0,${(cfg.vignette * 0.78).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  applyGrain(ctx, w, h, cfg, t) {
    if (cfg.grain <= 0.001) return;
    const seed = (cfg.seed ^ 0x5bf03635) >>> 0;
    const tile = getGrainTile(seed, 128);

    // Deterministic pseudo-random offset per 30ths of a second: grain must
    // shimmer, but frame N must look identical on every run.
    const frame = Math.round(t * 30);
    let s = (frame * 2654435761) >>> 0;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const ox = (s >>> 0) % 128;
    const oy = ((s >>> 8) ^ (s >>> 3)) % 128;

    // The pattern object is expensive to build and does not change between
    // frames; caching it is worth more than it looks on a 1.3 Mpx fill.
    if (!this.grainPattern || this.grainPatternSeed !== seed) {
      this.grainPattern = ctx.createPattern(tile, 'repeat');
      this.grainPatternSeed = seed;
    }
    const pattern = this.grainPattern;

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.85, cfg.grain * 0.85);
    if (pattern.setTransform && typeof DOMMatrix !== 'undefined') {
      pattern.setTransform(new DOMMatrix().translate(-ox, -oy));
    }
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Public single-frame entry point. Uses the effective (overridden) config. */
  drawAt(t) {
    this.resize();
    const cfg = effectiveConfig(this.config);
    this.drawScene(cfg, cfg.animated ? t : 0);
    this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.displayCtx.imageSmoothingEnabled = true;
    // 'high' upscaling in software raster costs several ms at 1080p for no
    // visible gain over the default bilinear filter.
    if ('imageSmoothingQuality' in this.displayCtx) this.displayCtx.imageSmoothingQuality = 'low';
    this.displayCtx.drawImage(this.scene, 0, 0, this.scene.width, this.scene.height, 0, 0, this.display.width, this.display.height);
    return this.scene;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = 0;
    this.lastTs = 0;
    const loop = (ts) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!this.startTime) this.startTime = ts;
      const t = (ts - this.startTime) / 1000;
      const dt = this.lastTs ? ts - this.lastTs : TARGET_FRAME_MS;
      this.lastTs = ts;

      if (this.reducedMotion) {
        if (this.frameCount === 0) this.drawAt(0);
        this.frameCount++;
        return;
      }

      const t0 = performance.now();
      this.drawAt(this.fixedTime ?? t);
      const cost = performance.now() - t0;
      this.recordFrame(cost, dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  recordFrame(cost, dt) {
    this.frameCount++;
    const arr = this.frameMs;
    arr.push(cost);
    if (arr.length > 120) arr.shift();
    if (dt > 0) this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;

    if (this.onStats && this.frameCount % 15 === 0) {
      this.onStats(this.stats());
    }

    if (!this.autoQuality || this._cooldown > 0) {
      if (this._cooldown > 0) this._cooldown--;
      return;
    }
    if (arr.length < 45) return;

    const sorted = [...arr].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    if (p75 > 22 && this.renderScale > 0.5) {
      this.renderScale = Math.max(0.5, this.renderScale * 0.86);
      this._cooldown = 60;
    } else if (p75 < 11 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale * 1.08);
      this._cooldown = 90;
    }
  }

  stats() {
    const arr = this.frameMs;
    const sorted = [...arr].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    const mem = typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0;
    return {
      fps: Math.round(this.fps),
      drawMsP50: +pct(0.5).toFixed(2),
      drawMsP95: +pct(0.95).toFixed(2),
      renderScale: +this.renderScale.toFixed(2),
      internal: `${this.iw}×${this.ih}`,
      heapMB: mem ? +(mem / 1048576).toFixed(1) : 0,
      frames: this.frameCount,
    };
  }

  /** Render at an explicit size into a detached canvas (used by PNG export). */
  renderStill(cfg, time, width, height) {
    const prev = { iw: this.iw, ih: this.ih, scale: this.renderScale, cssW: this.cssW, cssH: this.cssH, dpr: this.dpr };
    const scene = createCanvas(2, 2);
    const sceneCtx = scene.getContext('2d', { alpha: false });
    const scale = Math.min(1, Math.sqrt(MAX_INTERNAL_PIXELS / (width * height)));
    const iw = Math.max(2, Math.round(width * Math.max(0.5, scale)));
    const ih = Math.max(2, Math.round(height * Math.max(0.5, scale)));
    scene.width = iw;
    scene.height = ih;

    const kit = this.buildKit(cfg);
    const buf = this.bufferFor(`${cfg.generator}:still`);
    buf.ensure(Math.max(2, Math.round(iw * kit.fieldScale)), Math.max(2, Math.round(ih * kit.fieldScale)));
    kit.field = buf;

    sceneCtx.fillStyle = cfg.background;
    sceneCtx.fillRect(0, 0, iw, ih);
    getGenerator(cfg.generator).render(sceneCtx, iw, ih, cfg, kit, time);
    this.applyOn(sceneCtx, iw, ih, cfg, time);

    const out = createCanvas(width, height);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(scene, 0, 0, iw, ih, 0, 0, width, height);
    Object.assign(this, { iw: prev.iw, ih: prev.ih, renderScale: prev.scale });
    return out;
  }

  applyOn(ctx, w, h, cfg, t) {
    this.applyVignette(ctx, w, h, cfg);
    this.applyGrain(ctx, w, h, cfg, t);
  }
}

/* ---- src/runtime/entry.js ---- */
/**
 * Standalone runtime entry.
 *
 * This file is never loaded by the studio. It exists solely as the root of the
 * flattened bundle handed to users who choose the Canvas export. Because it
 * imports the *same* Renderer and generators the studio uses, the exported
 * background is not a re-implementation — it is the engine.
 */





const VERSION = '1.0.0';

/**
 * Mount a background on a canvas (or canvas selector).
 * @returns {{ renderer: Renderer, setConfig: Function, destroy: Function }}
 */
function mount(target, config, options = {}) {
  const canvas = typeof target === 'string' ? document.querySelector(target) : target;
  if (!canvas) throw new Error(`VeilForge.mount: no element matched ${target}`);
  if (!canvas.getContext) throw new Error('VeilForge.mount: target is not a <canvas>');

  // A canvas with no CSS box renders at 300×150; give it the viewport by default.
  if (!canvas.style.width) canvas.style.width = '100%';
  if (!canvas.style.height) canvas.style.height = '100%';
  canvas.style.display = canvas.style.display || 'block';

  const cfg = normalizeConfig(config);
  const renderer = new Renderer(canvas, cfg);
  renderer.resize();
  renderer.drawAt(options.time ?? 0);
  if (cfg.animated && options.autoStart !== false) renderer.start();

  return {
    renderer,
    setConfig(next) {
      renderer.setConfig(normalizeConfig(next));
      renderer.drawAt(options.time ?? 0);
    },
    destroy() {
      renderer.stop();
    },
  };
}

function listGenerators() {
  return GENERATORS.map((g) => g.id);
}

const api = { version: VERSION, mount, listGenerators };
if (typeof window !== 'undefined') window.VeilForge = api;
const __default__ = api;

})();
