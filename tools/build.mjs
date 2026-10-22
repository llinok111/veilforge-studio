/**
 * Builds the single-file artefacts.
 *
 * Output:
 *   dist/veilforge.html          studio, one file, all modules inlined
 *   dist/demo.html               preset gallery, one file, runtime inlined
 *   dist/veilforge-runtime.js    (written by gen-runtime.mjs)
 *
 * Why a build at all: ES modules cannot be loaded from file:// (module CORS), and
 * "double-click the HTML" is a delivery requirement. The modular source stays the
 * authority; this just flattens it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, hashOf } from './bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const css = read('styles/app.css');
const html = read('index.html');

const appCode = bundle(path.join(root, 'src/main.js'));
const appHash = hashOf(appCode);

/**
 * A JS string that contains the literal close-script sequence terminates the host
 * <script> tag in the HTML parser, not at the end of the string. The Canvas
 * exporter embeds exactly such a template literal, so the sequence must be
 * escaped: the escaped form is the same string to the JS engine and no longer a
 * tag to the parser.
 */
const inlineSafe = (code) => code.replace(/<\/script/gi, '<\\/script');

let studio = html
  .replace('<link rel="stylesheet" href="./styles/app.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./src/main.js"></script>', `<script>\n${inlineSafe(appCode)}\n</script>`)
  .replace('<title>VeilForge — procedural background studio</title>', '<title>VeilForge — procedural background studio (single file)</title>');

if (studio.includes('src="./src/main.js"') || studio.includes('href="./styles/app.css"')) {
  throw new Error('build: failed to inline assets — index.html structure changed');
}
studio = studio.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<!-- built ${new Date().toISOString()} · app ${appHash} -->`);
fs.writeFileSync(path.join(outDir, 'veilforge.html'), studio);
// Pages serves dist/ as the site root, so the studio also needs an index entry.
fs.writeFileSync(path.join(outDir, 'index.html'), studio);

/* -------------------------------------------------------------------- demo */

// Import the real module rather than regex-parsing the source: presets.js is
// pure (no DOM), so Node can load it directly and the gallery can never drift
// from what the studio ships.
const { PRESETS: presetList, PALETTES: palettes } = await import('../src/core/presets.js');
const byId = Object.fromEntries(palettes.map((p) => [p.id, p]));

const cards = presetList
  .map((preset, i) => {
    const pal = byId[preset.palette] || palettes[0];
    const cfg = {
      generator: preset.generator,
      seed: preset.values.seed,
      palette: pal.colors,
      background: pal.background,
      ...preset.values,
      animated: true,
      aspect: '16:9',
    };
    return `    <button class="card" data-i="${i}" aria-label="Open ${preset.name} in the studio">
      <span class="card-canvas"><canvas data-cfg='${JSON.stringify(cfg)}'></canvas></span>
      <span class="card-meta">
        <span class="card-name">${preset.name}</span>
        <span class="card-sub">${preset.generator} · seed ${preset.values.seed}</span>
      </span>
    </button>`;
  })
  .join('\n');

const demo = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VeilForge — presets</title>
<meta name="description" content="Seeded procedural background presets rendered by the VeilForge engine.">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #0d0b09; color: #f0e7da;
    font: 14px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding: 54px 26px 26px; max-width: 1180px; margin: 0 auto; }
  h1 { margin: 0 0 8px; font-size: clamp(26px, 4vw, 40px); letter-spacing: -0.03em; font-weight: 680; }
  p.lede { margin: 0; max-width: 62ch; color: #a4968a; font-size: 15px; }
  .grid { display: grid; gap: 16px; padding: 26px; max-width: 1180px; margin: 0 auto;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .card { appearance: none; border: 1px solid #2b241e; background: #16120e; padding: 0;
    border-radius: 12px; overflow: hidden; cursor: pointer; text-align: left; color: inherit;
    transition: border-color 160ms ease, transform 160ms ease; display: block; }
  .card:hover, .card:focus-visible { border-color: #6b4a28; transform: translateY(-2px); outline: none; }
  .card-canvas { display: block; aspect-ratio: 16 / 9; background: #070605; }
  .card-canvas canvas { display: block; width: 100%; height: 100%; }
  .card-meta { display: flex; justify-content: space-between; align-items: baseline;
    gap: 10px; padding: 11px 13px; border-top: 1px solid #221c17; }
  .card-name { font-weight: 600; font-size: 13.5px; }
  .card-sub { font: 500 10.5px/1 ui-monospace, Menlo, monospace; color: #8d7f72; }
  footer { padding: 10px 26px 60px; max-width: 1180px; margin: 0 auto; color: #8d7f72;
    font: 12px/1.6 ui-monospace, Menlo, monospace; }
  a { color: #e0a354; }
  @media (prefers-reduced-motion: reduce) { .card { transition: none; } }
</style>
</head>
<body>
<header>
  <h1>VeilForge presets</h1>
  <p class="lede">Eight seeded recipes rendered live by the Canvas engine. Hover a card to
    animate it; click to load the exact config into the studio. Every frame here is
    reproducible from its seed alone.</p>
</header>
<main class="grid">
${cards}
</main>
<footer>Click any card to open it in <a href="./veilforge.html">the studio</a>. Engine runtime: VeilForge.</footer>
<script>
${inlineSafe(read('dist/veilforge-runtime.js'))}
</script>
<script>
(function () {
  var cards = [].slice.call(document.querySelectorAll('.card'));
  var live = new Map();

  function mount(card, animate) {
    var canvas = card.querySelector('canvas');
    var cfg = JSON.parse(canvas.dataset.cfg);
    var key = card.dataset.i;
    if (live.has(key)) {
      live.get(key).destroy();
      live.delete(key);
    }
    var ctl = window.VeilForge.mount(canvas, Object.assign({}, cfg, { animated: animate }), { autoStart: animate });
    live.set(key, ctl);
    return ctl;
  }

  // Static first frame for every card, animation only for the hovered one: eight
  // simultaneous rAF loops on a gallery page is a battery tax with no benefit.
  cards.forEach(function (card) { mount(card, false); });

  cards.forEach(function (card) {
    card.addEventListener('mouseenter', function () { mount(card, true); });
    card.addEventListener('focus', function () { mount(card, true); });
    card.addEventListener('mouseleave', function () {
      var ctl = live.get(card.dataset.i);
      if (ctl) { ctl.destroy(); live.delete(card.dataset.i); mount(card, false); }
    });
    card.addEventListener('click', function () {
      var cfg = JSON.parse(card.querySelector('canvas').dataset.cfg);
      var payload = { g: cfg.generator, s: (cfg.seed >>> 0).toString(36), p: cfg.palette, b: cfg.background,
        v: [cfg.speed, cfg.density, cfg.direction, cfg.intensity, cfg.scale, cfg.grain, cfg.vignette, cfg.blur]
          .map(function (n) { return Math.round(n * 1000); }), a: cfg.aspect };
      location.href = './veilforge.html#' + encodeURIComponent(JSON.stringify(payload));
    });
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'demo.html'), demo);

const kb = (s) => (s.length / 1024).toFixed(1);
console.log(`studio   dist/index.html          ${kb(studio)} KB  (app ${appHash})`);
console.log(`gallery  dist/demo.html           ${kb(demo)} KB`);
