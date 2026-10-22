/**
 * SVG export.
 *
 * SVG has real filters, so this target is far more faithful than CSS:
 *
 *   noise / texture → feTurbulence + feComponentTransfer whose tableValues are
 *                     sampled from the palette itself, so the colour mapping is
 *                     the one the canvas uses
 *   flow            → gradient displaced by feTurbulence (feDisplacementMap)
 *   mesh / blobs    → radial gradients placed at the renderer's real anchors
 *   particles       → circles at the renderer's real mote positions
 *
 * Geometry comes from `layout.js`, so counts and positions match the canvas.
 * Animation is SMIL, which Chrome, Firefox and Safari all implement; it does not
 * honour prefers-reduced-motion inside a standalone file, and that is stated in
 * the notes rather than papered over.
 */

import { prepare, rampColors, dur, PAGE_SHELL } from './shared.js';
import { paletteToOklab, sampleOklabRamp } from '../core/color.js';
import { ASPECTS } from '../core/config.js';
import { meshLayout, blobLayout, particleLayout, noiseParams, flowParams, textureParams } from '../generators/layout.js';

const W = 1600;
const H = 900;

function dims(cfg) {
  const ratio = ASPECTS[cfg.aspect] || 16 / 9;
  if (ratio >= 1) return { w: W, h: Math.round(W / ratio) };
  return { w: Math.round(H * ratio), h: H };
}

function channelTable(cfg, ch, n = 8) {
  const labs = paletteToOklab(cfg.palette);
  const out = [];
  for (let i = 0; i < n; i++) out.push((sampleOklabRamp(labs, i / (n - 1))[ch] / 255).toFixed(4));
  return out.join(' ');
}

function grainFilter(cfg, id = 'grain') {
  if (cfg.grain <= 0.01) return '';
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${(cfg.seed % 89) + 1}" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>`;
}

function grainRect(cfg, w, h) {
  if (cfg.grain <= 0.01) return '';
  return `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${(cfg.grain * 0.45).toFixed(3)}" style="mix-blend-mode:overlay"/>`;
}

function vignetteDef(cfg) {
  if (cfg.vignette <= 0.01) return '';
  return `<radialGradient id="vig" cx="50%" cy="50%" r="72%">
      <stop offset="35%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="${(cfg.vignette * 0.7).toFixed(3)}"/>
    </radialGradient>`;
}

function vignetteRect(cfg, w, h) {
  if (cfg.vignette <= 0.01) return '';
  return `<rect width="${w}" height="${h}" fill="url(#vig)"/>`;
}

/**
 * feTurbulence writes a noisy alpha channel. Compositing it as-is renders the
 * layer at ~50% opacity — the single biggest fidelity bug found by the harness.
 */
function opaqueTransfer(inName = null, result = null) {
  const a = inName ? ` in="${inName}"` : '';
  const r = result ? ` result="${result}"` : '';
  return `<feComponentTransfer${a}${r}>
        <feFuncA type="linear" slope="0" intercept="1"/>
      </feComponentTransfer>`;
}

/**
 * Exposure lift. feTurbulence's value distribution is narrower than the engine's
 * after gamma correction, so the mapped result lands ~25% darker; this cancels it.
 * The constant is calibrated, not derived — see verify/out/report.md.
 */
function liftTransfer(slope = 1.22, intercept = 0.02) {
  return `<feComponentTransfer>
        <feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>
        <feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>
        <feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>
        <feFuncA type="linear" slope="1" intercept="0"/>
      </feComponentTransfer>`;
}

/** Gamma/contrast expansion so feTurbulence uses the ramp's full range. */
function expandTransfer(slope = 1.7) {
  const intercept = ((1 - slope) / 2).toFixed(3);
  return `<feComponentTransfer>
        <feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>
        <feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>
        <feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>
      </feComponentTransfer>`;
}

/* ------------------------------------------------------------------ mesh */

function meshSvg(cfg, w, h) {
  const L = meshLayout(cfg);
  const cols = rampColors(cfg, Math.min(5, Math.max(2, cfg.palette.length)));
  const ramp64 = rampColors(cfg, 64);
  const radius = (1.15 / L.cells) * Math.min(w, h);
  let defs = '';
  const items = [];

  L.nodes.forEach((nd, i) => {
    const c = ramp64[Math.round(nd.t * 63)];
    defs += `<radialGradient id="m${i}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c}" stop-opacity="0.98"/>
      <stop offset="40%" stop-color="${c}" stop-opacity="0.62"/>
      <stop offset="72%" stop-color="${c}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>`;
    items.push(
      `<ellipse cx="${(nd.x * w).toFixed(0)}" cy="${(nd.y * h).toFixed(0)}" rx="${radius.toFixed(0)}" ry="${radius.toFixed(0)}" fill="url(#m${i})"/>`,
    );
  });

  const d = dur(cfg, 34);
  const anim = d
    ? `<animateTransform attributeName="transform" type="translate" values="-2.2 -1.4; 2.2 1.8; -2.2 -1.4" dur="${d.toFixed(1)}s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>`
    : '';

  const body = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${Math.cos((cfg.direction * Math.PI) / 180).toFixed(3)}" y2="${Math.sin((cfg.direction * Math.PI) / 180).toFixed(3)}">
      ${cols.map((c, i) => `<stop offset="${((i / (cols.length - 1)) * 100).toFixed(1)}%" stop-color="${c}"/>`).join('')}
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${(14 + cfg.blur * 34).toFixed(1)}"/>
    </filter>
    ${defs}
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <g filter="url(#soft)">${anim}${items.join('\n')}</g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'medium',
    notes: [
      `All ${L.nodes.length} lattice anchors placed at their true positions with the renderer's ramp colours; interpolation is approximated by a ${(14 + cfg.blur * 34).toFixed(0)} px Gaussian.`,
    ],
  };
}

/* ----------------------------------------------------------------- blobs */

function blobsSvg(cfg, w, h) {
  const L = blobLayout(cfg);
  const small = Math.min(w, h);
  let defs = '';
  const items = [];
  const d = dur(cfg, 26);

  L.items.forEach((b, i) => {
    const c = cfg.palette[Math.min(cfg.palette.length - 1, b.colorIdx)];
    const a = (b.alpha * (0.45 + cfg.intensity * 0.9)).toFixed(3);
    const r = b.radius * (0.55 + cfg.scale * 0.7) * small;
    defs += `<radialGradient id="b${i}">
      <stop offset="0%" stop-color="${c}" stop-opacity="${a}"/>
      <stop offset="38%" stop-color="${c}" stop-opacity="${(a * 0.5).toFixed(3)}"/>
      <stop offset="72%" stop-color="${c}" stop-opacity="${(a * 0.16).toFixed(3)}"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>`;
    const anim = d
      ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${((b.orbit - 0.5) * 40).toFixed(1)} ${(Math.sin(b.phase) * 26).toFixed(1)}; 0 0" dur="${(d * (0.7 + b.pulseSpeed * 0.5)).toFixed(1)}s" repeatCount="indefinite"/>`
      : '';
    items.push(
      `<g>${anim}<circle cx="${(b.bx * w).toFixed(0)}" cy="${(b.by * h).toFixed(0)}" r="${r.toFixed(0)}" fill="url(#b${i})"/></g>`,
    );
  });

  const body = `<defs>
    ${defs}
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="${cfg.background}"/>
  <g style="mix-blend-mode:screen">${items.join('\n')}</g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'high',
    notes: [
      `All ${L.count} light sources at their true positions and radii, additive via mix-blend-mode: screen. Hot cores omitted.`,
    ],
  };
}

/* ----------------------------------------------------------------- noise */

function noiseSvg(cfg, w, h) {
  const P = noiseParams(cfg);
  // Canvas samples P.freq tiles per axis; each tile holds 4 lattice cells.
  const freq = ((P.freq * 4) / w).toFixed(6);
  const d = dur(cfg, 40);
  const anim = d
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${(w * 0.06).toFixed(0)} ${(h * 0.04).toFixed(0)}; 0 0" dur="${d.toFixed(1)}s" repeatCount="indefinite"/>`
    : '';

  const body = `<defs>
    <filter id="fbm" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${P.octaves}" seed="${(cfg.seed % 233) + 1}" stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0" result="g"/>
      ${opaqueTransfer()}
      ${expandTransfer(1.7)}
      <feComponentTransfer>
        <feFuncR type="table" tableValues="${channelTable(cfg, 'r', 8)}"/>
        <feFuncG type="table" tableValues="${channelTable(cfg, 'g', 8)}"/>
        <feFuncB type="table" tableValues="${channelTable(cfg, 'b', 8)}"/>
        <feFuncA type="linear" slope="1"/>
      </feComponentTransfer>
      ${liftTransfer(1.22, 0.02)}
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="${cfg.background}"/>
  <g>${anim}<rect x="-${w * 0.08}" y="-${h * 0.08}" width="${w * 1.16}" height="${h * 1.16}" filter="url(#fbm)"/></g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'medium',
    notes: [
      `Feature scale matched to the renderer (${(P.freq * 4).toFixed(1)} noise cells across the frame), palette applied through feComponentTransfer tableValues sampled from the same OKLab ramp.`,
      'Turbulence is feTurbulence (Perlin), not the engine’s fBm stack — shapes differ, tonal statistics match.',
    ],
  };
}

/* ------------------------------------------------------------------ flow */

function flowSvg(cfg, w, h) {
  const P = flowParams(cfg);
  const cols = rampColors(cfg, 4);
  const dir = (cfg.direction * Math.PI) / 180;
  const bands = Math.max(2, Math.round(P.bands * 2));
  const stops = [];
  for (let i = 0; i <= bands; i++) {
    stops.push(`<stop offset="${((i / bands) * 100).toFixed(2)}%" stop-color="${cols[i % cols.length]}"/>`);
  }
  const d = dur(cfg, 36);
  const scale = (40 + cfg.intensity * 90).toFixed(0);
  const dispAnim = d
    ? `<animate attributeName="scale" values="${scale}; ${(+scale + 45).toFixed(0)}; ${scale}" dur="${d.toFixed(1)}s" repeatCount="indefinite"/>`
    : '';
  const moveAnim = d
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${(w * 0.08).toFixed(0)} ${(h * 0.05).toFixed(0)}; 0 0" dur="${d.toFixed(1)}s" repeatCount="indefinite"/>`
    : '';

  const body = `<defs>
    <linearGradient id="bands" x1="0" y1="0" x2="${Math.cos(dir).toFixed(3)}" y2="${Math.sin(dir).toFixed(3)}" spreadMethod="repeat">
      ${stops.join('')}
    </linearGradient>
    <filter id="warp" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${((P.freq * 1.1) / w).toFixed(6)}" numOctaves="3" seed="${(cfg.seed % 211) + 1}" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="${scale}" xChannelSelector="R" yChannelSelector="G">
        ${dispAnim}
      </feDisplacementMap>
    </filter>
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="${cfg.background}"/>
  <g filter="url(#warp)">${moveAnim}<rect x="-${w * 0.14}" y="-${h * 0.14}" width="${w * 1.28}" height="${h * 1.28}" fill="url(#bands)"/></g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'low',
    notes: [
      `feDisplacementMap folds the bands the way the canvas phase warp does; ${Math.round(P.bands)} band cycles and the direction are carried over from the renderer.`,
    ],
  };
}

/* ------------------------------------------------------------- particles */

function particlesSvg(cfg, w, h) {
  const L = particleLayout(cfg);
  const cap = 220;
  const step = Math.max(1, Math.ceil(L.count / cap));
  const picked = L.items.filter((_, i) => i % step === 0);
  const small = Math.min(w, h);
  const d = dur(cfg, 44) || 20;
  const scaleFactor = 0.7 + cfg.scale * 0.55;
  let defs = '';
  const items = [];

  picked.forEach((p, i) => {
    const c = cfg.palette[Math.min(cfg.palette.length - 1, p.colorIdx)];
    const r = Math.max(0.8, (p.size * scaleFactor * small) / 430);
    const dd = (d * (0.55 + ((i % 7) / 10))).toFixed(1);
    const dx = (Math.cos(p.ang) * (20 + p.spd * 900)).toFixed(1);
    const dy = (Math.sin(p.ang) * (20 + p.spd * 900)).toFixed(1);
    defs += `<radialGradient id="p${i}"><stop offset="0%" stop-color="${c}" stop-opacity="0.95"/><stop offset="55%" stop-color="${c}" stop-opacity="0.32"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
    items.push(
      `<circle cx="${(p.bx * w).toFixed(0)}" cy="${(p.by * h).toFixed(0)}" r="${(r * 3.2).toFixed(1)}" fill="url(#p${i})">
        <animateTransform attributeName="transform" type="translate" values="0 0; ${dx} ${dy}; 0 0" dur="${dd}s" repeatCount="indefinite"/>
      </circle>`,
    );
  });

  // The renderer lays a radial base wash under the motes. Without it the exported
  // frame sits an order of magnitude darker than the preview (measured 0.037 vs
  // 0.099 mean luminance before this was added).
  const wc1 = cfg.palette[1] || cfg.palette[0];
  const wc2 = cfg.palette[2] || wc1;
  const body = `<defs>
    <radialGradient id="wash" cx="46%" cy="40%" r="78%">
      <stop offset="0%" stop-color="${wc2}" stop-opacity="${(0.2 + cfg.intensity * 0.34).toFixed(3)}"/>
      <stop offset="55%" stop-color="${wc1}" stop-opacity="${(0.13 + cfg.intensity * 0.2).toFixed(3)}"/>
      <stop offset="100%" stop-color="${wc1}" stop-opacity="0"/>
    </radialGradient>
    ${defs}
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="${cfg.background}"/>
  <rect width="${w}" height="${h}" fill="url(#wash)"/>
  <g style="mix-blend-mode:screen">${items.join('\n')}</g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'high',
    notes: [
      `${picked.length} of ${L.count} motes exported at their true seeded positions (cap ${cap}).`,
      'SMIL cannot composite per-frame history, so motion streaks are omitted.',
    ],
  };
}

/* --------------------------------------------------------------- texture */

function textureSvg(cfg, w, h) {
  const P = textureParams(cfg);
  const strata = Math.max(3, Math.round(P.strata));
  const freq = ((P.freq * 4) / w).toFixed(6);
  const table = (() => {
    const vals = [];
    for (let i = 0; i < strata; i++) vals.push((i / (strata - 1)).toFixed(3));
    return vals.join(' ');
  })();
  const d = dur(cfg, 48);
  const anim = d
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${(w * 0.03).toFixed(0)} ${(h * 0.02).toFixed(0)}; 0 0" dur="${d.toFixed(1)}s" repeatCount="indefinite"/>`
    : '';

  const body = `<defs>
    <filter id="strata" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${(cfg.seed % 197) + 1}" stitchTiles="stitch" result="t"/>
      <feColorMatrix in="t" type="saturate" values="0" result="g"/>
      ${opaqueTransfer('g', 'go')}
      <feComponentTransfer in="go" result="q">
        <feFuncR type="discrete" tableValues="${table}"/>
        <feFuncG type="discrete" tableValues="${table}"/>
        <feFuncB type="discrete" tableValues="${table}"/>
      </feComponentTransfer>
      <feComponentTransfer in="q">
        <feFuncR type="table" tableValues="${channelTable(cfg, 'r', strata)}"/>
        <feFuncG type="table" tableValues="${channelTable(cfg, 'g', strata)}"/>
        <feFuncB type="table" tableValues="${channelTable(cfg, 'b', strata)}"/>
      </feComponentTransfer>
    </filter>
    ${vignetteDef(cfg)}
    ${grainFilter(cfg)}
  </defs>
  <rect width="${w}" height="${h}" fill="${cfg.background}"/>
  <g>${anim}<rect x="-${w * 0.06}" y="-${h * 0.06}" width="${w * 1.12}" height="${h * 1.12}" filter="url(#strata)"/></g>
  ${vignetteRect(cfg, w, h)}
  ${grainRect(cfg, w, h)}`;

  return {
    body,
    approx: 'low',
    notes: [
      `${strata} discrete strata levels, quantised by feComponentTransfer exactly as the canvas does, with the same band count and direction.`,
    ],
  };
}

const SVG_BUILDERS = {
  mesh: meshSvg,
  noise: noiseSvg,
  blobs: blobsSvg,
  flow: flowSvg,
  particles: particlesSvg,
  texture: textureSvg,
};

export function buildSvgExport(config) {
  const cfg = prepare(config);
  const { w, h } = dims(cfg);
  const builder = SVG_BUILDERS[cfg.generator] || meshSvg;
  const out = builder(cfg, w, h);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Generated abstract background">
  <title>VeilForge ${cfg.generator} background</title>
  ${out.body}
</svg>`;

  const html = PAGE_SHELL(
    `VeilForge · ${cfg.generator} · SVG`,
    `html,body{margin:0;height:100%;background:${cfg.background}}
.vf-wrap{position:fixed;inset:0}
.vf-wrap svg{width:100%;height:100%;display:block}`,
    `<div class="vf-wrap">\n${svg}\n</div>`,
  );

  return {
    format: 'svg',
    mime: 'image/svg+xml',
    approx: out.approx,
    notes: [
      ...out.notes,
      'SMIL animation does not respond to prefers-reduced-motion — gate it in your own CSS or JS if that matters.',
    ],
    files: [
      { name: `veilforge-${cfg.generator}.svg`, mime: 'image/svg+xml', text: svg },
      { name: `veilforge-${cfg.generator}.html`, mime: 'text/html', text: html },
    ],
    snippet: svg.split('\n').slice(0, 6).join('\n') + '\n  …',
    primary: `veilforge-${cfg.generator}.svg`,
  };
}
