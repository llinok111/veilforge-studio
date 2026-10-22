/**
 * Image-comparison metrics shared by the harnesses.
 *
 * Kept in one module so `verify.mjs` and `verify/fidelity.mjs` cannot disagree
 * about what "SSIM 0.6" means.
 */

/** Mean absolute error over RGB, 0–255. */
export function mae(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
}

/** Windowed SSIM on luminance, 8×8 blocks, C1/C2 tuned for 0..255 data. */
export function ssim(a, b, w, h, block = 8) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const lum = new Float32Array(w * h);
  const lum2 = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    lum[p] = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    lum2[p] = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
  }
  let total = 0;
  let blocks = 0;
  for (let by = 0; by + block <= h; by += block) {
    for (let bx = 0; bx + block <= w; bx += block) {
      let ma = 0;
      let mb = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const p = (by + y) * w + bx + x;
          ma += lum[p];
          mb += lum2[p];
        }
      }
      const n = block * block;
      ma /= n;
      mb /= n;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const p = (by + y) * w + bx + x;
          const da = lum[p] - ma;
          const db = lum2[p] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n;
      vb /= n;
      cov /= n;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  return total / blocks;
}

/** Luminance mean / std, 0..1 — the "same exposure?" check. */
export function tone(data) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 5) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    sum += l;
    sum2 += l * l;
    n++;
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(4), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(4) };
}

/** Cheap content hash, used to assert byte-identical frames. */
export function hashPixels(data) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i += 13) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Verdict from the raw measurements, shared so both harnesses label alike. */
export const GATES = {
  canvas: { mae: 2, ssim: 0.99, meanDelta: 0.02 },
  svg: { mae: 40, ssim: 0.55, meanDelta: 0.1 },
  css: { mae: 40, ssim: 0.5, meanDelta: 0.1 },
};

export function verdictFor(row) {
  const t = GATES[row.target];
  if (row.mae === null || row.mae === undefined) return 'failed';
  if (row.target === 'canvas') {
    return row.exact ? 'exact' : row.mae <= t.mae && row.ssim >= t.ssim ? 'structural' : 'failed';
  }
  if (row.ssim >= t.ssim && row.meanDelta <= t.meanDelta) return 'structural';
  if (row.meanDelta <= 0.08 && (row.stdDelta ?? 1) <= 0.1) return 'tonal';
  return 'divergent';
}
