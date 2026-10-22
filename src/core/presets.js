/**
 * Curated palettes and preset looks.
 *
 * Palettes are ordered dark → light because every generator maps its scalar field
 * through the ramp: the first colour becomes shadow, the last becomes highlight.
 * Getting that order wrong is the single most common way a procedural background
 * ends up looking like mud.
 */

import { hslToHex } from '../core/color.js';
import { makeRng } from '../core/rng.js';

export const PALETTES = [
  {
    id: 'espresso',
    name: 'Espresso amber',
    background: '#0b0906',
    colors: ['#0b0906', '#2c1c12', '#6b3b1e', '#c8813c', '#f3d9a4'],
  },
  {
    id: 'midnight',
    name: 'Midnight violet',
    background: '#05060b',
    colors: ['#05060b', '#1b1436', '#3f2a6b', '#7d5bb5', '#c9b6f2'],
  },
  {
    id: 'glacier',
    name: 'Glacier',
    background: '#04080d',
    colors: ['#04080d', '#0d2030', '#1d4a63', '#4f9cb8', '#cfe9f2'],
  },
  {
    id: 'ember',
    name: 'Ember',
    background: '#0a0503',
    colors: ['#0a0503', '#2e1008', '#7a2410', '#cc5a24', '#f6b26b'],
  },
  {
    id: 'sage',
    name: 'Sage paper',
    background: '#070b08',
    colors: ['#070b08', '#16241a', '#33513a', '#71956f', '#dbe7c8'],
  },
  {
    id: 'mono',
    name: 'Monochrome',
    background: '#070707',
    colors: ['#070707', '#1c1c1c', '#454545', '#8f8f8f', '#efefef'],
  },
  {
    id: 'ink',
    name: 'Ink & rust',
    background: '#07080c',
    colors: ['#07080c', '#141a2b', '#333d5c', '#a8623f', '#f0d6b8'],
  },
  {
    id: 'orchid',
    name: 'Orchid dusk',
    background: '#08050c',
    colors: ['#08050c', '#25123a', '#5b2a63', '#b0528c', '#f2b9d8'],
  },
];

/**
 * Preset recipes. `overrides` is partial and gets normalized on load, so a preset
 * never needs to restate every field.
 */
export const PRESETS = [
  {
    id: 'aurora',
    name: 'Aurora veil',
    generator: 'mesh',
    palette: 'midnight',
    values: { speed: 0.32, density: 0.62, direction: 118, intensity: 0.78, scale: 1.15, grain: 0.18, vignette: 0.34, blur: 0.42, seed: 88213 },
  },
  {
    id: 'lampfall',
    name: 'Lampfall',
    generator: 'blobs',
    palette: 'espresso',
    values: { speed: 0.4, density: 0.58, direction: 210, intensity: 0.82, scale: 1.05, grain: 0.24, vignette: 0.42, blur: 0.36, seed: 4177 },
  },
  {
    id: 'sediment',
    name: 'Sediment',
    generator: 'texture',
    palette: 'ink',
    values: { speed: 0.12, density: 0.48, direction: 24, intensity: 0.62, scale: 1.35, grain: 0.26, vignette: 0.3, blur: 0.22, seed: 73120 },
  },
  {
    id: 'currents',
    name: 'Currents',
    generator: 'flow',
    palette: 'glacier',
    values: { speed: 0.26, density: 0.44, direction: 62, intensity: 0.7, scale: 1.25, grain: 0.12, vignette: 0.26, blur: 0.48, seed: 20481 },
  },
  {
    id: 'weather',
    name: 'Weather system',
    generator: 'noise',
    palette: 'sage',
    values: { speed: 0.18, density: 0.7, direction: 300, intensity: 0.55, scale: 1.4, grain: 0.2, vignette: 0.38, blur: 0.3, seed: 6621 },
  },
  {
    id: 'motes',
    name: 'Slow motes',
    generator: 'particles',
    palette: 'orchid',
    // Measured at contrast 0.086 with the first pass (intensity 0.55 / vignette 0.5):
    // a near-black frame. Raised so the preset actually shows the generator.
    values: { speed: 0.5, density: 0.58, direction: 248, intensity: 0.78, scale: 1.25, grain: 0.16, vignette: 0.3, blur: 0.3, seed: 9182 },
  },
  {
    id: 'kiln',
    name: 'Kiln',
    generator: 'mesh',
    palette: 'ember',
    values: { speed: 0.22, density: 0.72, direction: 155, intensity: 0.86, scale: 1, grain: 0.3, vignette: 0.44, blur: 0.38, seed: 3304 },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    generator: 'noise',
    palette: 'mono',
    values: { speed: 0.1, density: 0.55, direction: 0, intensity: 0.5, scale: 1.6, grain: 0.34, vignette: 0.3, blur: 0.26, seed: 5150 },
  },
];

export function paletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

/**
 * Generate a tasteful five-stop ramp from a random hue.
 * Constrained on purpose: saturations and lightness are fixed per stop, so random
 * output never lands on the neon-on-neon combination that reads as amateur.
 */
export function randomPalette(seed) {
  const rng = makeRng(seed >>> 0 || 1);
  const hue = rng.range(0, 360);
  const drift = rng.range(28, 78) * (rng.next() > 0.5 ? 1 : -1);
  const warm = rng.next() > 0.55;

  const stops = [
    { h: hue, s: 0.22, l: 0.035 },
    { h: hue + drift * 0.25, s: 0.42, l: 0.13 },
    { h: hue + drift * 0.55, s: 0.52, l: 0.32 },
    { h: hue + drift * 0.8, s: warm ? 0.58 : 0.46, l: 0.55 },
    { h: hue + drift, s: 0.34, l: 0.84 },
  ];

  const colors = stops.map((s) => hslToHex(s.h, s.s, s.l));
  return { id: 'random', name: 'Generated', background: colors[0], colors };
}
