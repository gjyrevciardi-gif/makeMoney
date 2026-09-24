import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-reveal",
    displayName: "Smoke Reveal",
    description: "A dense shroud of smoke covering the target that parts and thins until the target is fully revealed.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const maxDim = Math.max(width, height);
    const settings = smokeSettings(options);
    const cover = Array.from({ length: smokeCount(22, settings) }, () => ({
      xf: random(),
      yf: random(),
      size: 0.16 + random() * 0.18,
      drift: random() * Math.PI * 2,
      tone: random(),
    }));
    const clear = easeInOutCubic(progress);
    const veil = clamp01(1 - clear);
    if (veil > 0.01) {
      const haze = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxDim * 0.7);
      haze.addColorStop(0, paint.alpha(0.5 * veil * options.intensity, 0));
      haze.addColorStop(1, paint.alpha(0.3 * veil * options.intensity, 1));
      ctx.fillStyle = haze;
      ctx.fillRect(x, y, width, height);
    }
    for (const blob of cover) {
      const homeX = x + blob.xf * width;
      const homeY = y + blob.yf * height;
      const awayX = Math.cos(blob.drift) * maxDim * 0.5 * clear + settings.wind * maxDim * 0.18 * clear;
      const awayY = Math.sin(blob.drift) * maxDim * 0.5 * clear - maxDim * 0.1 * clear;
      const alpha = veil * (0.3 + 0.3 * blob.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const radius = Math.max(1, maxDim * blob.size * (1 + clear * 0.6));
      const tone = blob.tone > 0.7 ? 2 : blob.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, homeX + awayX, homeY + awayY, radius * 1.12, radius, alpha, tone, blob.tone + blob.drift, settings, dpr);
    }
  },
  renderReducedMotion({ frame, paint }) {
    const { ctx, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const gradient = ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, Math.max(width, height) / 2);
    gradient.addColorStop(0, paint.alpha(0.18 * options.intensity, 0));
    gradient.addColorStop(1, paint.alpha(0.06 * options.intensity, 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
  },
});
