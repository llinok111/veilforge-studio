/**
 * Generator registry.
 *
 * Adding a generator = adding one module with a `render(ctx, w, h, cfg, kit, t)`
 * and registering it here. Nothing else in the engine, the UI or the exporters
 * needs to know about it (the exporters fall back to a documented approximation).
 */

import { mesh } from './mesh.js';
import { noise } from './noisefield.js';
import { blobs } from './blobs.js';
import { flow } from './flow.js';
import { particles } from './particles.js';
import { texture } from './texture.js';

export const GENERATORS = [mesh, noise, blobs, flow, particles, texture];

export const GENERATOR_MAP = Object.fromEntries(GENERATORS.map((g) => [g.id, g]));

export function getGenerator(id) {
  return GENERATOR_MAP[id] || mesh;
}

/**
 * Declared fidelity per (generator, target), aligned with the measured SSIM bands
 * in verify/out/report.md:
 *
 *   exact  — the Canvas export re-runs the engine  (hash-identical)
 *   high   — SSIM >= 0.70 against the reference
 *   medium — SSIM 0.45 - 0.70
 *   low    — SSIM < 0.45; use it for a still-adjacent look, not for motion fidelity
 *
 * These are not marketing labels: the export panel shows them next to the download
 * button, and the harness checks the same generators every run.
 */
export const EXPORT_CAPABILITY = {
  mesh: { css: 'medium', svg: 'medium', canvas: 'exact' },
  noise: { css: 'medium', svg: 'medium', canvas: 'exact' },
  blobs: { css: 'high', svg: 'high', canvas: 'exact' },
  flow: { css: 'low', svg: 'low', canvas: 'exact' },
  particles: { css: 'high', svg: 'high', canvas: 'exact' },
  texture: { css: 'low', svg: 'low', canvas: 'exact' },
};
