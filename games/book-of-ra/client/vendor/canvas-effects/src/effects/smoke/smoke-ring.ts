import { defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-ring",
    displayName: "Smoke Ring",
    description: "A hollow ring of smoke blown outward from the centre that widens, thins, and melts away.",
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
    const maxR = Math.min(width, height) * 0.42;
    const grow = easeOutCubic(progress);
    const radius = maxR * (0.15 + 0.85 * grow);
    const fade = 1 - easeInCubic(progress);
    const settings = smokeSettings(options);
    const puffs = Array.from({ length: smokeCount(20, settings) }, () => ({
      angle: random() * Math.PI * 2,
      jitter: (random() - 0.5) * 0.12,
      size: 0.6 + random() * 0.6,
      tone: random(),
    }));
    const thickness = maxR * (0.14 + 0.16 * grow);
    for (const puff of puffs) {
      const r = radius * (1 + puff.jitter);
      const px = centerX + Math.cos(puff.angle) * r + settings.wind * maxR * 0.22 * grow;
      const py = centerY + Math.sin(puff.angle) * r - maxR * 0.12 * grow;
      const alpha = fade * (0.2 + 0.25 * puff.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const size = Math.max(1, thickness * puff.size);
      const tone = puff.tone > 0.72 ? 2 : puff.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, size * 1.2, size, alpha, tone, puff.tone + puff.angle, settings, dpr);
    }
  },
});
