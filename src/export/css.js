/**
 * CSS export.
 *
 * Constraints accepted up front: CSS has no per-pixel program, so this is a
 * *layered approximation*, not a transcription. What it can do is preserve
 * **geometry and tone**: positions, counts, radii, band direction and palette all
 * come from `layout.js`, the same module the canvas renderer reads. What it cannot
 * do is reproduce a specific noise realisation or a domain warp, so those are
 * stated as limitations instead of faked.
 *
 * Per generator:
 *   mesh      → one radial gradient per lattice anchor, at the real anchor position
 *   blobs     → one additive radial per blob, at the real blob position
 *   noise     → feTurbulence tile, `color`-blended onto the palette ramp
 *   flow      → blurred band gradient at the real band count and angle
 *   particles → one dot per particle, at the real particle position
 *   texture   → discrete-quantised turbulence, `color`-blended onto the ramp
 */

import { prepare, paletteVars, rampColors, dur, svgDataUri, PAGE_SHELL, rgbaStr } from './shared.js';
import { paletteToOklab, sampleOklabRamp, toHex } from '../core/color.js';
import { meshLayout, blobLayout, particleLayout, noiseParams, flowParams, textureParams } from '../generators/layout.js';

const TILE = 256;

/** Grayscale fBm / strata tile as an inline SVG data URI. */
function noiseTile({ freq, octaves = 3, size = TILE, seed = 1, quantise = 0, contrast = 1 }) {
  const table = quantise
    ? `<feComponentTransfer><feFuncR type="discrete" tableValues="${discreteTable(quantise)}"/><feFuncG type="discrete" tableValues="${discreteTable(quantise)}"/><feFuncB type="discrete" tableValues="${discreteTable(quantise)}"/></feComponentTransfer>`
    : `<feColorMatrix type="saturate" values="0"/>${contrast !== 1 ? `<feComponentTransfer><feFuncR type="linear" slope="${contrast}" intercept="${((1 - contrast) / 2).toFixed(3)}"/><feFuncG type="linear" slope="${contrast}" intercept="${((1 - contrast) / 2).toFixed(3)}"/><feFuncB type="linear" slope="${contrast}" intercept="${((1 - contrast) / 2).toFixed(3)}"/></feComponentTransfer>` : ''}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/>` +
    table +
    `</filter>` +
    `<rect width="${size}" height="${size}" filter="url(#f)"/>` +
    `</svg>`;
  return svgDataUri(svg);
}

function discreteTable(n) {
  const vals = [];
  for (let i = 0; i < n; i++) vals.push((i / (n - 1)).toFixed(3));
  return vals.join(' ');
}

function grainOverlay(cfg, sel = '.vf-grain') {
  if (cfg.grain <= 0.01) return '';
  return `
${sel} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: ${noiseTile({ freq: 0.85, octaves: 2, size: 160, seed: (cfg.seed % 97) + 1 })};
  background-size: 160px 160px;
  opacity: ${(cfg.grain * 0.5).toFixed(3)};
  mix-blend-mode: overlay;
  z-index: 3;
}`;
}

function baseBlock(cfg, extra = '') {
  const angle = `${cfg.direction}deg`;
  return `.vf-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  contain: paint;
  background-color: ${cfg.background};${cfg.vignette > 0.01
    ? `\n  box-shadow: inset 0 0 ${Math.round(26 + cfg.vignette * 44)}vmax ${rgbaStr('#000000', +(cfg.vignette * 0.62).toFixed(2))};`
    : ''}
  --vf-angle: ${angle};
${paletteVars(cfg)}
}${extra}`;
}

const keyframes = (name, body) => `@keyframes ${name} {\n${body}\n}`;

/** Palette sample at t∈[0,1] as hex — matches the renderer's ramp exactly. */
function rampAt(cfg, t) {
  return toHex(sampleOklabRamp(paletteToOklab(cfg.palette), t));
}

/* ------------------------------------------------------------------ mesh */

function meshCss(cfg) {
  const L = meshLayout(cfg);
  const cellR = (100 * 1.15) / L.cells;
  const layers = L.nodes.map((nd) => {
    const c = rampAt(cfg, nd.t);
    const x = (nd.x * 100).toFixed(2);
    const y = (nd.y * 100).toFixed(2);
    return `radial-gradient(circle ${cellR.toFixed(1)}vmax at ${x}% ${y}%, ${rgbaStr(c, 0.92)} 0%, ${rgbaStr(c, 0.45)} 38%, transparent 74%)`;
  });

  const ramp = rampColors(cfg, Math.min(5, Math.max(2, cfg.palette.length)));
  const blur = Math.round(16 + cfg.blur * 52);
  const d = dur(cfg, 26);
  const anim = d ? `\n  animation: vf-mesh ${d.toFixed(1)}s ease-in-out infinite alternate;` : '';
  const kf = d
    ? keyframes(
        'vf-mesh',
        `  0%   { transform: translate3d(-2.2%, -1.4%, 0) scale(1.1) rotate(-1.2deg); }
  100% { transform: translate3d(2.2%, 1.8%, 0) scale(1.16) rotate(1.4deg); }`,
      )
    : '';

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-layer {
  position: absolute;
  inset: -16%;
  background-image:
    ${layers.join(',\n    ')},
    linear-gradient(var(--vf-angle), ${ramp.join(', ')});
  filter: blur(${blur}px) saturate(1.06);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'medium',
    notes: [
      `All ${L.nodes.length} lattice anchors exported at their true positions (${L.cells}×${L.cells} cells), each with the ramp colour the renderer uses.`,
      'Bilinear interpolation and the noise warp become a soft blur + slow transform drift. Boundaries are rounder than the canvas version.',
    ],
  };
}

/* ----------------------------------------------------------------- blobs */

function blobsCss(cfg) {
  const L = blobLayout(cfg);
  const minDim = '100vmin';
  const layers = L.items.map((b) => {
    const c = cfg.palette[Math.min(cfg.palette.length - 1, b.colorIdx)];
    const a = +(b.alpha * (0.45 + cfg.intensity * 0.9)).toFixed(3);
    const r = (b.radius * (0.55 + cfg.scale * 0.7) * 100).toFixed(1);
    const x = (b.bx * 100).toFixed(2);
    const y = (b.by * 100).toFixed(2);
    return `radial-gradient(circle ${r}vmin at ${x}% ${y}%, ${rgbaStr(c, a)} 0%, ${rgbaStr(c, a * 0.5)} 38%, ${rgbaStr(c, a * 0.16)} 72%, transparent 100%)`;
  });

  const d = dur(cfg, 22);
  const anim = d ? `\n  animation: vf-float ${d.toFixed(1)}s ease-in-out infinite alternate;` : '';
  const kf = d
    ? keyframes(
        'vf-float',
        `  0%   { transform: translate3d(-2.6%, 1.6%, 0) scale(1.04); }
  50%  { transform: translate3d(1.8%, -2.6%, 0) scale(1.1); }
  100% { transform: translate3d(2.6%, 1.6%, 0) scale(1.03); }`,
      )
    : '';

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-layer {
  position: absolute;
  inset: -18%;
  background-image:
    ${layers.join(',\n    ')};
  mix-blend-mode: screen;
  filter: blur(${Math.round(8 + cfg.blur * 30)}px);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'high',
    notes: [
      `All ${L.count} light sources exported at their true positions, radii and palette colours.`,
      'mix-blend-mode: screen reproduces the additive bloom. The small white-hot cores are omitted — they are sub-pixel at typical sizes.',
    ],
  };
}

/* ----------------------------------------------------------------- noise */

function noiseCss(cfg) {
  const P = noiseParams(cfg);
  // Canvas samples P.freq texture tiles across the frame; the tile holds 4 lattice
  // cells, so the CSS tile must contain P.freq*4 cells stretched over 100%.
  const baseFreq = ((P.freq * 4) / TILE).toFixed(5);
  const tile = noiseTile({
    freq: baseFreq,
    octaves: P.octaves,
    size: TILE,
    seed: (cfg.seed % 251) + 1,
    contrast: 1.35,
  });
  const ramp = rampColors(cfg, 6);
  const d = dur(cfg, 34);
  const anim = d ? `\n  animation: vf-drift ${d.toFixed(1)}s linear infinite;` : '';
  const kf = d
    ? keyframes(
        'vf-drift',
        `  0%   { background-position: 0 0, 0 0; }
  100% { background-position: ${Math.round(TILE * 0.62)}px ${Math.round(TILE * 0.34)}px, 0 0; }`,
      )
    : '';

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-layer {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--vf-angle), ${ramp.join(', ')}),
    ${tile};
  background-size: 100% 100%, ${Math.round(100 / Math.max(0.2, P.freq))}% ${Math.round(100 / Math.max(0.2, P.freq))}%;
  background-blend-mode: color, normal;
  filter: contrast(${(0.85 + cfg.intensity * 0.85).toFixed(2)}) brightness(0.72);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'medium',
    notes: [
      'Feature scale, octave count and palette mapping are carried over (background-blend-mode: color applies the ramp to the turbulence luminance).',
      'feTurbulence is not the engine’s fBm realisation, so cloud shapes differ while density and tone match. Compare SSIM/tone figures in verify/out/report.md.',
    ],
  };
}

/* ------------------------------------------------------------------ flow */

function flowCss(cfg) {
  const P = flowParams(cfg);
  const ramp = rampColors(cfg, 4);
  const bands = Math.max(2, Math.round(P.bands * 2));
  const stops = [];
  for (let i = 0; i <= bands; i++) {
    stops.push(`${ramp[i % ramp.length]} ${((i / bands) * 100).toFixed(2)}%`);
  }
  const d = dur(cfg, 30);
  const anim = d ? `\n  animation: vf-flow ${d.toFixed(1)}s ease-in-out infinite alternate;` : '';
  const kf = d
    ? keyframes(
        'vf-flow',
        `  0%   { transform: rotate(-1.6deg) scale(1.14) translate3d(-1.6%, 0, 0); }
  100% { transform: rotate(1.6deg) scale(1.2) translate3d(1.6%, 0, 0); }`,
      )
    : '';

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-layer {
  position: absolute;
  inset: -26%;
  background-image:
    repeating-linear-gradient(var(--vf-angle), ${stops.join(', ')});
  filter: blur(${Math.round(20 + cfg.blur * 44)}px) saturate(1.12) brightness(0.78);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'low',
    notes: [
      `Band count (${Math.round(P.bands)} cycles across the frame) and direction carried over from the renderer.`,
      'CSS bands are straight before blur; the canvas folds them with a noise phase warp, so expect a calmer, more regular flow.',
    ],
  };
}

/* ------------------------------------------------------------- particles */

function particlesCss(cfg) {
  const L = particleLayout(cfg);
  const max = 56;
  const step = Math.max(1, Math.ceil(L.count / max));
  const picked = L.items.filter((_, i) => i % step === 0);
  const scaleFactor = 0.7 + cfg.scale * 0.55;

  const dots = picked.map((p) => {
    const c = cfg.palette[Math.min(cfg.palette.length - 1, p.colorIdx)];
    const r = Math.max(0.35, (p.size * scaleFactor) / 300 * 100).toFixed(2);
    const a = (0.5 + Math.min(0.5, p.size / 3)).toFixed(2);
    return `radial-gradient(circle at ${(p.bx * 100).toFixed(2)}% ${(p.by * 100).toFixed(2)}%, ${rgbaStr(c, +a)} 0 ${r}vmin, transparent ${(r * 2.4).toFixed(2)}vmin)`;
  });

  const d = dur(cfg, 40);
  const dx = (Math.cos((cfg.direction * Math.PI) / 180) * 7).toFixed(1);
  const dy = (Math.sin((cfg.direction * Math.PI) / 180) * 7).toFixed(1);
  const anim = d ? `\n  animation: vf-motes ${d.toFixed(1)}s ease-in-out infinite alternate;` : '';
  const kf = d
    ? keyframes(
        'vf-motes',
        `  0%   { transform: translate3d(0, 0, 0); }
  100% { transform: translate3d(${dx}%, ${dy}%, 0); }`,
      )
    : '';

  const c1 = cfg.palette[1] || cfg.palette[0];
  const c2 = cfg.palette[2] || c1;
  const wash = `radial-gradient(78vmax 78vmax at 46% 40%, ${rgbaStr(c2, +(0.2 + cfg.intensity * 0.34).toFixed(3))} 0%, ${rgbaStr(c1, +(0.13 + cfg.intensity * 0.2).toFixed(3))} 55%, ${rgbaStr(c1, 0)} 100%)`;

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-wash {
  position: absolute;
  inset: 0;
  background-image: ${wash};
  z-index: 0;
}
.vf-bg > .vf-layer {
  position: absolute;
  inset: -10%;
  background-image:
    ${dots.join(',\n    ')};
  filter: blur(${(cfg.blur * 1.4).toFixed(2)}px);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-wash"></div><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'high',
    notes: [
      `${picked.length} of ${L.count} motes exported (every ${step === 1 ? '1st' : `${step}th`}), each at its true seeded position — past ~56 gradients per layer the CSS raster cost outruns a canvas.`,
      'Motion is one group translation: per-mote velocity, per-mote wobble and motion streaks are not expressible without JavaScript. Use the Canvas export when motion fidelity matters.',
    ],
  };
}

/* --------------------------------------------------------------- texture */

function textureCss(cfg) {
  const P = textureParams(cfg);
  const strata = Math.max(3, Math.round(P.strata));
  const baseFreq = ((P.freq * 4) / TILE).toFixed(5);
  const tile = noiseTile({
    freq: baseFreq,
    octaves: 4,
    size: TILE,
    seed: (cfg.seed % 199) + 1,
    quantise: strata,
  });
  const ramp = rampColors(cfg, 5);
  const d = dur(cfg, 44);
  const anim = d ? `\n  animation: vf-strata ${d.toFixed(1)}s ease-in-out infinite alternate;` : '';
  const kf = d
    ? keyframes(
        'vf-strata',
        `  0%   { background-position: 0 0, 0 0; }
  100% { background-position: ${Math.round(TILE * 0.18)}px ${Math.round(TILE * 0.1)}px, 0 0; }`,
      )
    : '';

  const css = `${baseBlock(cfg)}
.vf-bg > .vf-layer {
  position: absolute;
  inset: -6%;
  background-image:
    linear-gradient(var(--vf-angle), ${ramp.join(', ')}),
    ${tile};
  background-size: 100% 100%, ${Math.round(100 / Math.max(0.2, P.freq))}% ${Math.round(100 / Math.max(0.2, P.freq))}%;
  background-blend-mode: color, normal;
  filter: contrast(${(0.9 + cfg.intensity * 0.9).toFixed(2)}) brightness(0.6);${anim}
  z-index: 1;
}
${grainOverlay(cfg)}
${kf}`;

  return {
    css,
    body: '<div class="vf-bg"><div class="vf-layer"></div><div class="vf-grain"></div></div>',
    approx: 'low',
    notes: [
      `Strata count carried over exactly (${strata} discrete levels via feComponentTransfer).`,
      'feTurbulence uses a different gradient lattice than the engine’s ridged Perlin field, so folds differ while band frequency and direction match.',
    ],
  };
}

const CSS_BUILDERS = {
  mesh: meshCss,
  noise: noiseCss,
  blobs: blobsCss,
  flow: flowCss,
  particles: particlesCss,
  texture: textureCss,
};

export function buildCssExport(config) {
  const cfg = prepare(config);
  const builder = CSS_BUILDERS[cfg.generator] || meshCss;
  const out = builder(cfg);
  const title = `VeilForge · ${cfg.generator} · CSS`;

  const html = PAGE_SHELL(
    title,
    out.css,
    out.body,
    `<!-- Generated by VeilForge from config seed ${cfg.seed}. No JavaScript. -->`,
  );

  const snippet = `<!-- markup -->\n${out.body}\n\n<!-- styles -->\n<style>\n${out.css}\n</style>`;

  return {
    format: 'css',
    mime: 'text/css',
    approx: out.approx,
    notes: out.notes,
    files: [
      { name: `veilforge-${cfg.generator}.css`, mime: 'text/css', text: out.css },
      { name: `veilforge-${cfg.generator}.html`, mime: 'text/html', text: html },
    ],
    snippet,
    primary: `veilforge-${cfg.generator}.html`,
  };
}
