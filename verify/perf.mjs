/** Fast perf-only loop, for iterating on the renderer without the full harness. */

import path from 'node:path';
import { createServer } from '../tools/serve.mjs';
import { withBrowser } from './browser.mjs';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/core/config.js';

const root = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PERF_PORT) || 4350;
const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

await withBrowser(
  async (context) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]');

    const out = await page.evaluate(async () => {
      const { Renderer } = await import('/src/engine/renderer.js');
      const { normalizeConfig } = await import('/src/core/config.js');

      const make = (w, h) => {
        const host = document.createElement('div');
        host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:-1`;
        const c = document.createElement('canvas');
        c.style.cssText = `width:${w}px;height:${h}px`;
        host.appendChild(c);
        document.body.appendChild(host);
        return { host, c };
      };

      const time = (fn, n = 45) => {
        const s = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          fn(i / 60);
          const d = performance.now() - t0;
          s.push(d);
        }
        s.sort((a, b) => a - b);
        return { p50: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) };
      };

      // Baseline: the compositing floor of this environment, with a forced flush
      // so Chrome cannot defer the rasterisation out of the measurement.
      const { host: bh, c: bc } = make(1920, 1080);
      bc.width = 1920;
      bc.height = 1080;
      const bctx = bc.getContext('2d', { alpha: false });
      const src = document.createElement('canvas');
      src.width = 1536;
      src.height = 864;
      const sctx = src.getContext('2d');
      const g = sctx.createLinearGradient(0, 0, 1536, 864);
      g.addColorStop(0, '#123');
      g.addColorStop(1, '#a75');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 1536, 864);
      const baseline = time(() => {
        bctx.fillStyle = '#101010';
        bctx.fillRect(0, 0, 1920, 1080);
        bctx.drawImage(src, 0, 0, 1920, 1080);
        bctx.getImageData(0, 0, 1, 1);
      });
      bh.remove();

      const results = [];
      for (const gen of ['mesh', 'noise', 'blobs', 'flow', 'particles', 'texture']) {
        for (const quality of ['high', 'ultra']) {
          const { host, c } = make(1920, 1080);
          const cfg = normalizeConfig({ generator: gen, quality, animated: false, aspect: '16:9' });
          const r = new Renderer(c, cfg);
          r.setConfig(cfg);
          r.resize();
          r.drawAt(0);
          const res = time((t) => {
            r.drawAt(t);
            c.getContext('2d').getImageData(0, 0, 1, 1);
          });
          results.push({ generator: gen, quality, ...res, internal: `${r.iw}×${r.ih}` });
          host.remove();
        }
      }
      return { baseline, results };
    });

    console.log(`baseline ${out.baseline.p50} ms (p95 ${out.baseline.p95})`);
    for (const r of out.results) {
      const net = Math.max(0, r.p50 - out.baseline.p50);
      console.log(
        `${r.generator.padEnd(10)} ${r.quality.padEnd(6)} ${r.internal.padEnd(10)} p50=${String(r.p50).padStart(6)}  p95=${String(r.p95).padStart(6)}  net=${net.toFixed(2)}`,
      );
    }
  },
  { width: 1920, height: 1080 },
);

server.close();
