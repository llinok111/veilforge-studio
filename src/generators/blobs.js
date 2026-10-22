/**
 * Light blobs (光斑).
 *
 * Additive radial gradients on a dark base. Additive blending is the whole trick:
 * overlapping blobs sum toward white at the intersections, which is what real
 * out-of-focus highlights do. Drawing them with `source-over` looks like painted
 * circles instead of light.
 *
 * Geometry comes from `blobLayout`, shared with the CSS and SVG exporters.
 */

import { TAU } from '../core/color.js';
import { blobLayout } from './layout.js';

export const blobs = {
  id: 'blobs',
  label: 'Light blobs',
  blurb: 'Additive bokeh spots; overlaps bloom toward white.',
  primary: 'intensity',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const L = blobLayout(cfg);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    const dir = (cfg.direction * Math.PI) / 180;
    const spread = 0.05 + cfg.intensity * 0.16;
    const sizeScale = (0.55 + cfg.scale * 0.7) * minDim;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const b of L.items) {
      const rgb = kit.paletteRgb[Math.min(kit.paletteRgb.length - 1, b.colorIdx)];
      const alpha = b.alpha * (0.45 + cfg.intensity * 0.9);
      const orbit = b.orbit * spread;

      // Lissajous drift, biased along `direction`.
      const cx = (b.bx + Math.cos(b.phase + t * b.pulseSpeed) * orbit * Math.cos(dir)) * w;
      const cy = (b.by + Math.sin(b.phase * 1.37 + t * b.pulseSpeed) * orbit * Math.sin(dir)) * h;
      const r = b.radius * sizeScale * (0.85 + 0.15 * Math.sin(t * b.pulseSpeed * 1.7 + b.phase));

      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a = alpha.toFixed(3);
      const rgba = (k) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${k})`;
      g.addColorStop(0, rgba(a));
      g.addColorStop(0.38, rgba((alpha * 0.5).toFixed(3)));
      g.addColorStop(0.72, rgba((alpha * 0.16).toFixed(3)));
      g.addColorStop(1, rgba(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // Hot core: small, near-white. Reads as the light source, not the haze.
      if (b.coreScale > 0) {
        const cr = r * b.coreScale;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        const ca = (alpha * 0.85).toFixed(3);
        cg.addColorStop(0, `rgba(255,252,245,${ca})`);
        cg.addColorStop(1, 'rgba(255,252,245,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  },
};
