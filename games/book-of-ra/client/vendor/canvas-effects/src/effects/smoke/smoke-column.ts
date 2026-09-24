import { defineEffect } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-column",
    displayName: "Smoke Column",
    description: "A steady column of smoke rising from the target's base, widening and thinning as it climbs.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const baseX = x + width / 2;
    const baseY = y + height * 0.96;
    const minDim = Math.min(width, height);
    const settings = smokeSettings(options);
    const puffs = Array.from({ length: smokeCount(19, settings) }, () => ({
      phase: random(),
      sway: random() * Math.PI * 2,
      swayAmp: 0.03 + random() * 0.05,
      size: 0.5 + random() * 0.6,
      tone: random(),
    }));
    for (const puff of puffs) {
      const cycle = (progress + puff.phase) % 1;
      const life = Math.sin(Math.PI * cycle);
      const alpha = life * (0.16 + 0.22 * puff.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const px = baseX + Math.sin(puff.sway + cycle * Math.PI * 3 * settings.turbulence) * width * puff.swayAmp * (0.4 + cycle * 2) + settings.wind * width * 0.2 * cycle;
      const py = baseY - cycle * height * 0.9;
      const radius = Math.max(1, minDim * 0.11 * puff.size * (0.5 + cycle * 1.4));
      const tone = puff.tone > 0.7 ? 2 : puff.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radius * (1.05 + cycle * 0.3), radius, alpha, tone, puff.tone + puff.sway, settings, dpr);
    }
  },
});
