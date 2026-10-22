/**
 * Standalone runtime entry.
 *
 * This file is never loaded by the studio. It exists solely as the root of the
 * flattened bundle handed to users who choose the Canvas export. Because it
 * imports the *same* Renderer and generators the studio uses, the exported
 * background is not a re-implementation — it is the engine.
 */

import { Renderer } from '../engine/renderer.js';
import { normalizeConfig } from '../core/config.js';
import { GENERATORS } from '../generators/index.js';

export const VERSION = '1.0.0';

/**
 * Mount a background on a canvas (or canvas selector).
 * @returns {{ renderer: Renderer, setConfig: Function, destroy: Function }}
 */
export function mount(target, config, options = {}) {
  const canvas = typeof target === 'string' ? document.querySelector(target) : target;
  if (!canvas) throw new Error(`VeilForge.mount: no element matched ${target}`);
  if (!canvas.getContext) throw new Error('VeilForge.mount: target is not a <canvas>');

  // A canvas with no CSS box renders at 300×150; give it the viewport by default.
  if (!canvas.style.width) canvas.style.width = '100%';
  if (!canvas.style.height) canvas.style.height = '100%';
  canvas.style.display = canvas.style.display || 'block';

  const cfg = normalizeConfig(config);
  const renderer = new Renderer(canvas, cfg);
  renderer.resize();
  renderer.drawAt(options.time ?? 0);
  if (cfg.animated && options.autoStart !== false) renderer.start();

  return {
    renderer,
    setConfig(next) {
      renderer.setConfig(normalizeConfig(next));
      renderer.drawAt(options.time ?? 0);
    },
    destroy() {
      renderer.stop();
    },
  };
}

export function listGenerators() {
  return GENERATORS.map((g) => g.id);
}

const api = { version: VERSION, mount, listGenerators };
if (typeof window !== 'undefined') window.VeilForge = api;
export default api;
