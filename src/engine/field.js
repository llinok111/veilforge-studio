/**
 * Low-resolution field buffers.
 *
 * Per-pixel generators (noise, flow, mesh, texture) would cost 20-60 ms a frame
 * if they wrote every device pixel. Instead they paint a small buffer and let the
 * GPU-composited `drawImage` upscale it. That is also visually correct here:
 * backgrounds want soft gradients, not crisp pixels.
 */

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export class FieldBuffer {
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

export function getGlowSprite(rgb, size = 64, softness = 0.5) {
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

export function getGrainTile(seed, size = 128) {
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
