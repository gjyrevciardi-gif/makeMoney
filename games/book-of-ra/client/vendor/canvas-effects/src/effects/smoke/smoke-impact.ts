import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-impact",
    displayName: "Smoke Impact",
    description: "A ground-slam dust cloud that kicks out sideways in a flattened ring and settles into thin haze.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const groundY = y + height * 0.78;
    const maxR = Math.max(width, height) * 0.5;
    const settings = smokeSettings(options);
    const clouds = Array.from({ length: smokeCount(18, settings) }, () => ({
      angle: random() * Math.PI * 2,
      dist: 0.4 + random() * 0.55,
      size: 0.12 + random() * 0.14,
      rise: random() * 0.25,
      tone: random(),
    }));
    const travel = easeOutCubic(progress);
    const fade = 1 - easeInCubic(progress);
    const coreAlpha = clamp01(1 - progress * 2.4) * 0.5 * options.intensity;
    if (coreAlpha > 0.01) {
      const core = ctx.createRadialGradient(centerX, groundY, 0, centerX, groundY, maxR * 0.35);
      core.addColorStop(0, paint.alpha(coreAlpha, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    for (const cloud of clouds) {
      const px = centerX + Math.cos(cloud.angle) * maxR * cloud.dist * travel + settings.wind * maxR * 0.2 * travel;
      const py = groundY + Math.sin(cloud.angle) * maxR * cloud.dist * travel * 0.28 - height * cloud.rise * travel;
      const alpha = fade * (0.2 + 0.28 * cloud.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const radius = Math.max(1, maxR * cloud.size * (0.5 + travel * 1.3));
      const tone = cloud.tone > 0.7 ? 2 : cloud.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radius * 1.38, radius * 0.82, alpha, tone, cloud.tone + cloud.angle, settings, dpr);
    }
  },
});
