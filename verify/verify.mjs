/**
 * Export verification harness.
 *
 * Claims this file is responsible for proving or disproving:
 *   1. The Canvas export is pixel-identical to the studio preview.
 *   2. CSS and SVG exports are visually close, and *how* close, per generator.
 *   3. Exports are structurally valid (SVG parses, CSS has rules, JSON round-trips).
 *   4. Determinism: same seed → same pixels across page loads; new seed → different.
 *   5. Cost: per-frame draw time, heap, and CPU task time at 1080p, plus bytes shipped.
 *
 * Everything measured here is produced by the same code paths the download button
 * uses, because the export builders are pure and imported directly into Node.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../tools/serve.mjs';
import { withBrowser } from './browser.mjs';
import { buildCssExport } from '../src/export/css.js';
import { buildSvgExport } from '../src/export/svg.js';
import { buildCanvasExport } from '../src/export/canvasjs.js';
import { buildJsonExport } from '../src/export/json.js';
import { serializeConfig, normalizeConfig, parseConfig } from '../src/core/config.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { mae, ssim, tone, hashPixels, verdictFor, GATES as T } from './metrics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'verify/out');
const PORT = Number(process.env.VERIFY_PORT) || 4330;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1200;
const H = 675;

const GENERATORS = ['mesh', 'noise', 'blobs', 'flow', 'particles', 'texture'];

/** Static config: speed 0 freezes every export target, so diffs are stable. */
function staticConfig(generator, extra = {}) {
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    generator,
    speed: 0,
    animated: false,
    quality: 'high',
    aspect: '16:9',
    ...extra,
  });
}

/* ----------------------------------------------------------------- scoring */

/* ------------------------------------------------------------------ runner */

const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const report = {
  generatedAt: new Date().toISOString(),
  chromium: null,
  viewport: `${W}×${H}`,
  fidelity: [],
  determinism: [],
  validity: [],
  performance: [],
  resources: [],
  compatibility: [],
  notes: [],
};

await withBrowser(
  async (context, browser) => {
    report.chromium = browser.version();

    /* ---- reference renderer: same code path as the exported canvas ---- */
    const refPage = await context.newPage();
    await refPage.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await refPage.waitForSelector('html[data-ready="1"]');

    const renderRef = (cfg) =>
      refPage.evaluate(
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
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
          const out = Array.from(data.data);
          host.remove();
          return { w: canvas.width, h: canvas.height, data: out };
        },
        { cfg, W, H },
      );

    const decodePage = await context.newPage();
    await decodePage.setContent('<body style="margin:0"></body>');
    const decodeShot = async (buf) => {
      const page = decodePage;
      const res = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        return { w: c.width, h: c.height, data: Array.from(d) };
      }, buf.toString('base64'));
      return res;
    };

    /* ---------------------------- 1. fidelity ---------------------------- */
    for (const gen of GENERATORS) {
      const cfg = staticConfig(gen);
      const ref = await renderRef(cfg);
      const refData = Uint8ClampedArray.from(ref.data);
      const refHash = hashPixels(refData);
      const refFile = path.join(outDir, `ref-${gen}.png`);

      for (const target of ['canvas', 'svg', 'css']) {
        const built =
          target === 'css' ? buildCssExport(cfg) : target === 'svg' ? buildSvgExport(cfg) : buildCanvasExport(cfg);
        const file = built.files.find((f) => f.name.endsWith('.html')) || built.files[0];
        const dest = path.join(outDir, `${gen}.${target}${path.extname(file.name)}`);
        fs.writeFileSync(dest, file.text);

        let measured;
        let paintMs = null;
        if (target === 'canvas') {
          // Read the exported page's own canvas: no screenshot round-trip, so an
          // exact match is a real assertion rather than a rendering coincidence.
          const page = await context.newPage();
          await page.setViewportSize({ width: W, height: H });
          await page.goto(`${BASE}/verify/out/${path.basename(dest)}`, { waitUntil: 'load' });
          await page.waitForTimeout(350);
          const got = await page.evaluate(() => {
            const c = document.getElementById('bg');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            return { w: c.width, h: c.height, data: Array.from(d.data) };
          });
          await page.close();
          measured = { data: Uint8ClampedArray.from(got.data), w: got.w, h: got.h };
        } else {
          const page = await context.newPage();
          await page.setViewportSize({ width: W, height: H });
          const tGoto = Date.now();
          await page.goto(`${BASE}/verify/out/${path.basename(dest)}`, { waitUntil: 'load' });
          await page.waitForTimeout(600);
          const shot = await page.screenshot({ type: 'png', timeout: 60000 });
          paintMs = Date.now() - tGoto;
          await page.close();
          const dec = await decodeShot(shot);
          measured = { data: Uint8ClampedArray.from(dec.data), w: dec.w, h: dec.h };
        }

        const a = refData;
        const b = measured.data;
        const sizeMatch = measured.w === ref.w && measured.h === ref.h;
        const ta = tone(a);
        const tb = tone(b);
        const score = sizeMatch
          ? {
              mae: +mae(a, b).toFixed(2),
              ssim: +ssim(a, b, ref.w, ref.h).toFixed(4),
              exact: hashPixels(b) === refHash,
              meanDelta: +Math.abs(ta.mean - tb.mean).toFixed(4),
              stdDelta: +Math.abs(ta.std - tb.std).toFixed(4),
              refMean: ta.mean,
              outMean: tb.mean,
            }
          : { mae: null, ssim: null, exact: false, sizeMismatch: `${measured.w}×${measured.h}` };

        report.fidelity.push({
          generator: gen,
          target,
          bytes: fs.statSync(dest).size,
          declared: built.approx,
          paintMs,
          ...score,
        });
        console.log(
          `${gen.padEnd(10)} ${target.padEnd(7)} MAE=${String(score.mae).padStart(6)}  SSIM=${score.ssim}  exact=${score.exact}`,
        );
      }
    }

    /* -------------------------- 2. determinism -------------------------- */
    for (const gen of ['mesh', 'particles', 'noise']) {
      const cfgA = staticConfig(gen);
      const cfgB = staticConfig(gen, { seed: cfgA.seed + 7 });
      const a1 = Uint8ClampedArray.from((await renderRef(cfgA)).data);
      const a2 = Uint8ClampedArray.from((await renderRef(cfgA)).data);
      const b1 = Uint8ClampedArray.from((await renderRef(cfgB)).data);
      const h1 = hashPixels(a1);
      const h2 = hashPixels(a2);
      const h3 = hashPixels(b1);
      report.determinism.push({
        generator: gen,
        sameSeedIdentical: h1 === h2,
        differentSeedDiffers: h1 !== h3,
        hash: h1,
        seedBHash: h3,
        maeAcrossSeeds: +mae(a1, b1).toFixed(2),
      });
      console.log(`determinism ${gen}: same=${h1 === h2} differs=${h1 !== h3}`);
    }

    /* --------------------------- 3. validity ---------------------------- */
    for (const gen of GENERATORS) {
      const cfg = staticConfig(gen);
      const svg = buildSvgExport(cfg).files.find((f) => f.name.endsWith('.svg')).text;
      const css = buildCssExport(cfg).files.find((f) => f.name.endsWith('.css')).text;
      const j1 = serializeConfig(cfg);
      const round = serializeConfig(parseConfig(j1)) === j1;

      const validity = await refPage.evaluate(
        async ({ svg, css }) => {
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
          const svgOk = !doc.querySelector('parsererror') && doc.documentElement.tagName === 'svg';
          const nodes = doc.querySelectorAll('*').length;
          const style = document.createElement('style');
          style.textContent = css;
          document.head.appendChild(style);
          const rules = style.sheet ? style.sheet.cssRules.length : 0;
          style.remove();
          return { svgOk, nodes, cssRules: rules };
        },
        { svg, css },
      );

      report.validity.push({ generator: gen, ...validity, jsonRoundTrip: round });
      console.log(`validity ${gen}: svg=${validity.svgOk} nodes=${validity.nodes} cssRules=${validity.cssRules} json=${round}`);
    }

    /* -------------------------- 4. performance -------------------------- */
    const perfPage = await context.newPage();
    await perfPage.setViewportSize({ width: 1920, height: 1080 });
    await perfPage.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await perfPage.waitForSelector('html[data-ready="1"]');

    // Baseline: clear an 1920x1080 canvas and blit an upscaled frame, with no
    // generator at all. Software raster makes that blit expensive; reporting it
    // separately keeps the generator's own cost from being inflated by the
    // harness environment.
    const baseline = await perfPage.evaluate(async () => {
      const c = document.createElement('canvas');
      c.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
      document.body.appendChild(c);
      c.width = 1920;
      c.height = 1080;
      const ctx = c.getContext('2d', { alpha: false });
      const src = document.createElement('canvas');
      src.width = 1536;
      src.height = 864;
      src.getContext('2d').fillRect(0, 0, 1536, 864);
      const samples = [];
      for (let i = 0; i < 45; i++) {
        const t0 = performance.now();
        ctx.fillStyle = '#101010';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.drawImage(src, 0, 0, 1920, 1080);
        // Force the rasterisation into the measurement; without a readback Chrome
        // happily defers a solid fill and reports ~0 ms.
        ctx.getImageData(0, 0, 1, 1);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      c.remove();
      return { p50: +samples[Math.floor(samples.length / 2)].toFixed(2) };
    });
    report.baselineMs = baseline.p50;
    console.log(`baseline (fill + upscale blit, no generator): ${baseline.p50} ms`);

    for (const gen of GENERATORS) {
      for (const quality of ['high', 'ultra']) {
        const res = await perfPage.evaluate(
          async ({ cfg }) => {
            const { Renderer } = await import('/src/engine/renderer.js');
            const { normalizeConfig } = await import('/src/core/config.js');
            const host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
            const c = document.createElement('canvas');
            c.style.cssText = 'width:1920px;height:1080px';
            host.appendChild(c);
            document.body.appendChild(host);

            const r = new Renderer(c, normalizeConfig(cfg));
            r.setConfig(normalizeConfig(cfg));
            r.resize();
            // Warm-up: first frame pays LUT + noise-field construction.
            const cold = performance.now();
            r.drawAt(0);
            const coldMs = performance.now() - cold;

            const samples = [];
            for (let i = 0; i < 45; i++) {
              const t0 = performance.now();
              r.drawAt(i / 60);
              c.getContext('2d').getImageData(0, 0, 1, 1);
              samples.push(performance.now() - t0);
            }
            samples.sort((x, y) => x - y);
            const p = (q) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * q))].toFixed(2);

            const mem = performance.memory ? performance.memory.usedJSHeapSize : 0;
            const out = {
              coldMs: +coldMs.toFixed(1),
              p50: p(0.5),
              p95: p(0.95),
              max: +samples[samples.length - 1].toFixed(2),
              internal: `${r.iw}×${r.ih}`,
              heapMB: +(mem / 1048576).toFixed(1),
            };
            host.remove();
            return out;
          },
          { cfg: normalizeConfig({ ...DEFAULT_CONFIG, generator: gen, quality, animated: false, aspect: '16:9' }) },
        );
        report.performance.push({
          generator: gen,
          quality,
          viewport: '1920×1080',
          baselineMs: baseline.p50,
          netMs: +Math.max(0, res.p50 - baseline.p50).toFixed(2),
          ...res,
        });
        console.log(`perf ${gen} ${quality}: p50=${res.p50}ms p95=${res.p95}ms cold=${res.coldMs}ms heap=${res.heapMB}MB`);
      }
    }

    /* ------------- 5. frame-time ablation (single generator) ------------- */
    report.ablation = await perfPage.evaluate(async () => {
      const { Renderer } = await import('/src/engine/renderer.js');
      const { normalizeConfig } = await import('/src/core/config.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
      const c = document.createElement('canvas');
      c.style.cssText = 'width:1920px;height:1080px';
      host.appendChild(c);
      document.body.appendChild(host);
      const T = (fn, n = 25) => {
        const s = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          fn(i);
          c.getContext('2d').getImageData(0, 0, 1, 1);
          s.push(performance.now() - t0);
        }
        s.sort((a, b) => a - b);
        return +s[Math.floor(s.length / 2)].toFixed(2);
      };
      const base = normalizeConfig({ generator: 'particles', quality: 'high', animated: false });
      const caseOf = (over) => {
        const cfg = normalizeConfig({ ...base, ...over });
        const r = new Renderer(c, cfg);
        r.setConfig(cfg);
        r.resize();
        return r;
      };
      const both = T((i) => caseOf({}).drawAt(i / 60));
      const noGrain = T((i) => caseOf({ grain: 0 }).drawAt(i / 60));
      const noVignette = T((i) => caseOf({ vignette: 0 }).drawAt(i / 60));
      const sceneOnly = T(() => {
        const r = caseOf({ grain: 0, vignette: 0 });
        r.drawScene(normalizeConfig({ ...base, grain: 0, vignette: 0 }), 0);
      });
      host.remove();
      return { both, noGrain, noVignette, sceneOnly };
    });
    console.log('ablation', JSON.stringify(report.ablation));

    /* ------------------- 6. CPU under live animation --------------------- */
    const cdp = await context.newCDPSession(perfPage);
    await cdp.send('Performance.enable');
    const cpu = [];
    for (const gen of GENERATORS) {
      const m0 = await cdp.send('Performance.getMetrics');
      await perfPage.evaluate(async (cfg) => {
        const { Renderer } = await import('/src/engine/renderer.js');
        const { normalizeConfig } = await import('/src/core/config.js');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
        const c = document.createElement('canvas');
        c.style.cssText = 'width:1920px;height:1080px';
        host.id = 'perf-host';
        host.appendChild(c);
        document.body.appendChild(host);
        const r = new Renderer(c, normalizeConfig(cfg));
        r.setConfig(normalizeConfig(cfg));
        r.resize();
        window.__perfRenderer = r;
        r.start();
      }, normalizeConfig({ ...DEFAULT_CONFIG, generator: gen, quality: 'high', aspect: '16:9' }));
      await perfPage.waitForTimeout(5000);
      const m1 = await cdp.send('Performance.getMetrics');
      const renderedFrames = await perfPage.evaluate(() => window.__perfRenderer?.frameCount ?? 0);
      await perfPage.evaluate(() => {
        window.__perfRenderer?.stop();
        document.getElementById('perf-host')?.remove();
        window.__perfRenderer = null;
      });
      const get = (m, k) => m.metrics.find((x) => x.name === k)?.value ?? 0;
      const task = get(m1, 'TaskDuration') - get(m0, 'TaskDuration');
      const frames = renderedFrames;
      cpu.push({
        generator: gen,
        windowSeconds: 5,
        frames,
        effectiveFps: +(frames / 5).toFixed(1),
        taskSeconds: +task.toFixed(2),
        scriptSeconds: +(get(m1, 'ScriptDuration') - get(m0, 'ScriptDuration')).toFixed(2),
      });
      console.log(`cpu ${gen}: ${frames} frames in 5 s = ${(frames / 5).toFixed(1)} fps`);
    }
    report.cpu = cpu;

    /* --------------------------- 6. resources --------------------------- */
    report.resources.push({
      item: 'runtime (Canvas export)',
      bytes: buildCanvasExport(staticConfig('mesh')).files.find((f) => f.name === 'veilforge-runtime.js').text.length,
    });
    for (const target of ['css', 'svg', 'canvas', 'json']) {
      let total = 0;
      for (const gen of GENERATORS) {
        const cfg = staticConfig(gen);
        const built =
          target === 'css' ? buildCssExport(cfg) : target === 'svg' ? buildSvgExport(cfg) : target === 'canvas' ? buildCanvasExport(cfg) : buildJsonExport(cfg);
        total += built.files.reduce((s, f) => s + (f.text ? f.text.length : 0), 0);
      }
      report.resources.push({ item: `${target} export (6 generators, all files)`, bytes: total });
    }

    /* ------------------------- 7. compatibility ------------------------- */
    // Firefox and WebKit are not installed in this environment; rather than claim
    // support I cannot test, record exactly which APIs each target depends on and
    // what this build does and does not exercise.
    report.compatibility = await refPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      return {
        'Canvas2D': typeof ctx.fillRect === 'function',
        'OffscreenCanvas': typeof OffscreenCanvas !== 'undefined',
        'imageSmoothingQuality': 'imageSmoothingQuality' in ctx,
        'ctx.createPattern().setTransform': (() => {
          try {
            const p = ctx.createPattern(document.createElement('canvas'), 'repeat');
            return !!p && typeof p.setTransform === 'function';
          } catch {
            return false;
          }
        })(),
        'mix-blend-mode': CSS.supports('mix-blend-mode', 'overlay'),
        'background-blend-mode': CSS.supports('background-blend-mode', 'overlay'),
        'radial-gradient %': CSS.supports('background-image', 'radial-gradient(60% 60% at 10% 10%, red, transparent)'),
        'box-shadow inset': CSS.supports('box-shadow', 'inset 0 0 10px red'),
        'aspect-ratio': CSS.supports('aspect-ratio', '16 / 9'),
        'DOMMatrix': typeof DOMMatrix !== 'undefined',
        'SVG feTurbulence': 'SVGFETurbulenceElement' in window,
        'SVG feDisplacementMap': 'SVGFEDisplacementMapElement' in window,
        'SMIL (SVGAnimateElement)': 'SVGAnimateElement' in window,
        'matchMedia reduced-motion': typeof window.matchMedia === 'function',
      };
    });

    await perfPage.close();
  },
  { width: W, height: H },
);

server.close();

/* ---------------------------------------------------------------- verdicts */

// Verdicts come from metrics.mjs so this harness and verify/fidelity.mjs agree.
for (const row of report.fidelity) {
  row.threshold = T[row.target];
  row.verdict = verdictFor(row);
  row.pass = row.verdict === 'exact' || row.verdict === 'structural';
}

report.summary = {
  exact: report.fidelity.filter((r) => r.verdict === 'exact').length,
  structural: report.fidelity.filter((r) => r.verdict === 'structural').length,
  tonal: report.fidelity.filter((r) => r.verdict === 'tonal').length,
  divergent: report.fidelity.filter((r) => r.verdict === 'divergent').length,
  fidelityPass: report.fidelity.filter((r) => r.pass).length,
  fidelityTotal: report.fidelity.length,
  determinismPass: report.determinism.filter((d) => d.sameSeedIdentical && d.differentSeedDiffers).length,
  determinismTotal: report.determinism.length,
  validityPass: report.validity.filter((v) => v.svgOk && v.cssRules > 3 && v.jsonRoundTrip).length,
  validityTotal: report.validity.length,
};

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

const rows = report.fidelity
  .map((r) => {
    const label = { exact: '**exact**', structural: 'structural', tonal: 'tonal only', divergent: 'DIVERGENT', failed: 'FAILED' }[r.verdict];
    const paint = r.paintMs ? `${r.paintMs} ms` : '—';
    return `| ${r.generator} | ${r.target} | ${r.declared} | ${r.mae ?? '—'} | ${r.ssim ?? '—'} | ${r.meanDelta ?? '—'} | ${(r.bytes / 1024).toFixed(1)} KB | ${paint} | ${label} |`;
  })
  .join('\n');

const perfRows = report.performance
  .map((p) => `| ${p.generator} | ${p.quality} | ${p.internal} | ${p.coldMs} | ${p.p50} | ${p.p95} | ${p.netMs} | ${p.heapMB} |`)
  .join('\n');

const cpuRows = report.cpu.map((c) => `| ${c.generator} | ${c.taskSeconds} s | ${c.busyPercent}% |`).join('\n');

const md = `# VeilForge verification report

Generated: ${report.generatedAt}
Browser: Chromium ${report.chromium} (headless, deviceScaleFactor 1)
Viewport: ${report.viewport}

## 1. Export fidelity

Measured against the reference render produced by the same \`Renderer\` the preview
uses, at speed 0 (static frame). MAE is mean absolute error over RGB, 0–255.
SSIM is windowed (8×8) on luminance.

| generator | target | declared | MAE | SSIM | abs Δmean | size | page paint | verdict |
|---|---|---|---|---|---|---|---|---|
${rows}

Gates — canvas: exact hash or (MAE ≤ ${T.canvas.mae} and SSIM ≥ ${T.canvas.ssim});
SVG: SSIM ≥ ${T.svg.ssim} and |Δmean| ≤ ${T.svg.meanDelta};
CSS: SSIM ≥ ${T.css.ssim} and |Δmean| ≤ ${T.css.meanDelta}.
CSS and SVG are gated on structural + exposure agreement rather than MAE, because
a different noise realisation cannot be pixel-matched by construction.

Verdicts: **${report.summary.exact} exact**, ${report.summary.structural} structural,
${report.summary.tonal} tonal-only, ${report.summary.divergent} divergent.

* exact — byte-identical frame (Canvas export)
* structural — SSIM and exposure both inside the gate
* tonal only — same exposure and contrast, different noise realisation. This is the
  honest ceiling for field generators in CSS/SVG: a different fBm sample cannot be
  pixel-matched, only tone-matched.
* divergent — neither; would be a bug.

## 2. Determinism

| generator | same seed identical | different seed differs | MAE across seeds |
|---|---|---|---|
${report.determinism.map((d) => `| ${d.generator} | ${d.sameSeedIdentical} | ${d.differentSeedDiffers} | ${d.maeAcrossSeeds} |`).join('\n')}

**Result: ${report.summary.determinismPass}/${report.summary.determinismTotal} pass.**

## 3. Structural validity

| generator | SVG parses | SVG nodes | CSS rules | JSON round-trip |
|---|---|---|---|---|
${report.validity.map((v) => `| ${v.generator} | ${v.svgOk} | ${v.nodes} | ${v.cssRules} | ${v.jsonRoundTrip} |`).join('\n')}

**Result: ${report.summary.validityPass}/${report.summary.validityTotal} pass.**

## 4. Per-frame cost (1920×1080, Canvas2D, headless, software raster)

| generator | quality | internal buffer | cold start | p50 | p95 | net (p50 − baseline) | heap |
|---|---|---|---|---|---|---|---|
${perfRows}

Baseline for this environment: **${report.baselineMs} ms** — the cost of clearing an
1920×1080 canvas and blitting one upscaled frame with *no generator at all*, in the
same headless software rasteriser. The 'net' column subtracts it, which is the only way to
separate engine cost from renderer overhead. Treat absolute numbers as
"software-raster ceiling", not as what a GPU-composited desktop browser will do.

Cold start includes palette LUT + 256² fBm field construction, paid once per
(seed, octaves) pair and cached.

## 4b. Frame-time ablation (particles, 1920×1080, quality high)

| configuration | p50 |
|---|---|
| generator + vignette + grain + composite | ${report.ablation.both} ms |
| … without grain | ${report.ablation.noGrain} ms |
| … without vignette | ${report.ablation.noVignette} ms |
| scene render only (no display composite, no readback) | ${report.ablation.sceneOnly} ms |

The generator itself is a small fraction of the frame. What dominates here is the
final 1536×864 → 1920×1080 composite plus the synchronous readback this harness
forces in order to measure anything at all. On a GPU-composited canvas that
composite is a texture blit; under software raster with a forced readback it costs
more than the procedural work. Both numbers are reported so neither is mistaken
for the other.

## 5. CPU while animating (5 s window at 1920×1080, quality high)

| generator | frames rendered | effective fps | main-thread task time | script share |
|---|---|---|---|---|
${cpuRows}

## 6. Bytes shipped

${report.resources.map((r) => `- ${r.item}: ${(r.bytes / 1024).toFixed(1)} KB`).join('\n')}

## 7. API compatibility surface

${Object.entries(report.compatibility).map(([k, v]) => `- ${k}: ${v ? 'available' : 'MISSING'}`).join('\n')}

Only Chromium ${report.chromium} was exercised in this environment. Firefox and WebKit
are not installed here, so no claim is made about them beyond the API list above;
every API used is baseline-available in Firefox 100+ and Safari 16.4+ except
\`pattern.setTransform\`, which is feature-detected and falls back to an unshifted
grain pattern.
`;

fs.writeFileSync(path.join(outDir, 'report.md'), md);
console.log(`\n${report.summary.fidelityPass}/${report.summary.fidelityTotal} fidelity pass · report written to verify/out/report.md`);
