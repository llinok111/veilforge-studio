/**
 * Shared helpers for the export targets.
 *
 * Everything here is pure: no DOM, no canvas. That lets the Node verification
 * harness generate the exact same files the browser's download button produces,
 * so the numbers in the report describe the bytes users actually get.
 */

import { effectiveConfig, normalizeConfig } from '../core/config.js';
import { parseHex, toHex, sampleOklabRamp, paletteToOklab } from '../core/color.js';
import { makeRng, hashSeed } from '../core/rng.js';

export function prepare(config) {
  const base = normalizeConfig(config);
  const cfg = effectiveConfig(base);
  return cfg;
}

export function rgbaStr(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function paletteVars(cfg) {
  return cfg.palette.map((hex, i) => `  --vf-c${i}: ${hex};`).join('\n');
}

/** Evenly spaced palette colours in OKLab, for gradients that need smooth ramps. */
export function rampColors(cfg, count = 5) {
  const labs = paletteToOklab(cfg.palette);
  const out = [];
  for (let i = 0; i < count; i++) out.push(toHex(sampleOklabRamp(labs, i / (count - 1))));
  return out;
}

/** Animation duration derived from speed: 0 speed means no animation at all. */
export function dur(cfg, baseSeconds) {
  if (cfg.speed <= 0.001) return null;
  const s = Math.max(0.08, cfg.speed);
  return Math.max(2.5, baseSeconds / s);
}

/** Encode an SVG document as a CSS url() data URI. */
export function svgDataUri(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
}

/** Deterministic RNG bound to a config + salt, matching the canvas layouts. */
export function exportRng(cfg, salt) {
  return makeRng(hashSeed(cfg.seed, `css-${salt}`, cfg.generator));
}

export const PAGE_SHELL = (title, css, bodyHtml, footer = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="generator" content="VeilForge">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #05060b; }
  body { overflow: hidden; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
${css}
</style>
</head>
<body>
${bodyHtml}
${footer}
</body>
</html>
`;
