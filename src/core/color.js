/**
 * Colour maths.
 *
 * Gradient interpolation happens in OKLab rather than sRGB: naive sRGB mixing
 * produces the grey/muddy midpoint that makes generated backgrounds look cheap.
 * OKLab keeps perceptual lightness and chroma stable across a blend, which is
 * the difference between "AI product hero" and "1998 WordArt".
 */

const D2R = Math.PI / 180;

export function clamp(v, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Parse #rgb / #rrggbb / #rrggbbaa into {r,g,b,a} with 0-255 channels. */
export function parseHex(hex) {
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

export function toHex({ r, g, b }) {
  const f = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
}

/** sRGB(0-255) → OKLab {L,a,b}. */
export function rgbToOklab(r, g, b) {
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
export function oklabToRgb(L, a, b) {
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
export function paletteToOklab(palette) {
  return palette.map((hex) => {
    const { r, g, b } = parseHex(hex);
    return rgbToOklab(r, g, b);
  });
}

/** Sample an OKLab ramp at t∈[0,1]; returns sRGB 0-255. */
export function sampleOklabRamp(labs, t) {
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
export function buildPaletteLut(palette, size = 256) {
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
export function cssRampStops(palette, steps = 7) {
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
export function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black or white text for a background, whichever contrasts more. */
export function readableInk(hex) {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}

export function hslToHex(h, s, l) {
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

export const TAU = Math.PI * 2;
export const DEG = D2R;
