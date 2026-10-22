/**
 * Studio UI.
 *
 * Deliberately framework-free: the whole app is ~600 lines, loads with no build
 * step, and the only runtime dependency is the renderer itself. Controls are built
 * once and then synced, so dragging a slider never loses the pointer capture.
 */

import { Renderer } from '../engine/renderer.js';
import {
  DEFAULT_CONFIG,
  SLIDERS,
  ASPECTS,
  normalizeConfig,
  serializeConfig,
  decodeShareHash,
  encodeShareHash,
} from '../core/config.js';
import { GENERATORS, EXPORT_CAPABILITY } from '../generators/index.js';
import { PALETTES, PRESETS, paletteById, randomPalette } from '../core/presets.js';
import { buildExport, TARGETS } from '../export/index.js';
import { RASTER_PRESETS } from '../export/raster.js';
import { makeRng } from '../core/rng.js';
import { el, clear, downloadFile, copyText, toast, formatBytes } from './dom.js';

const STORE_KEY = 'veilforge.presets.v1';
const SLIDER_ORDER = ['speed', 'density', 'direction', 'intensity', 'scale', 'grain', 'vignette', 'blur'];

export function createApp(root) {
  const state = {
    config: initialConfig(),
    target: 'css',
    paused: false,
    result: null,
    rasterSize: '1920×1080',
    rasterFormat: 'image/png',
    activePane: 'params',
  };

  const refs = { sliders: {}, palette: [], seg: {} };

  /* ---------------------------------------------------------------- layout */

  const canvas = el('canvas', { id: 'preview', 'aria-label': 'Background preview' });
  const hud = el('div', { class: 'hud' });
  const rail = el('nav', { class: 'rail', 'aria-label': 'Generators' });
  const paramsPane = el('div', { class: 'pane', 'data-pane': 'params' });
  const palettePane = el('div', { class: 'pane', 'data-pane': 'palette' });
  const exportPane = el('div', { class: 'pane', 'data-pane': 'export' });
  const statusbar = el('footer', { class: 'statusbar' });
  const frame = el('div', { class: 'frame' }, canvas);
  const stage = el('section', { class: 'stage' }, frame, hud);

  const seedInput = el('input', { type: 'number', class: 'input seed-input', min: '1', step: '1', 'aria-label': 'Seed' });
  const aspectSelect = el('select', { class: 'input', 'aria-label': 'Aspect ratio' },
    ...Object.keys(ASPECTS).map((k) => el('option', { value: k }, k)));
  const qualitySelect = el('select', { class: 'input', 'aria-label': 'Quality' },
    ...['auto', 'low', 'medium', 'high', 'ultra'].map((k) => el('option', { value: k }, k)));
  const animToggle = el('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Animate' });

  const shell = el('div', { class: 'app-shell' });
  root.append(shell);
  shell.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }, 'V'),
        el('span', { class: 'name' }, 'VeilForge'),
        el('span', { class: 'tag' }, 'studio')),
      el('div', { class: 'topbar-actions' },
        el('button', { class: 'btn', id: 'btn-random', title: 'R (randomize)' }, 'Randomize'),
        el('button', { class: 'btn', id: 'btn-reset', title: 'Reset to defaults' }, 'Reset'),
        el('button', { class: 'btn', id: 'btn-save' }, 'Save preset'),
        el('button', { class: 'btn', id: 'btn-load' }, 'Load'),
        el('button', { class: 'btn primary', id: 'btn-export' }, 'Export')),
    ),
    el('div', { class: 'body' },
      rail,
      stage,
      el('aside', { class: 'inspector' },
        el('div', { class: 'tabs', role: 'tablist' },
          ...[['params', 'Parameters'], ['palette', 'Palette'], ['export', 'Export']].map(([id, label]) =>
            el('button', { class: 'tab', role: 'tab', 'data-tab': id, id: `tab-${id}` }, label))),
        el('div', { class: 'panes' }, paramsPane, palettePane, exportPane))),
    statusbar,
  );

  const renderer = new Renderer(canvas, state.config);
  renderer.onStats = (s) => updateStatus(s);

  /* ------------------------------------------------------------------ rail */

  function buildRail() {
    clear(rail);
    for (const gen of GENERATORS) {
      const btn = el('button', { class: 'rail-item', 'data-gen': gen.id, title: gen.blurb },
        el('span', { class: 'rail-dot' }),
        el('span', { class: 'rail-label' }, gen.label));
      btn.addEventListener('click', () => {
        state.config = normalizeConfig({ ...state.config, generator: gen.id });
        renderer.setConfig(state.config);
        renderer.drawAt(0);
        syncAll();
        markExportDirty();
      });
      rail.appendChild(btn);
    }
  }

  /* -------------------------------------------------------------- params */

  function buildParams() {
    clear(paramsPane);

    const row = (label, control, hint) =>
      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, label),
        control,
        hint ? el('span', { class: 'field-hint' }, hint) : null);

    for (const key of SLIDER_ORDER) {
      const spec = SLIDERS[key];
      const out = el('output', { class: 'val' });
      const input = el('input', {
        type: 'range', class: 'range', 'data-key': key,
        min: String(spec.min), max: String(spec.max), step: String(spec.step),
        'aria-label': spec.label,
      });
      input.addEventListener('input', () => {
        state.config = normalizeConfig({ ...state.config, [key]: Number(input.value) });
        out.textContent = fmt(key, state.config[key]);
        renderer.setConfig(state.config);
        renderer.drawAt(0);
        markExportDirty();
        updateStatus();
      });
      const wrap = el('div', { class: 'slider-row' }, input, out);
      refs.sliders[key] = { input, out };
      paramsPane.appendChild(
        el('div', { class: 'field' },
          el('div', { class: 'field-head' },
            el('span', { class: 'field-label' }, spec.label),
            el('span', { class: 'field-hint' }, spec.hint)),
          wrap),
      );
    }

    // Seed + dice
    seedInput.addEventListener('change', () => {
      state.config = normalizeConfig({ ...state.config, seed: Number(seedInput.value) || 1 });
      renderer.setConfig(state.config);
      renderer.drawAt(0);
      updateStatus();
      markExportDirty();
    });
    const dice = el('button', { class: 'btn icon', title: 'New seed' }, '⟳');
    dice.addEventListener('click', () => {
      state.config = normalizeConfig({ ...state.config, seed: randomSeed() });
      renderer.setConfig(state.config);
      renderer.drawAt(0);
      syncAll();
      markExportDirty();
    });

    paramsPane.appendChild(
      el('div', { class: 'section-head' }, 'Identity'),
      el('div', { class: 'field' },
        el('div', { class: 'field-head' }, el('span', { class: 'field-label' }, 'Seed')),
        el('div', { class: 'row' }, seedInput, dice)),
      el('div', { class: 'field' },
        el('div', { class: 'field-head' }, el('span', { class: 'field-label' }, 'Aspect')), aspectSelect),
      el('div', { class: 'field' },
        el('div', { class: 'field-head' }, el('span', { class: 'field-label' }, 'Render quality')),
        qualitySelect),
      el('div', { class: 'field inline' },
        el('span', { class: 'field-label' }, 'Animate'), animToggle),
      el('div', { class: 'preset-grid', id: 'presets' }),
    );

    aspectSelect.addEventListener('change', () => {
      state.config = normalizeConfig({ ...state.config, aspect: aspectSelect.value });
      applyAspect();
      renderer.drawAt(0);
      markExportDirty();
    });
    qualitySelect.addEventListener('change', () => {
      state.config = normalizeConfig({ ...state.config, quality: qualitySelect.value });
      renderer.setConfig(state.config);
      renderer.drawAt(0);
    });
    animToggle.addEventListener('change', () => {
      state.config = normalizeConfig({ ...state.config, animated: animToggle.checked });
      if (state.config.animated) {
        state.paused = false;
        renderer.start();
      } else {
        renderer.stop();
        renderer.drawAt(0);
      }
      updateStatus();
    });

    buildPresetGrid();
  }

  function buildPresetGrid() {
    const grid = paramsPane.querySelector('#presets');
    if (!grid) return;
    clear(grid);
    grid.appendChild(el('div', { class: 'section-head tight' }, 'Presets'));
    const wrap = el('div', { class: 'chips' });
    for (const preset of PRESETS) {
      const b = el('button', { class: 'chip', title: preset.name }, preset.name);
      b.addEventListener('click', () => applyPreset(preset));
      wrap.appendChild(b);
    }
    grid.appendChild(wrap);
  }

  /* ------------------------------------------------------------- palette */

  function buildPalette() {
    clear(palettePane);
    palettePane.appendChild(el('div', { class: 'section-head' }, 'Palette'));
    const list = el('div', { class: 'palette-list' });
    refs.palette = [];

    for (let i = 0; i < 5; i++) {
      const input = el('input', { type: 'color', class: 'color-input', 'aria-label': `Colour ${i + 1}` });
      const hex = el('input', { type: 'text', class: 'input hex', maxlength: '9', spellcheck: 'false' });
      input.addEventListener('input', () => {
        state.config.palette[i] = input.value;
        hex.value = input.value;
        commitPalette();
      });
      hex.addEventListener('change', () => {
        const v = hex.value.trim();
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          hex.value = state.config.palette[i];
          return;
        }
        state.config.palette[i] = v;
        input.value = v;
        commitPalette();
      });
      refs.palette.push({ input, hex });
      list.appendChild(el('div', { class: 'palette-row' }, input, hex));
    }

    const add = el('button', { class: 'btn small' }, '+ Add stop');
    add.addEventListener('click', () => {
      if (state.config.palette.length >= 6) return toast('Six stops is the practical maximum', 'warn');
      state.config.palette.push(state.config.palette[state.config.palette.length - 1]);
      buildPalette();
      syncPalette();
      commitPalette();
    });
    const remove = el('button', { class: 'btn small' }, '− Remove');
    remove.addEventListener('click', () => {
      if (state.config.palette.length <= 2) return toast('Two stops minimum', 'warn');
      state.config.palette.pop();
      buildPalette();
      syncPalette();
      commitPalette();
    });

    palettePane.appendChild(list);
    palettePane.appendChild(el('div', { class: 'row gap' }, add, remove));

    palettePane.appendChild(el('div', { class: 'section-head' }, 'Background'));
    const bg = el('input', { type: 'color', class: 'color-input wide' });
    bg.value = state.config.background;
    bg.addEventListener('input', () => {
      state.config.background = bg.value;
      commitPalette();
    });
    palettePane.appendChild(el('div', { class: 'palette-row' }, bg, el('span', { class: 'field-hint' }, 'Base under every layer')));

    palettePane.appendChild(el('div', { class: 'section-head' }, 'Curation'));
    const chips = el('div', { class: 'chips' });
    for (const p of PALETTES) {
      const b = el('button', { class: 'chip swatch', title: p.name },
        el('span', { class: 'swatch-dots' }, ...p.colors.slice(1).map((c) => el('i', { style: { background: c } }))),
        p.name);
      b.addEventListener('click', () => {
        state.config.palette = [...p.colors];
        state.config.background = p.background;
        syncPalette();
        commitPalette();
      });
      chips.appendChild(b);
    }
    palettePane.appendChild(chips);

    const gen = el('button', { class: 'btn' }, 'Generate harmonious palette');
    gen.addEventListener('click', () => {
      const p = randomPalette(randomSeed());
      state.config.palette = [...p.colors];
      state.config.background = p.background;
      syncPalette();
      commitPalette();
      toast('New palette — seed-locked', 'ok');
    });
    palettePane.appendChild(gen);
  }

  function syncPalette() {
    refs.palette.forEach((r, i) => {
      const c = state.config.palette[i] || '#000000';
      r.input.value = c;
      r.hex.value = c;
    });
    const bg = palettePane.querySelector('.color-input.wide');
    if (bg) bg.value = state.config.background;
  }

  function commitPalette() {
    state.config = normalizeConfig(state.config);
    renderer.setConfig(state.config);
    renderer.drawAt(0);
    updateStatus();
    markExportDirty();
  }

  /* -------------------------------------------------------------- export */

  let exportTimer = 0;
  function markExportDirty() {
    clearTimeout(exportTimer);
    exportTimer = setTimeout(() => {
      if (state.activePane === 'export') renderExport();
    }, 260);
  }

  /** Builds the export pane's static chrome. Named apart from the exporter it
   *  calls, because a same-named local would shadow the import inside createApp. */
  function buildExportPane() {
    clear(exportPane);
    const chips = el('div', { class: 'chips targets' });
    for (const t of TARGETS) {
      const b = el('button', { class: `chip target${state.target === t.id ? ' active' : ''}`, 'data-target': t.id, title: t.blurb }, t.label);
      b.addEventListener('click', () => {
        state.target = t.id;
        buildExportPane();
        renderExport();
      });
      chips.appendChild(b);
    }
    exportPane.appendChild(el('div', { class: 'section-head' }, 'Format'));
    exportPane.appendChild(chips);

    if (state.target === 'png') {
      const sizeSelect = el('select', { class: 'input' }, ...Object.keys(RASTER_PRESETS).map((k) => el('option', { value: k }, k)));
      sizeSelect.value = state.rasterSize;
      sizeSelect.addEventListener('change', () => {
        state.rasterSize = sizeSelect.value;
        renderExport();
      });
      const fmtSelect = el('select', { class: 'input' },
        el('option', { value: 'image/png' }, 'PNG'),
        el('option', { value: 'image/webp' }, 'WebP'),
        el('option', { value: 'image/jpeg' }, 'JPEG'));
      fmtSelect.value = state.rasterFormat;
      fmtSelect.addEventListener('change', () => {
        state.rasterFormat = fmtSelect.value;
        renderExport();
      });
      exportPane.appendChild(el('div', { class: 'row gap' }, sizeSelect, fmtSelect));
    }

    const out = el('div', { class: 'export-out', id: 'export-out' });
    exportPane.appendChild(out);
  }

  async function renderExport() {
    const out = exportPane.querySelector('#export-out');
    if (!out) return;
    clear(out);
    out.appendChild(el('div', { class: 'loading' }, 'Generating…'));

    try {
      const result = await buildExport(state.target, state.config, {
        renderer,
        origin: location.origin + location.pathname,
        raster: { size: state.rasterSize, format: state.rasterFormat },
      });
      state.result = result;
      clear(out);

      const cap = EXPORT_CAPABILITY[state.config.generator] || {};
      const declared = cap[state.target === 'png' ? 'canvas' : state.target];
      out.appendChild(
        el('div', { class: 'badge-row' },
          el('span', { class: `badge approx-${result.approx}` }, `fidelity: ${result.approx}`),
          declared && declared !== result.approx
            ? el('span', { class: 'badge muted' }, `generator ceiling: ${declared}`)
            : null),
      );

      if (result.notes?.length) {
        const ul = el('ul', { class: 'notes' });
        for (const n of result.notes) ul.appendChild(el('li', {}, n));
        out.appendChild(ul);
      }

      if (result.snippet) {
        const pre = el('pre', { class: 'code' }, result.snippet.length > 2600 ? result.snippet.slice(0, 2600) + '\n…' : result.snippet);
        const copy = el('button', { class: 'btn small' }, 'Copy');
        copy.addEventListener('click', async () => {
          const ok = await copyText(result.snippet);
          toast(ok ? 'Copied to clipboard' : 'Copy blocked by the browser', ok ? 'ok' : 'warn');
        });
        out.appendChild(el('div', { class: 'code-head' }, el('span', {}, 'Snippet'), copy));
        out.appendChild(pre);
      }

      const files = el('div', { class: 'files' });
      for (const f of result.files) {
        const size = f.blob ? f.blob.size : new Blob([f.text]).size;
        const btn = el('button', { class: 'file' },
          el('span', { class: 'file-name' }, f.name),
          el('span', { class: 'file-size' }, formatBytes(size)));
        btn.addEventListener('click', () => {
          if (f.blob) downloadFile(f.name, f.blob, f.mime);
          else downloadFile(f.name, f.text, f.mime);
          toast(`Saved ${f.name}`, 'ok');
        });
        files.appendChild(btn);
      }
      out.appendChild(el('div', { class: 'section-head tight' }, 'Files'));
      out.appendChild(files);

      const all = el('button', { class: 'btn primary wide' }, `Download all (${result.files.length})`);
      all.addEventListener('click', async () => {
        for (const f of result.files) {
          if (f.blob) downloadFile(f.name, f.blob, f.mime);
          else downloadFile(f.name, f.text, f.mime);
          await new Promise((r) => setTimeout(r, 220));
        }
        toast('All files saved', 'ok');
      });
      out.appendChild(all);
    } catch (err) {
      clear(out);
      out.appendChild(el('div', { class: 'error' }, `Export failed: ${err.message}`));
      console.error(err);
    }
  }

  /* ---------------------------------------------------------------- state */

  function initialConfig() {
    const fromHash = decodeShareHash(location.hash);
    return normalizeConfig(fromHash || DEFAULT_CONFIG);
  }

  function randomSeed() {
    return Math.floor(1 + Math.random() * 2 ** 31);
  }

  function applyPreset(preset) {
    const pal = paletteById(preset.palette);
    state.config = normalizeConfig({
      ...state.config,
      generator: preset.generator,
      palette: [...pal.colors],
      background: pal.background,
      ...preset.values,
    });
    renderer.setConfig(state.config);
    renderer.drawAt(0);
    syncAll();
    markExportDirty();
    toast(`${preset.name} applied`, 'ok');
  }

  function randomize() {
    const seed = randomSeed();
    const rng = makeRng(seed);
    const keepGen = rng.next() < 0.45;
    const gen = keepGen ? state.config.generator : rng.pick(GENERATORS).id;
    const pal = rng.next() < 0.45 ? rng.pick(PALETTES) : randomPalette(seed ^ 0x9e37);
    state.config = normalizeConfig({
      ...state.config,
      generator: gen,
      seed,
      palette: [...pal.colors],
      background: pal.background,
      speed: +rng.range(0.14, 0.78).toFixed(2),
      density: +rng.range(0.28, 0.86).toFixed(2),
      direction: Math.round(rng.range(0, 360)),
      intensity: +rng.range(0.45, 0.93).toFixed(2),
      scale: +rng.range(0.75, 1.75).toFixed(2),
      grain: +rng.range(0.06, 0.32).toFixed(2),
      vignette: +rng.range(0.12, 0.5).toFixed(2),
      blur: +rng.range(0.18, 0.52).toFixed(2),
    });
    renderer.setConfig(state.config);
    renderer.drawAt(0);
    syncAll();
    markExportDirty();
  }

  function syncAll() {
    for (const key of SLIDER_ORDER) {
      const r = refs.sliders[key];
      if (!r) continue;
      r.input.value = String(state.config[key]);
      r.out.textContent = fmt(key, state.config[key]);
    }
    seedInput.value = String(state.config.seed);
    aspectSelect.value = state.config.aspect;
    qualitySelect.value = state.config.quality;
    animToggle.checked = state.config.animated;
    syncPalette();
    applyAspect();
    for (const btn of rail.querySelectorAll('.rail-item')) {
      btn.classList.toggle('active', btn.dataset.gen === state.config.generator);
    }
    updateStatus();
  }

  /** Fit the preview canvas inside the stage box at the chosen aspect ratio. */
  function applyAspect() {
    const aspect = ASPECTS[state.config.aspect] || 16 / 9;
    const availW = Math.max(80, frame.clientWidth);
    const availH = Math.max(60, frame.clientHeight);
    let w = availW;
    let h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
    renderer.resize();
  }

  function fmt(key, value) {
    if (key === 'direction') return `${Math.round(value)}°`;
    if (key === 'grain' || key === 'vignette' || key === 'blur' || key === 'density' || key === 'intensity' || key === 'speed') {
      return `${Math.round(value * 100)}%`;
    }
    return Number(value).toFixed(2);
  }

  function updateStatus(stats) {
    const s = stats || renderer.stats();
    clear(statusbar);
    const items = [
      ['generator', state.config.generator],
      ['seed', state.config.seed],
      ['fps', s.fps],
      ['draw', `${s.drawMsP50} ms`],
      ['p95', `${s.drawMsP95} ms`],
      ['buffer', s.internal],
      ['scale', `×${s.renderScale}`],
      ['heap', s.heapMB ? `${s.heapMB} MB` : '—'],
    ];
    for (const [k, v] of items) {
      statusbar.appendChild(el('span', { class: 'stat' }, el('b', {}, String(v)), el('i', {}, k)));
    }
  }

  function updateHud() {
    clear(hud);
    hud.appendChild(el('span', { class: 'hud-chip' }, `${state.config.generator}`));
    hud.appendChild(el('span', { class: 'hud-chip' }, `seed ${state.config.seed}`));
    const share = el('button', { class: 'hud-chip btn-ghost', title: 'Copy share link' }, 'copy link');
    share.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#${encodeShareHash(state.config)}`;
      const ok = await copyText(url);
      toast(ok ? 'Share link copied' : 'Copy blocked', ok ? 'ok' : 'warn');
    });
    hud.appendChild(share);
  }

  /* --------------------------------------------------------------- events */

  document.getElementById('btn-random').addEventListener('click', randomize);
  document.getElementById('btn-reset').addEventListener('click', () => {
    state.config = normalizeConfig(DEFAULT_CONFIG);
    renderer.setConfig(state.config);
    renderer.drawAt(0);
    syncAll();
    markExportDirty();
    toast('Reset to defaults');
  });
  document.getElementById('btn-save').addEventListener('click', savePreset);
  document.getElementById('btn-load').addEventListener('click', loadPreset);
  document.getElementById('btn-export').addEventListener('click', () => {
    showPane('export');
    renderExport();
  });

  function showPane(id) {
    state.activePane = id;
    for (const tab of root.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === id);
    for (const pane of root.querySelectorAll('.pane')) pane.classList.toggle('active', pane.dataset.pane === id);
    if (id === 'export') renderExport();
  }

  for (const tab of root.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showPane(tab.dataset.tab));
  }

  function savePreset() {
    const name = prompt('Preset name', `${state.config.generator} ${state.config.seed}`);
    if (!name) return;
    const all = readStore();
    all.unshift({ name, config: normalizeConfig(state.config), savedAt: Date.now() });
    localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(0, 40)));
    toast(`Saved “${name}”`, 'ok');
  }

  function loadPreset() {
    const all = readStore();
    const rows = all.map((p, i) => `${i + 1}. ${p.name}  ·  ${p.config.generator}  ·  seed ${p.config.seed}`).join('\n');
    const answer = prompt(`Saved presets (enter a number, or "import" to paste JSON):\n\n${rows || '(none yet)'}`, all.length ? '1' : 'import');
    if (!answer) return;
    if (answer.trim().toLowerCase() === 'import') {
      const text = prompt('Paste a VeilForge config JSON:');
      if (!text) return;
      try {
        state.config = normalizeConfig(JSON.parse(text));
      } catch {
        return toast('That is not valid JSON', 'warn');
      }
    } else {
      const idx = parseInt(answer, 10) - 1;
      if (!all[idx]) return toast('No preset at that index', 'warn');
      state.config = normalizeConfig(all[idx].config);
    }
    renderer.setConfig(state.config);
    renderer.drawAt(0);
    syncAll();
    markExportDirty();
    toast('Preset loaded', 'ok');
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') randomize();
    if (e.key === 'e' || e.key === 'E') {
      showPane('export');
      renderExport();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      state.paused = !state.paused;
      if (state.paused) {
        renderer.fixedTime = renderer.fixedTime ?? 0;
        renderer.stop();
        renderer.drawAt(0);
      } else {
        renderer.fixedTime = null;
        renderer.start();
      }
      toast(state.paused ? 'Paused at t=0' : 'Playing');
    }
    if (e.key === 's' || e.key === 'S') {
      downloadFile('veilforge-config.json', serializeConfig(state.config), 'application/json');
      toast('Config saved');
    }
  });

  /* ------------------------------------------------------------------ boot */

  buildRail();
  buildParams();
  buildPalette();
  buildExportPane();
  syncAll();
  updateHud();
  showPane('params');

  renderer.resize();
  renderer.drawAt(0);
  if (state.config.animated) renderer.start();

  window.addEventListener('resize', () => {
    applyAspect();
    if (!renderer.running) renderer.drawAt(0);
  });

  const statTimer = setInterval(() => updateStatus(), 800);

  return {
    state,
    renderer,
    destroy() {
      clearInterval(statTimer);
      renderer.stop();
    },
  };
}
