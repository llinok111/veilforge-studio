/**
 * Particle field.
 *
 * Positions are analytic: pos(t) = wrap(base + velocity · t). No integration, no
 * accumulator, no hidden state. That means any frame can be reproduced from
 * (config, t) alone — which is exactly what makes the Canvas export verifiable
 * against the preview at a fixed timestamp.
 *
 * Trails are drawn as a segment from pos(t - Δ) to pos(t) rather than by fading a
 * persistent buffer, for the same reason.
 *
 * Geometry comes from `particleLayout`, shared with the CSS and SVG exporters, so
 * the exported motes sit where the canvas motes sit.
 */

import { particleLayout } from './layout.js';

const WRAP = 0.12;

export const particles = {
  id: 'particles',
  label: 'Particles',
  blurb: 'Deterministic drifting motes with motion-streak trails.',
  primary: 'density',

  render(ctx, w, h, cfg, kit, time) {
    const t = time * cfg.speed;
    const L = particleLayout(cfg);

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, w, h);

    // Base wash. Without it a sparse field on a near-black palette reads as an
    // empty frame at thumbnail size, even though hundreds of motes are drawn.
    const c1 = kit.paletteRgb[1] || kit.paletteRgb[0];
    const c2 = kit.paletteRgb[2] || c1;
    const wash = ctx.createRadialGradient(w * 0.46, h * 0.4, 0, w * 0.46, h * 0.4, Math.max(w, h) * 0.78);
    wash.addColorStop(0, `rgba(${c2[0]},${c2[1]},${c2[2]},${(0.2 + cfg.intensity * 0.34).toFixed(3)})`);
    wash.addColorStop(0.55, `rgba(${c1[0]},${c1[1]},${c1[2]},${(0.13 + cfg.intensity * 0.2).toFixed(3)})`);
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    const trailSpan = 0.05 + cfg.intensity * 0.12;
    const scaleFactor = 0.7 + cfg.scale * 0.55;

    // Two passes: soft halos, then crisp cores. Grouping by composite mode keeps
    // state changes down to two for the whole frame.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const alive = [];
    for (const p of L.items) {
      const vx = Math.cos(p.ang) * p.spd;
      const vy = Math.sin(p.ang) * p.spd;
      const wob = Math.sin(t * 0.7 + p.wobble) * p.wobbleAmp;
      const wob2 = Math.cos(t * 0.53 + p.wobble) * p.wobbleAmp;
      const wobQ = Math.sin((t - trailSpan) * 0.7 + p.wobble) * p.wobbleAmp;
      const wob2Q = Math.cos((t - trailSpan) * 0.53 + p.wobble) * p.wobbleAmp;

      alive.push({
        px: wrap(p.bx + vx * t + wob),
        py: wrap(p.by + vy * t + wob2),
        qx: wrap(p.bx + vx * (t - trailSpan) + wobQ),
        qy: wrap(p.by + vy * (t - trailSpan) + wob2Q),
        size: p.size * scaleFactor,
        colorIdx: Math.min(kit.paletteRgb.length - 1, p.colorIdx),
      });
    }

    // Halos
    for (const p of alive) {
      const rgb = kit.paletteRgb[p.colorIdx];
      const r = (p.size * minDim) / 300 + 2;
      const sprite = kit.sprite(rgb, 48, 0.72);
      ctx.globalAlpha = 0.18 + (p.size / 3) * 0.42;
      const d = r * 7.5;
      ctx.drawImage(sprite, p.px * w - d / 2, p.py * h - d / 2, d, d);
    }

    // Cores + streaks
    ctx.globalAlpha = 1;
    for (const p of alive) {
      const rgb = kit.paletteRgb[p.colorIdx];
      const coreR = Math.max(1.2, (p.size * minDim) / 430);

      if (Math.abs(p.px - p.qx) < 0.4 && Math.abs(p.py - p.qy) < 0.4) {
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.1 + p.size * 0.1).toFixed(3)})`;
        ctx.lineWidth = coreR * 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.qx * w, p.qy * h);
        ctx.lineTo(p.px * w, p.py * h);
        ctx.stroke();
      }

      const sprite = kit.sprite(rgb, 32, 0.45);
      const d = coreR * 7;
      ctx.globalAlpha = 0.72 + Math.min(0.28, p.size / 3);
      ctx.drawImage(sprite, p.px * w - d / 2, p.py * h - d / 2, d, d);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

function wrap(v) {
  const span = 1 + WRAP * 2;
  let x = (v + WRAP) % span;
  if (x < 0) x += span;
  return x - WRAP;
}
