/**
 * Fidelity-only harness.
 *
 * Same measurement as `verify.mjs` section 1, without the perf/CPU/compat sweep,
 * so a calibration change can be re-measured in minutes instead of half an hour.
 * Output feeds directly into the report table; the verdict labels come from the
 * shared `metrics.mjs` so the two harnesses can never disagree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../tools/serve.mjs';
import { withBrowser } from './browser.mjs';
import { buildCssExport } from '../src/export/css.js';
import { buildSvgExport } from '../src/export/svg.js';
import { buildCanvasExport } from '../src/export/canvasjs.js';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/core/config.js';
import { mae, ssim, tone, hashPixels, verdictFor } from './metrics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'verify/out');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.VERIFY_PORT) || 4380;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1200;
const H = 675;
const GENS = ['mesh', 'noise', 'blobs', 'flow', 'particles', 'texture'];

const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const rows = [];

await withBrowser(
  async (context) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]');

    const render = (cfg) =>
      page.evaluate(
        async ({ cfg, W, H }) => {
          const { Renderer } = await import('/src/engine/renderer.js');
          const { normalizeConfig } = await import('/src/core/config.js');
          const host = document.createElement('div');
          host.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:-1`;
          const canvas = document.createElement('canvas');
          canvas.style.width = `${W}px`;
          canvas.style.height = `${H}px`;
          host.appendChild(canvas);
          document.body.appendChild(host);
          const r = new Renderer(canvas, normalizeConfig(cfg));
          r.setConfig(normalizeConfig(cfg));
          r.resize();
          r.drawAt(0);
          const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
          host.remove();
          return { w: canvas.width, h: canvas.height, data: Array.from(d.data) };
        },
        { cfg, W, H },
      );

    const decode = await context.newPage();
    await decode.setContent('<body style="margin:0"></body>');

    for (const gen of GENS) {
      const cfg = normalizeConfig({ ...DEFAULT_CONFIG, generator: gen, speed: 0, animated: false, quality: 'high' });
      const ref = await render(cfg);
      const refData = Uint8ClampedArray.from(ref.data);
      const refTone = tone(refData);

      for (const target of ['canvas', 'svg', 'css']) {
        const built = target === 'svg' ? buildSvgExport(cfg) : target === 'css' ? buildCssExport(cfg) : buildCanvasExport(cfg);
        const file = built.files.find((f) => f.name.endsWith('.html')) || built.files[0];
        const dest = path.join(outDir, `${gen}.${target}${path.extname(file.name)}`);
        fs.writeFileSync(dest, file.text);

        let data;
        if (target === 'canvas') {
          const p = await context.newPage();
          await p.setViewportSize({ width: W, height: H });
          await p.goto(`${BASE}/verify/out/${path.basename(dest)}`, { waitUntil: 'load' });
          await p.waitForTimeout(350);
          const got = await p.evaluate(() => {
            const c = document.getElementById('bg');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            return { w: c.width, h: c.height, data: Array.from(d.data) };
          });
          await p.close();
          data = Uint8ClampedArray.from(got.data);
        } else {
          const p = await context.newPage();
          await p.setViewportSize({ width: W, height: H });
          await p.goto(`${BASE}/verify/out/${path.basename(dest)}`, { waitUntil: 'load' });
          await p.waitForTimeout(500);
          const shot = await p.screenshot({ type: 'png', timeout: 60000 });
          await p.close();
          const dec = await decode.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
          }, shot.toString('base64'));
          data = Uint8ClampedArray.from(dec);
        }

        const t = tone(data);
        const row = {
          generator: gen,
          target,
          mae: +mae(refData, data).toFixed(2),
          ssim: +ssim(refData, data, ref.w, ref.h).toFixed(4),
          meanDelta: +Math.abs(refTone.mean - t.mean).toFixed(4),
          stdDelta: +Math.abs(refTone.std - t.std).toFixed(4),
          refMean: refTone.mean,
          outMean: t.mean,
          exact: hashPixels(data) === hashPixels(refData),
          declared: built.approx,
          bytes: fs.statSync(dest).size,
        };
        row.verdict = verdictFor(row);
        rows.push(row);
        console.log(
          `${gen.padEnd(10)} ${target.padEnd(4)} MAE=${String(row.mae).padStart(6)} SSIM=${String(row.ssim).padEnd(7)} Δmean=${String(row.meanDelta).padEnd(7)} ${row.refMean}→${row.outMean}  ${row.verdict}`,
        );
      }
    }
  },
  { width: W, height: H },
);

server.close();

const counts = rows.reduce((acc, r) => {
  acc[r.verdict] = (acc[r.verdict] || 0) + 1;
  return acc;
}, {});
console.log('\n' + JSON.stringify(counts));
fs.writeFileSync(path.join(outDir, 'fidelity.json'), JSON.stringify(rows, null, 2));
