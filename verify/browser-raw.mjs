/** Chromium launcher shared by the inspection tools (no server assumption). */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function launch(options = {}) {
  const { chromium } = require('playwright');
  return chromium.launch({
    headless: true,
    args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none'],
    ...options,
  });
}
