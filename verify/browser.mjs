/**
 * Browser fixture.
 *
 * Playwright lives in the WorkBuddy-managed Node workspace, not in this project,
 * so resolution goes through createRequire + NODE_PATH instead of adding a
 * node_modules tree to the deliverable. Nothing here is needed to *use* VeilForge;
 * it exists only so the fidelity/perf claims in the report are machine-checked.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    console.error(
      'Playwright is not resolvable. Run with:\n' +
        '  NODE_PATH=/c/Users/<you>/.workbuddy/binaries/node/workspace/node_modules node verify/verify.mjs\n',
    );
    throw err;
  }
}

export async function withBrowser(fn, options = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none'],
    ...options.launch,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: options.width || 1440, height: options.height || 900 },
      deviceScaleFactor: 1,
      reducedMotion: options.reducedMotion || 'no-preference',
    });
    return await fn(context, browser);
  } finally {
    await browser.close();
  }
}
