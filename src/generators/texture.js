/**
 * Abstract texture.
 *
 * Ridged fBm sliced into quantised strata along `direction`: the ridged variant
 * produces creases (|noise| folded at zero), and quantising the result turns those
 * creases into the hard edges of marbled paper / sedimentary bands. A second,
 * finer slice at low weight keeps it from looking like a flat poster.
 */

import { textureParams } from './layout.js';

export const texture = {
  id: 'texture',
  label: 'Abstract texture',
  blurb: 'Ridged fBm quantised into marbled strata.',
  primary: 'density',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const ridged = kit.ridgedField;
    const grain = kit.noise(3);

    const P = textureParams(cfg);
    const freq = P.freq;
    const stretch = P.stretch;
    const strata = P.strata;
    const dir = (cfg.direction * Math.PI) / 180;
    const ca = Math.cos(dir);
    const sa = Math.sin(dir);
    const contrast = P.contrast;

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      // Rotate into strata space so `direction` actually rotates the bands.
      const rx = (u - 0.5) * ca + (v - 0.5) * sa + 0.5;
      const ry = -(u - 0.5) * sa + (v - 0.5) * ca + 0.5;

      const n = ridged.sample(rx * freq + t * 0.008, ry * freq * stretch + t * 0.004);
      const fine = grain.sample(rx * freq * 2.2 - t * 0.02, ry * freq * stretch * 2.2 + t * 0.01);

      // Quantise to strata, keep a little of the continuous value for depth.
      const q = Math.floor(n * strata) / strata;
      let val = q * 0.78 + n * 0.16 + fine * 0.06;
      val = 0.5 + (val - 0.5) * contrast;
      val = val < 0 ? 0 : val > 1 ? 1 : val;

      const idx = (val * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};
