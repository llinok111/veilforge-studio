/**
 * Mesh gradient.
 *
 * A coarse lattice of colour anchors sampled from the palette, evaluated with
 * smoothstep-weighted bilinear interpolation and then domain-warped by a noise
 * field. The warp is what stops it reading as "four squares of colour": it makes
 * the anchor boundaries curve like light through frosted glass.
 *
 * Anchor positions, ramp samples and drift phases come from `meshLayout`, which
 * the CSS and SVG exporters read too — so an exported mesh gradient is anchored
 * to the same lattice, not to a similarly-sized random one.
 */

import { meshLayout } from './layout.js';

export const mesh = {
  id: 'mesh',
  label: 'Mesh gradient',
  blurb: 'Bicubic lattice of colour anchors, domain-warped and drifting.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const { palette, lut, noiseField } = kit;
    const t = time * cfg.speed;
    const L = meshLayout(cfg);

    // Pre-expanded anchor colours: the inner loop must not touch the LUT.
    const count = L.nodes.length;
    const colors = new Float64Array(count * 3);
    const phases = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const s = Math.round(L.nodes[i].t * 255) * 3;
      colors[i * 3] = lut[s];
      colors[i * 3 + 1] = lut[s + 1];
      colors[i * 3 + 2] = lut[s + 2];
      phases[i] = L.nodes[i].phase;
    }

    const dir = (cfg.direction * Math.PI) / 180;
    const driftX = Math.cos(dir) * L.drift * t;
    const driftY = Math.sin(dir) * L.drift * t;
    const n = L.n;
    const cells = L.cells;

    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      // ---- domain warp -------------------------------------------------
      const nx = noiseField.sample(u * L.freq + driftX, v * L.freq + driftY);
      const ny = noiseField.sample(u * L.freq + 5.7 + driftX, v * L.freq + 2.3 + driftY);
      let px = u + (nx - 0.5) * L.warp * 2;
      let py = v + (ny - 0.5) * L.warp * 2;

      px = px < 0 ? 0 : px > 1 ? 1 : px;
      py = py < 0 ? 0 : py > 1 ? 1 : py;

      // ---- lattice lookup ---------------------------------------------
      let ix = (px * cells) | 0;
      let iy = (py * cells) | 0;
      if (ix > cells - 1) ix = cells - 1;
      if (iy > cells - 1) iy = cells - 1;
      let fx = px * cells - ix;
      let fy = py * cells - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);

      const i00 = iy * n + ix;
      const i10 = i00 + 1;
      const i01 = i00 + n;
      const i11 = i01 + 1;

      // Slow per-anchor breathing keeps adjacent cells from settling.
      const b00 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i00]);
      const b10 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i10]);
      const b01 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i01]);
      const b11 = 0.82 + 0.18 * Math.sin(t * 1.1 + phases[i11]);

      const w00 = (1 - fx) * (1 - fy) * b00;
      const w10 = fx * (1 - fy) * b10;
      const w01 = (1 - fx) * fy * b01;
      const w11 = fx * fy * b11;
      const sum = w00 + w10 + w01 + w11 || 1;

      out[0] = (colors[i00 * 3] * w00 + colors[i10 * 3] * w10 + colors[i01 * 3] * w01 + colors[i11 * 3] * w11) / sum;
      out[1] =
        (colors[i00 * 3 + 1] * w00 + colors[i10 * 3 + 1] * w10 + colors[i01 * 3 + 1] * w01 + colors[i11 * 3 + 1] * w11) / sum;
      out[2] =
        (colors[i00 * 3 + 2] * w00 + colors[i10 * 3 + 2] * w10 + colors[i01 * 3 + 2] * w01 + colors[i11 * 3 + 2] * w11) / sum;
    });

    kit.field.blit(ctx, w, h);
  },
};
