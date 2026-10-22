/**
 * Export dispatcher.
 *
 * Every target returns the same shape, so the UI renders one panel and the
 * harness can iterate `['css','svg','canvas','json']` without special cases:
 *
 *   { format, mime, approx, notes[], files[{name,mime,text|blob}], snippet, primary }
 */

import { buildCssExport } from './css.js';
import { buildSvgExport } from './svg.js';
import { buildCanvasExport } from './canvasjs.js';
import { buildJsonExport } from './json.js';
import { buildRasterExport } from './raster.js';

export const TARGETS = [
  { id: 'css', label: 'CSS', blurb: 'Zero JS. Layered gradients + feTurbulence.' },
  { id: 'svg', label: 'SVG', blurb: 'Vector, filter-based, SMIL animation.' },
  { id: 'canvas', label: 'Canvas / JS', blurb: 'The engine itself. Pixel-identical.' },
  { id: 'png', label: 'PNG / WebP', blurb: 'True-resolution still render.' },
  { id: 'json', label: 'Config', blurb: 'Round-trippable recipe + share link.' },
];

export function buildExport(target, config, context = {}) {
  switch (target) {
    case 'css':
      return buildCssExport(config);
    case 'svg':
      return buildSvgExport(config);
    case 'canvas':
      return buildCanvasExport(config);
    case 'json':
      return buildJsonExport(config, context.origin);
    case 'png':
      return buildRasterExport(context.renderer, config, context.raster || {});
    default:
      throw new Error(`Unknown export target: ${target}`);
  }
}

export { buildCssExport, buildSvgExport, buildCanvasExport, buildJsonExport, buildRasterExport };
