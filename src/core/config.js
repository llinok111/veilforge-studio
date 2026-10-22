/**
 * Configuration schema: defaults, validation, clamping and migration.
 *
 * A config is the single source of truth for every export target. Any value that
 * reaches a generator has already passed through `normalizeConfig`, so
 * generators can trust ranges and never need defensive checks.
 */

export const CONFIG_VERSION = 1;

/** The five knobs the brief asks for, plus the visual extras. */
export const SLIDERS = {
  speed: { min: 0, max: 2, step: 0.01, label: 'Speed', hint: '0 freezes the frame' },
  density: { min: 0, max: 1, step: 0.01, label: 'Density', hint: 'Element count / detail' },
  direction: { min: 0, max: 360, step: 1, label: 'Direction', hint: 'Degrees, 0 = →' },
  intensity: { min: 0, max: 1, step: 0.01, label: 'Intensity', hint: 'Effect strength' },
  scale: { min: 0.4, max: 3, step: 0.01, label: 'Scale', hint: 'Feature size' },
  grain: { min: 0, max: 1, step: 0.01, label: 'Grain', hint: 'Film grain overlay' },
  vignette: { min: 0, max: 1, step: 0.01, label: 'Vignette', hint: 'Corner falloff' },
  blur: { min: 0, max: 1, step: 0.01, label: 'Softness', hint: 'Edge diffusion' },
};

export const ASPECTS = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '21:9': 21 / 9,
};

export const QUALITY = {
  low: 0.45,
  medium: 0.62,
  high: 0.8,
  ultra: 1,
  auto: 0,
};

export const DEFAULT_CONFIG = Object.freeze({
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
export function normalizeConfig(input) {
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
export function effectiveConfig(config) {
  const ov = config.overrides?.[config.generator];
  if (!ov) return config;
  return { ...config, ...ov };
}

/** Serialise to a stable, human-diffable JSON string (2-space, sorted-ish keys). */
export function serializeConfig(config) {
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

export function parseConfig(text) {
  const data = JSON.parse(text);
  return normalizeConfig(data);
}

/** Compact string for URL hashes: base36 seed keeps links short. */
export function encodeShareHash(config) {
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

export function decodeShareHash(hash) {
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
export function diffConfig(a, b) {
  const out = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const av = JSON.stringify(a[key]);
    const bv = JSON.stringify(b[key]);
    if (av !== bv) out[key] = { from: a[key], to: b[key] };
  }
  return out;
}
