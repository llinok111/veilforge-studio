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

import { effectiveConfig, QUALITY } from '../core/config.js';
import { buildPaletteLut, parseHex } from '../core/color.js';
import { getNoiseField } from '../core/noise.js';
import { FieldBuffer, getGrainTile, getGlowSprite, createCanvas } from './field.js';
import { getGenerator } from '../generators/index.js';

const MAX_INTERNAL_PIXELS = 2_400_000;
const TARGET_FRAME_MS = 16.7;

export class Renderer {
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
