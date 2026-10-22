/**
 * Raster export (PNG / WebP / JPEG).
 *
 * Uses Renderer.renderStill, which runs the real generator at the requested
 * resolution rather than upscaling the preview — so a 4K export is a true 4K
 * render, not a stretched 1600×900.
 */

import { prepare } from './shared.js';

export const RASTER_PRESETS = {
  '1920×1080': [1920, 1080],
  '2560×1440': [2560, 1440],
  '3840×2160': [3840, 2160],
  '1200×630': [1200, 630],
  '1080×1350': [1080, 1350],
  '1080×1920': [1080, 1920],
};

/**
 * @param {import('../engine/renderer.js').Renderer} renderer
 */
export async function buildRasterExport(renderer, config, { size = '1920×1080', format = 'image/png', quality = 0.92, time = 0.8 } = {}) {
  const cfg = prepare(config);
  const [w, h] = RASTER_PRESETS[size] || [1920, 1080];
  const canvas = renderer.renderStill(cfg, time, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
  if (!blob) throw new Error('Raster export failed: toBlob returned null');

  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
  return {
    format: 'raster',
    mime: format,
    approx: 'exact',
    notes: [
      `Rendered at ${w}×${h} from the generator, not upscaled from the preview.`,
      `${(blob.size / 1024).toFixed(0)} KB ${ext.toUpperCase()}.`,
    ],
    files: [{ name: `veilforge-${cfg.generator}-${w}x${h}.${ext}`, blob }],
    snippet: `// Programmatic equivalent:\n// renderer.renderStill(cfg, ${time}, ${w}, ${h}).toBlob(cb, '${format}', ${quality})`,
    primary: `veilforge-${cfg.generator}-${w}x${h}.${ext}`,
  };
}

export function buildPosterExport(renderer, config, { size = '1920×1080', time = 0.8 } = {}) {
  const cfg = prepare(config);
  const [w, h] = RASTER_PRESETS[size] || [1920, 1080];
  const canvas = renderer.renderStill(cfg, time, w, h);

  return {
    format: 'poster',
    mime: 'text/html',
    approx: 'exact',
    notes: ['Inline base64 still + the full config — a no-JS fallback page.'],
    files: [
      {
        name: `veilforge-${cfg.generator}-poster.html`,
        mime: 'text/html',
        text: `<!doctype html><html><head><meta charset="utf-8"><title>VeilForge poster</title>
<style>html,body{margin:0;height:100%;background:${cfg.background} }
img{width:100%;height:100%;object-fit:cover;display:block}</style></head>
<body><img alt="Generated background" src="${canvas.toDataURL('image/webp', 0.9)}"></body></html>`,
      },
    ],
    snippet: '<img src="data:image/webp;base64,…">',
    primary: `veilforge-${cfg.generator}-poster.html`,
  };
}
