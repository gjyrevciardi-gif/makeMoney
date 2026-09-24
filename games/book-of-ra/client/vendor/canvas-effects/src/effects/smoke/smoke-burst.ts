import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-burst",
    displayName: "Smoke Burst",
    description: "An energetic eruption of smoke that scatters dense plumes in all directions before thinning out.",
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
    const maxR = Math.max(width, height) * 0.55;
    const settings = smokeSettings(options);
    const plumes = Array.from({ length: smokeCount(18, settings) }, () => ({
      angle: random() * Math.PI * 2,
      dist: 0.35 + random() * 0.6,
      size: 0.1 + random() * 0.14,
      spin: (random() - 0.5) * 0.7,
      tone: random(),
    }));
    const travel = easeOutCubic(progress);
    const fade = 1 - easeInCubic(progress);
    const coreAlpha = clamp01(1 - progress * 2.2) * 0.45 * options.intensity;
    if (coreAlpha > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR * 0.4);
      core.addColorStop(0, paint.alpha(coreAlpha, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    for (const plume of plumes) {
      const angle = plume.angle + plume.spin * travel;
      const px = centerX + Math.cos(angle) * maxR * plume.dist * travel + settings.wind * maxR * 0.28 * travel;
      const py = centerY + Math.sin(angle) * maxR * plume.dist * travel - maxR * 0.1 * travel;
      const alpha = fade * (0.2 + 0.3 * plume.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const radius = Math.max(1, maxR * plume.size * (0.5 + travel * 1.4));
      const tone = plume.tone > 0.7 ? 2 : plume.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radius * 1.18, radius, alpha, tone, plume.tone + plume.angle, settings, dpr);
    }
  },
});
