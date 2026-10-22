/**
 * Verifies the built artefacts the way a user consumes them: opened from
 * file://, with no server, no module loader and no network.
 *
 * This is the check that catches bundling regressions (a stray `export` keyword,
 * a missed import, a duplicated IIFE) which the dev-mode probe cannot see.
 */

import path from 'node:path';
import fs from 'node:fs';
import { withBrowser } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fileUrl = (p) => 'file:///' + path.join(root, p).replace(/\\/g, '/');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? `  ${extra}` : ''}`);
};

await withBrowser(async (context) => {
  /* ------------------------------------------------------------- studio */
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(fileUrl('dist/veilforge.html'), { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  ok(errors.length === 0, 'studio: no console/page errors', errors.slice(0, 2).join(' | '));

  const studio = await page.evaluate(() => {
    const c = document.getElementById('preview');
    if (!c) return { missing: true };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255;
    let max = 0;
    const buckets = new Set();
    for (let i = 0; i < d.length; i += 4 * 31) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      min = Math.min(min, l);
      max = Math.max(max, l);
      buckets.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
    }
    return {
      size: [c.width, c.height],
      contrast: +(max - min).toFixed(1),
      buckets: buckets.size,
      generators: document.querySelectorAll('.rail-item').length,
      sliders: document.querySelectorAll('.range').length,
      tabs: document.querySelectorAll('.tab').length,
      stats: window.__veilforge?.renderer?.stats?.(),
    };
  });

  ok(!studio.missing, 'studio: preview canvas exists');
  ok(studio.size?.[0] > 300 && studio.size?.[1] > 200, 'studio: canvas has a real backing size', JSON.stringify(studio.size));
  ok(studio.contrast > 20, 'studio: frame is not flat', `contrast=${studio.contrast}`);
  ok(studio.buckets > 40, 'studio: frame has colour variety', `buckets=${studio.buckets}`);
  ok(studio.generators === 6, 'studio: six generators in the rail');
  ok(studio.sliders === 8, 'studio: eight parameter sliders');
  ok(studio.tabs === 3, 'studio: three inspector tabs');

  /* ------------------------------------------------------------ exports */
  for (const target of ['css', 'svg', 'canvas', 'json']) {
    const res = await page.evaluate(async (t) => {
      const app = window.__veilforge;
      const btn = document.querySelector(`.chip.target[data-target="${t}"]`);
      if (!btn) return { missing: true };
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      const out = document.getElementById('export-out');
      const files = [...out.querySelectorAll('.file-name')].map((n) => n.textContent);
      const badge = out.querySelector('.badge')?.textContent || '';
      return { files, badge, hasCode: !!out.querySelector('pre.code') };
    }, target);
    ok(!res.missing, `export ${target}: panel renders`);
    ok(Array.isArray(res.files) && res.files.length >= 1, `export ${target}: file list populated`, (res.files || []).join(','));
    ok(!!res.badge, `export ${target}: fidelity badge shown`, res.badge);
  }

  /* randomise changes the frame */
  const before = await page.evaluate(() => window.__veilforge.state.config.seed);
  await page.click('#btn-random');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    seed: window.__veilforge.state.config.seed,
    contrast: (() => {
      const c = document.getElementById('preview');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4 * 37) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
      return +(max - min).toFixed(1);
    })(),
  }));
  ok(after.seed !== before, 'randomise: seed changed');
  ok(after.contrast > 15, 'randomise: resulting frame is still valid', `contrast=${after.contrast}`);

  await page.close();

  /* ------------------------------------------------------------ gallery */
  const demo = await context.newPage();
  const demoErrors = [];
  demo.on('pageerror', (e) => demoErrors.push(e.message));
  demo.on('console', (m) => {
    if (m.type() === 'error') demoErrors.push(m.text());
  });
  await demo.goto(fileUrl('dist/demo.html'), { waitUntil: 'load' });
  await demo.waitForTimeout(1500);

  ok(demoErrors.length === 0, 'gallery: no console/page errors', demoErrors.slice(0, 2).join(' | '));

  const gallery = await demo.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const painted = cards.filter((card) => {
      const c = card.querySelector('canvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4 * 29) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
      return max - min > 18;
    });
    return { cards: cards.length, painted: painted.length };
  });
  ok(gallery.cards === 8, 'gallery: eight presets');
  ok(gallery.painted === gallery.cards, 'gallery: every card painted a real frame', `${gallery.painted}/${gallery.cards}`);

  await demo.close();
}, { width: 1600, height: 1000 });

const sizes = ['dist/veilforge.html', 'dist/demo.html', 'dist/veilforge-runtime.js'].map((f) => {
  const p = path.join(root, f);
  return `${f}: ${(fs.statSync(p).size / 1024).toFixed(1)} KB`;
});
console.log(`\n${sizes.join('  ·  ')}`);
console.log(failures === 0 ? '\nALL BUILT-ARTEFACT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
