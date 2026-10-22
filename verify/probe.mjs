/** Quick smoke probe: console errors, blank-canvas check, screenshot. */

import fs from 'node:fs';
import path from 'node:path';
import { withBrowser } from './browser.mjs';
import { createServer } from '../tools/serve.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'verify/out');
fs.mkdirSync(outDir, { recursive: true });

const server = createServer();
await new Promise((r) => server.listen(4321, '127.0.0.1', r));

const errors = [];
await withBrowser(async (context) => {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('http://127.0.0.1:4321/', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const c = document.getElementById('preview');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, Math.min(64, c.width), Math.min(64, c.height)).data;
    let min = 255, max = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      min = Math.min(min, v); max = Math.max(max, v); sum += v;
    }
    return {
      canvas: [c.width, c.height],
      css: [c.style.width, c.style.height],
      min, max, mean: +(sum / (d.length / 4)).toFixed(1),
      stats: window.__veilforge?.renderer?.stats?.(),
      generators: document.querySelectorAll('.rail-item').length,
      tabs: document.querySelectorAll('.tab').length,
    };
  });

  await page.screenshot({ path: path.join(outDir, 'probe-studio.png') });
  console.log(JSON.stringify(info, null, 2));
}, { width: 1600, height: 1000 });

server.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
