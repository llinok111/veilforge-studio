/**
 * Canvas / JS export.
 *
 * The exported file is not a re-implementation: it embeds the same Renderer and
 * generator modules the studio runs (flattened by tools/gen-runtime.mjs), plus the
 * config as a literal. Fidelity is therefore 100% by construction — and the
 * verification harness proves it by diffing frames pixel-for-pixel.
 */

import { prepare } from './shared.js';
import { serializeConfig } from '../core/config.js';
import { RUNTIME_SOURCE, RUNTIME_HASH } from './runtime-source.generated.js';

export function buildCanvasExport(config) {
  const cfg = prepare(config);
  const json = serializeConfig(cfg);
  const title = `VeilForge · ${cfg.generator}`;

  const usage = `// 1. Serve veilforge-runtime.js next to your page (or inline it).
// 2. Drop a canvas in and hand it a config.
const bg = VeilForge.mount('#bg', ${json.replace(/\n/g, '\n')});

// Live updates: bg.setConfig({ ...config, speed: 0.8 });
// Teardown:     bg.destroy();`;

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="generator" content="VeilForge ${RUNTIME_HASH}">
<style>
  html, body { margin: 0; height: 100%; background: ${cfg.background}; }
  #bg { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
  .vf-content { position: relative; z-index: 2; display: grid; place-items: center;
    height: 100%; color: #fff; font: 600 clamp(22px, 4vw, 54px)/1.15 system-ui, sans-serif;
    letter-spacing: -0.02em; text-align: center; padding: 5vw; text-wrap: balance;
    text-shadow: 0 2px 40px rgba(0,0,0,.55); }
  @media (prefers-reduced-motion: reduce) { /* engine already freezes via matchMedia */ }
</style>
</head>
<body>
<canvas id="bg" aria-hidden="true"></canvas>
<div class="vf-content">Your content sits here.<br>Drop it over the background.</div>
<script>
${RUNTIME_SOURCE}
</script>
<script>
(function () {
  var config = ${json};
  var host = document.getElementById('bg');
  var controller = window.VeilForge.mount(host, config);
  // Respect the user's motion preference even if the config says animate.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    controller.renderer.reducedMotion = true;
    controller.renderer.drawAt(0);
  }
})();
</script>
</body>
</html>
`;

  return {
    format: 'canvas',
    mime: 'text/html',
    approx: 'exact',
    notes: [
      `Pixel-identical to the studio preview: the export embeds the same engine (runtime ${RUNTIME_HASH}).`,
      'Ship the whole file as-is, or keep veilforge-runtime.js external and use the snippet below.',
      `${(RUNTIME_SOURCE.length / 1024).toFixed(1)} KB unminified, 0 dependencies.`,
    ],
    files: [
      { name: `veilforge-${cfg.generator}.html`, mime: 'text/html', text: page },
      { name: 'veilforge-runtime.js', mime: 'text/javascript', text: RUNTIME_SOURCE },
      { name: 'veilforge-config.json', mime: 'application/json', text: json },
    ],
    snippet: usage,
    primary: `veilforge-${cfg.generator}.html`,
  };
}

export { RUNTIME_HASH, RUNTIME_SOURCE };