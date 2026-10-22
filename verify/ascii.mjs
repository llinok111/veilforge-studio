/**
 * Text-mode visual inspector.
 *
 * Screenshots are opaque to a text model, so this prints two machine-readable
 * views of the rendered frame instead:
 *   1. a luminance ASCII map (shape / structure / banding)
 *   2. a coarse hex grid (hue distribution / palette usage)
 * plus statistics used as pass-fail gates (blank detection, contrast, saturation).
 *
 * It is also the tool that catches "technically rendering, visually dead" frames:
 * a blank canvas and a blown-out one both pass a naive pixel-count check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser-raw.mjs';

const RAMP = ' .:-=+*#%@';

export function asciiMap(pixels, width, height, cols = 64, rows = 22) {
  // Box-average each cell: a point sample turns film grain into fake structure
  // and makes fine-detail generators judge themselves unfairly.
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    const y0 = Math.floor((r / rows) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) / rows) * height));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c / cols) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) / cols) * width));
      let lum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          lum += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
          n++;
        }
      }
      const v = lum / Math.max(1, n);
      line += RAMP[Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1) * 1.15))];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function hexGrid(pixels, width, height, cols = 8, rows = 5) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const parts = [];
    for (let c = 0; c < cols; c++) {
      let R = 0;
      let G = 0;
      let B = 0;
      let n = 0;
      const x0 = Math.floor((c / cols) * width);
      const x1 = Math.floor(((c + 1) / cols) * width);
      const y0 = Math.floor((r / rows) * height);
      const y1 = Math.floor(((r + 1) / rows) * height);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          R += pixels[i];
          G += pixels[i + 1];
          B += pixels[i + 2];
          n++;
        }
      }
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
      parts.push(`#${hex(R)}${hex(G)}${hex(B)}`);
    }
    lines.push(parts.join(' '));
  }
  return lines.join('\n');
}

export function stats(pixels, width, height) {
  const lums = [];
  let sat = 0;
  let n = 0;
  const seen = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 7) {
    const R = pixels[i];
    const G = pixels[i + 1];
    const B = pixels[i + 2];
    const mx = Math.max(R, G, B);
    const mn = Math.min(R, G, B);
    lums.push((0.2126 * R + 0.7152 * G + 0.0722 * B) / 255);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    seen.add((R >> 3) * 1024 + (G >> 3) * 32 + (B >> 3));
    n++;
  }
  lums.sort((a, b) => a - b);
  const pick = (p) => lums[Math.min(lums.length - 1, Math.floor(lums.length * p))];
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const bright = lums.filter((v) => v > 0.45).length / lums.length;
  const variance = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length;
  return {
    mean: +mean.toFixed(3),
    p05: +pick(0.05).toFixed(3),
    p50: +pick(0.5).toFixed(3),
    p95: +pick(0.95).toFixed(3),
    contrast: +(pick(0.95) - pick(0.05)).toFixed(3),
    stdDev: +Math.sqrt(variance).toFixed(4),
    saturation: +(sat / n).toFixed(3),
    distinctBuckets: seen.size,
    brightFraction: +bright.toFixed(4),
    p99: +pick(0.99).toFixed(3),
  };
}

/** Render one config in the studio and print both views. */
export async function inspect(config, { label = 'frame', width = 1440, height = 900 } = {}) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('http://127.0.0.1:4329/', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]');
  const pixels = await page.evaluate(async (cfg) => {
    const { Renderer } = await import('/src/engine/renderer.js');
    const { normalizeConfig } = await import('/src/core/config.js');
    // The canvas must be laid out: resize() reads getBoundingClientRect().
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:600px';
    const canvas = document.createElement('canvas');
    canvas.style.width = '900px';
    canvas.style.height = '506px';
    host.appendChild(canvas);
    document.body.appendChild(host);
    const r = new Renderer(canvas, normalizeConfig({ ...cfg, animated: false }));
    r.resize();
    r.drawAt(0);
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    host.remove();
    return { w: canvas.width, h: canvas.height, data: Array.from(d.data) };
  }, config);

  await browser.close();
  const px = Uint8ClampedArray.from(pixels.data);
  console.log(`\n===== ${label} =====`);
  console.log(asciiMap(px, pixels.w, pixels.h));
  console.log(hexGrid(px, pixels.w, pixels.h));
  console.log(JSON.stringify(stats(px, pixels.w, pixels.h)));
  return { pixels: px, w: pixels.w, h: pixels.h };
}

export const _fs = fs;
