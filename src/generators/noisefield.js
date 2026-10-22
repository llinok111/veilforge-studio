/**
 * Dynamic noise field.
 *
 * Two independently drifting samples of the same tileable fBm field are blended
 * (0.62 / 0.38) at different frequencies. A single drifting sample reads as
 * "sliding wallpaper"; the second octave stack incommensurate with the first
 * breaks the translation lock and reads as genuine turbulence.
 */

import { noiseParams } from './layout.js';

export const noise = {
  id: 'noise',
  label: 'Noise field',
  blurb: 'Tileable fBm turbulence, palette-mapped and evolving in place.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const P = noiseParams(cfg);
    const t = time * cfg.speed;
    const main = kit.noiseField;
    const fallback = P.octaves !== main.octaves ? kit.noise(P.octaves) : main;

    const dir = (cfg.direction * Math.PI) / 180;
    const vx = Math.cos(dir);
    const vy = Math.sin(dir);
    const drift = t * P.drift;

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const fs = kit.fieldScale * 0.85;
    kit.field.ensure(Math.max(2, Math.round(w * fs)), Math.max(2, Math.round(h * fs)));
    kit.field.paint((u, v, out) => {
      const A = main.sample(u * P.freq + vx * drift, v * P.freq + vy * drift);
      // Second stack: higher frequency, counter-drifting, offset origin.
      const B = fallback.sample(
        u * P.secondFreq - vy * drift * 1.6 + 0.37,
        v * P.secondFreq + vx * drift * 1.6 + 0.71,
      );
      let n = A * 0.62 + B * 0.38;

      // Contrast around a movable midpoint, then a gamma curve for punch.
      n = (n - P.mid) / Math.max(0.08, 1 - Math.abs(P.mid - 0.5) * 2) + 0.5;
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      n = Math.pow(n, P.gamma);

      const idx = (n * 255) | 0;
      const li = idx * 3;
      out[0] = kit.lut[li];
      out[1] = kit.lut[li + 1];
      out[2] = kit.lut[li + 2];
    });

    kit.field.blit(ctx, w, h);
  },
};
