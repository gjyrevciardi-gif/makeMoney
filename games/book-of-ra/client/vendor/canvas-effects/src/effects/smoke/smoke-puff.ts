import { defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-puff",
    displayName: "Smoke Puff",
    description: "A soft ball of smoke that pops from the centre, billows outward, and gently dissipates.",
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
    const minDim = Math.min(width, height);
    const settings = smokeSettings(options);
    const blobs = Array.from({ length: smokeCount(13, settings) }, () => ({
      angle: random() * Math.PI * 2,
      dist: 0.1 + random() * 0.32,
      size: 0.16 + random() * 0.2,
      spin: (random() - 0.5) * 0.4,
      tone: random(),
    }));
    const travel = easeOutCubic(progress);
    const fade = 1 - easeInCubic(progress);
    for (const blob of blobs) {
      const angle = blob.angle + blob.spin * travel;
      const px = centerX + Math.cos(angle) * minDim * blob.dist * travel + settings.wind * minDim * 0.2 * travel;
      const py = centerY + Math.sin(angle) * minDim * blob.dist * travel - minDim * 0.08 * travel;
      const radius = Math.max(1, minDim * blob.size * (0.5 + travel * 0.9));
      const alpha = fade * (0.2 + 0.25 * blob.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const tone = blob.tone > 0.72 ? 2 : blob.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radius * 1.14, radius, alpha, tone, blob.tone + blob.angle, settings, dpr);
    }
  },
});
