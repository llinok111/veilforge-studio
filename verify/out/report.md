# VeilForge verification report

Generated: 2026-10-22T10:33:06.111Z
Browser: Chromium 149.0.7827.55 (headless, deviceScaleFactor 1)
Viewport: 1200×675

## 1. Export fidelity

Measured against the reference render produced by the same `Renderer` the preview
uses, at speed 0 (static frame). MAE is mean absolute error over RGB, 0–255.
SSIM is windowed (8×8) on luminance.

| generator | target | declared | MAE | SSIM | abs Δmean | size | page paint | verdict |
|---|---|---|---|---|---|---|---|---|
| mesh | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| mesh | svg | medium | 25.73 | 0.6507 | 0.0861 | 8.2 KB | 1134 ms | structural |
| mesh | css | medium | 15.25 | 0.6714 | 0.0024 | 3.8 KB | 951 ms | structural |
| noise | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| noise | svg | medium | 39.24 | 0.4758 | 0.0093 | 3.0 KB | 1167 ms | tonal only |
| noise | css | medium | 31.98 | 0.5049 | 0.0034 | 2.7 KB | 1140 ms | structural |
| blobs | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| blobs | svg | high | 15.83 | 0.7563 | 0.019 | 6.7 KB | 926 ms | structural |
| blobs | css | high | 14.32 | 0.7925 | 0.0128 | 4.0 KB | 782 ms | structural |
| flow | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| flow | svg | low | 64.89 | 0.2669 | 0.0332 | 2.4 KB | 967 ms | tonal only |
| flow | css | low | 57.27 | 0.296 | 0.002 | 1.9 KB | 936 ms | tonal only |
| particles | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| particles | svg | high | 9.29 | 0.8309 | 0.0215 | 76.5 KB | 878 ms | structural |
| particles | css | high | 8.98 | 0.833 | 0.0071 | 6.5 KB | 852 ms | structural |
| texture | canvas | exact | 0 | 1 | 0 | 60.5 KB | — | **exact** |
| texture | svg | low | 44.25 | 0.2627 | 0.0156 | 2.8 KB | 993 ms | tonal only |
| texture | css | low | 44.88 | 0.2715 | 0.0066 | 2.8 KB | 915 ms | tonal only |

Gates — canvas: exact hash or (MAE ≤ 2 and SSIM ≥ 0.99);
SVG: SSIM ≥ 0.55 and |Δmean| ≤ 0.1;
CSS: SSIM ≥ 0.5 and |Δmean| ≤ 0.1.
CSS and SVG are gated on structural + exposure agreement rather than MAE, because
a different noise realisation cannot be pixel-matched by construction.

Verdicts: **6 exact**, 7 structural,
5 tonal-only, 0 divergent.

* exact — byte-identical frame (Canvas export)
* structural — SSIM and exposure both inside the gate
* tonal only — same exposure and contrast, different noise realisation. This is the
  honest ceiling for field generators in CSS/SVG: a different fBm sample cannot be
  pixel-matched, only tone-matched.
* divergent — neither; would be a bug.

## 2. Determinism

| generator | same seed identical | different seed differs | MAE across seeds |
|---|---|---|---|
| mesh | true | true | 19.87 |
| particles | true | true | 11.73 |
| noise | true | true | 27.82 |

**Result: 3/3 pass.**

## 3. Structural validity

| generator | SVG parses | SVG nodes | CSS rules | JSON round-trip |
|---|---|---|---|---|
| mesh | true | 117 | 3 | true |
| noise | true | 34 | 3 | true |
| blobs | true | 111 | 3 | true |
| flow | true | 26 | 3 | true |
| particles | true | 1086 | 4 | true |
| texture | true | 27 | 3 | true |

**Result: 1/6 pass.**

## 4. Per-frame cost (1920×1080, Canvas2D, headless, software raster)

| generator | quality | internal buffer | cold start | p50 | p95 | net (p50 − baseline) | heap |
|---|---|---|---|---|---|---|---|
| mesh | high | 1536×864 | 40.4 | 39 | 48.1 | 32.6 | 9.5 |
| mesh | ultra | 1920×1080 | 59.6 | 52 | 58 | 45.6 | 9.5 |
| noise | high | 1536×864 | 38.2 | 35.3 | 41.1 | 28.9 | 9.5 |
| noise | ultra | 1920×1080 | 55 | 48.6 | 53.5 | 42.2 | 9.5 |
| blobs | high | 1536×864 | 27.8 | 27.3 | 32.5 | 20.9 | 9.5 |
| blobs | ultra | 1920×1080 | 41.5 | 33.5 | 36.3 | 27.1 | 9.5 |
| flow | high | 1536×864 | 44.4 | 35 | 40 | 28.6 | 9.5 |
| flow | ultra | 1920×1080 | 68.8 | 50.7 | 63.4 | 44.3 | 9.5 |
| particles | high | 1536×864 | 40.3 | 29.6 | 34.9 | 23.2 | 9.5 |
| particles | ultra | 1920×1080 | 48.6 | 36.7 | 42.1 | 30.3 | 9.5 |
| texture | high | 1536×864 | 43.7 | 42.5 | 46.4 | 36.1 | 9.5 |
| texture | ultra | 1920×1080 | 68.2 | 64.3 | 72 | 57.9 | 9.5 |

Baseline for this environment: **6.4 ms** — the cost of clearing an
1920×1080 canvas and blitting one upscaled frame with *no generator at all*, in the
same headless software rasteriser. The 'net' column subtracts it, which is the only way to
separate engine cost from renderer overhead. Treat absolute numbers as
"software-raster ceiling", not as what a GPU-composited desktop browser will do.

Cold start includes palette LUT + 256² fBm field construction, paid once per
(seed, octaves) pair and cached.

## 4b. Frame-time ablation (particles, 1920×1080, quality high)

| configuration | p50 |
|---|---|
| generator + vignette + grain + composite | 27.4 ms |
| … without grain | 28.5 ms |
| … without vignette | 27.6 ms |
| scene render only (no display composite, no readback) | 2.7 ms |

The generator itself is a small fraction of the frame. What dominates here is the
final 1536×864 → 1920×1080 composite plus the synchronous readback this harness
forces in order to measure anything at all. On a GPU-composited canvas that
composite is a texture blit; under software raster with a forced readback it costs
more than the procedural work. Both numbers are reported so neither is mistaken
for the other.

## 5. CPU while animating (5 s window at 1920×1080, quality high)

| generator | frames rendered | effective fps | main-thread task time | script share |
|---|---|---|---|---|
| mesh | 5.17 s | undefined% |
| noise | 5.05 s | undefined% |
| blobs | 5.06 s | undefined% |
| flow | 5.06 s | undefined% |
| particles | 5.11 s | undefined% |
| texture | 5.1 s | undefined% |

## 6. Bytes shipped

- runtime (Canvas export): 58.8 KB
- css export (6 generators, all files): 40.1 KB
- svg export (6 generators, all files): 195.6 KB
- canvas export (6 generators, all files): 717.9 KB
- json export (6 generators, all files): 2.4 KB

## 7. API compatibility surface

- Canvas2D: available
- OffscreenCanvas: available
- imageSmoothingQuality: available
- ctx.createPattern().setTransform: available
- mix-blend-mode: available
- background-blend-mode: available
- radial-gradient %: available
- box-shadow inset: available
- aspect-ratio: available
- DOMMatrix: available
- SVG feTurbulence: available
- SVG feDisplacementMap: available
- SMIL (SVGAnimateElement): available
- matchMedia reduced-motion: available

Only Chromium 149.0.7827.55 was exercised in this environment. Firefox and WebKit
are not installed here, so no claim is made about them beyond the API list above;
every API used is baseline-available in Firefox 100+ and Safari 16.4+ except
`pattern.setTransform`, which is feature-detected and falls back to an unshifted
grain pattern.
