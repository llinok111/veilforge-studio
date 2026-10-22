/**
 * Flowing colour.
 *
 * Domain warping again, but the output value is a phase, not a height: the noise
 * displaces the phase of a sine band function, so colour contours stretch and
 * fold like oil on water. A second harmonic at 2.02× breaks the periodicity that
 * makes pure sine bands look like a barcode.
 */

import { TAU } from '../core/color.js';
import { flowParams } from './layout.js';

export const flow = {
  id: 'flow',
  label: 'Flowing colour',
  blurb: 'Phase-warped colour bands folding like oil on water.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const warpField = kit.noiseField;
    const detailField = kit.noise(4);

    const P = flowParams(cfg);
    const freq = P.freq;
    const bands = P.bands;
    const warp = P.warp;
    const dir = (cfg.direction * Math.PI) / 180;
    const ca = Math.cos(dir);
    const sa = Math.sin(dir);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale * 0.8;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      const n1 = warpField.sample(u * freq + t * 0.02 * ca, v * freq + t * 0.02 * sa);
      const n2 = detailField.sample(
        u * P.detailFreq - t * 0.013 * sa + 0.21,
        v * P.detailFreq + t * 0.013 * ca + 0.63,
      );
      const w1 = (n1 - 0.5) * 2 * warp;
      const w2 = (n2 - 0.5) * 2 * warp * 0.26;

      // Band coordinate along `direction`.
      const along = (u * ca + v * sa) * bands;
      const phase = along * TAU + w1 * TAU + w2 * TAU * 0.5 + t * 0.9;

      let val = 0.5 + 0.5 * Math.sin(phase);
      val = val * 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(phase * 2.02 + 1.1));
      val = val < 0 ? 0 : val > 1 ? 1 : val;

      // Bias toward the palette's light end so bands read as light, not paint.
      const idx = (Math.pow(val, 1.15) * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};
