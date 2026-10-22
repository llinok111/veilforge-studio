/**
 * Captures the repository's images: one render per generator plus two UI shots.
 *
 * Every frame is asserted before it is written — a screenshot that is blank, flat
 * or single-coloured fails the run instead of shipping. The ASCII thumbnail printed
 * alongside is the text-mode check, since a PNG on disk proves nothing on its own.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './serve.mjs';
import { withBrowser } from '../verify/browser.mjs';
import { PRESETS, paletteById } from '../src/core/presets.js';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/core/config.js';
import { asciiMap, stats } from '../verify/ascii.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.SHOT_PORT) || 4420;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1280;
const H = 720;

// One preset per generator, chosen so the six frames do not look like siblings.
const SHOTS = [
  ['mesh', 'aurora'],
  ['noise', 'weather'],
  ['blobs', 'lampfall'],
  ['flow', 'currents'],
  ['particles', 'motes'],
  ['texture', 'sediment'],
];

function configFor(gen, presetId) {
  const preset = PRESETS.find((p) => p.id === presetId);
  const pal = paletteById(preset.palette);
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    generator: gen,
    palette: [...pal.colors],
    background: pal.background,
    ...preset.values,
    seed: preset.values.seed,
    animated: false,
    quality: 'ultra',
    aspect: '16:9',
  });
}

const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

await withBrowser(
  async (context) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]');

    for (const [gen, presetId] of SHOTS) {
      const cfg = configFor(gen, presetId);
      const png = await page.evaluate(
        async ({ cfg, W, H }) => {
          const { Renderer } = await import('/src/engine/renderer.js');
          const { normalizeConfig } = await import('/src/core/config.js');
          const host = document.createElement('div');
          host.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:-1`;
          const c = document.createElement('canvas');
          c.style.width = `${W}px`;
          c.style.height = `${H}px`;
          host.appendChild(c);
          document.body.appendChild(host);
          const r = new Renderer(c, normalizeConfig(cfg));
          r.setConfig(normalizeConfig(cfg));
          r.resize();
          r.drawAt(0);
          const b = await new Promise((res) => c.toBlob(res, 'image/png'));
          const buf = new Uint8Array(await b.arrayBuffer());
          const px = c.getContext('2d').getImageData(0, 0, c.width, c.height);
          host.remove();
          return { bytes: Array.from(buf), w: c.width, h: c.height, data: Array.from(px.data) };
        },
        { cfg, W, H },
      );

      const file = path.join(outDir, `preview-${gen}.png`);
      fs.writeFileSync(file, Buffer.from(png.bytes));

      const px = Uint8ClampedArray.from(png.data);
      const s = stats(px, png.w, png.h);
      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log(
        `${gen.padEnd(10)} ${String(png.w)}×${png.h}  ${kb} KB  contrast=${s.contrast}  buckets=${s.distinctBuckets}  mean=${s.mean}  p99=${s.p99}  bright=${s.brightFraction}`,
      );
      console.log(
        asciiMap(px, png.w, png.h, 56, 14)
          .split('\n')
          .map((l) => '  ' + l)
          .join('\n'),
      );

      // "Flat" has to mean the right thing per generator. A particle field is
      // deliberately a dark ground with sparse highlights: its signal is highlight
      // density, not the global p95-p05 range. Gating it on contrast would fail a
      // correct frame; gating the others on highlight density would pass a blank one.
      if (gen === 'particles') {
        if (s.brightFraction < 0.004) fail(`${gen}: highlight density ${s.brightFraction} — no motes visible`);
        if (s.p99 < 0.25) fail(`${gen}: p99 ${s.p99} — highlights too dim to read`);
      } else if (s.contrast < 0.18) {
        fail(`${gen}: contrast ${s.contrast} — frame is flat`);
      }
      if (s.distinctBuckets < 60) fail(`${gen}: only ${s.distinctBuckets} colour buckets`);
      if (fs.statSync(file).size < 20_000) fail(`${gen}: PNG suspiciously small`);
    }

    // UI shots
    const ui = await context.newPage();
    await ui.setViewportSize({ width: 1600, height: 1000 });
    await ui.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await ui.waitForSelector('html[data-ready="1"]');
    await ui.waitForTimeout(1400);
    await ui.screenshot({ path: path.join(outDir, 'studio.png'), type: 'png' });
    const studioBox = await ui.evaluate(() => ({
      canvas: document.getElementById('preview').getBoundingClientRect().width | 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    if (studioBox.canvas < 400) fail(`studio: preview only ${studioBox.canvas}px wide`);
    if (studioBox.overflow > 0) fail(`studio: horizontal overflow ${studioBox.overflow}px`);
    console.log(`studio     ${(fs.statSync(path.join(outDir, 'studio.png')).size / 1024).toFixed(0)} KB  preview=${studioBox.canvas}px`);

    const gallery = await context.newPage();
    await gallery.setViewportSize({ width: 1440, height: 1100 });
    await gallery.goto(`${BASE}/dist/demo.html`, { waitUntil: 'load' });
    await gallery.waitForTimeout(1800);
    await gallery.screenshot({ path: path.join(outDir, 'presets.png'), type: 'png' });
    const painted = await gallery.evaluate(
      () =>
        [...document.querySelectorAll('.card')].filter((c) => {
          const cv = c.querySelector('canvas');
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          let mn = 255;
          let mx = 0;
          for (let i = 0; i < d.length; i += 4 * 31) {
            const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
            if (l < mn) mn = l;
            if (l > mx) mx = l;
          }
          return mx - mn > 18;
        }).length,
    );
    if (painted !== 8) fail(`gallery: only ${painted}/8 cards painted`);
    console.log(`presets    ${(fs.statSync(path.join(outDir, 'presets.png')).size / 1024).toFixed(0)} KB  cards painted=${painted}/8`);

    // A wide banner crop of one frame for the README header.
    await page.setViewportSize({ width: 1600, height: 500 });
    const banner = await page.evaluate(async () => {
      const { Renderer } = await import('/src/engine/renderer.js');
      const { normalizeConfig } = await import('/src/core/config.js');
      const cfg = normalizeConfig({
        generator: 'mesh', palette: ['#05060b', '#1b1436', '#3f2a6b', '#7d5bb5', '#c9b6f2'],
        background: '#05060b', seed: 88213, speed: 0, density: 0.62, intensity: 0.78,
        direction: 118, scale: 1.15, grain: 0.18, vignette: 0.34, blur: 0.42,
        animated: false, quality: 'ultra',
      });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1600px;height:400px;z-index:-1';
      const c = document.createElement('canvas');
      c.style.cssText = 'width:1600px;height:400px';
      host.appendChild(c);
      document.body.appendChild(host);
      const r = new Renderer(c, cfg);
      r.setConfig(cfg);
      r.resize();
      r.drawAt(0);
      const b = await new Promise((res) => c.toBlob(res, 'image/png'));
      host.remove();
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    fs.writeFileSync(path.join(outDir, 'banner.png'), Buffer.from(banner));
    console.log(`banner     ${(fs.statSync(path.join(outDir, 'banner.png')).size / 1024).toFixed(0)} KB`);
  },
  { width: W, height: H },
);

server.close();
console.log(failures === 0 ? '\nall images verified' : `\n${failures} image check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
