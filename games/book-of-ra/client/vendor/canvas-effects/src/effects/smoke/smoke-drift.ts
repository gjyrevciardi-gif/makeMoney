import { defineEffect } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-drift",
    displayName: "Smoke Drift",
    description: "Loose wisps of smoke drifting lazily sideways across the target at varying heights.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const minDim = Math.min(width, height);
    const settings = smokeSettings(options);
    const wisps = Array.from({ length: smokeCount(15, settings) }, () => ({
      offset: random(),
      yf: 0.12 + random() * 0.76,
      bob: random() * Math.PI * 2,
      size: 0.5 + random() * 0.8,
      stretch: 1.4 + random(),
      tone: random(),
    }));
    for (const wisp of wisps) {
      const cycle = (progress + wisp.offset) % 1;
      const visibility = Math.sin(Math.PI * cycle);
      const alpha = visibility * (0.12 + 0.18 * wisp.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const direction = settings.wind < 0 ? 1 - cycle : cycle;
      const px = x + direction * width + settings.wind * width * 0.08 * Math.sin(Math.PI * cycle);
      const py = y + wisp.yf * height + Math.sin(wisp.bob + cycle * Math.PI * 2 * settings.turbulence) * height * 0.04;
      const radiusX = Math.max(2, minDim * 0.14 * wisp.size * wisp.stretch);
      const radiusY = Math.max(1, minDim * 0.07 * wisp.size);
      const tone = wisp.tone > 0.7 ? 2 : wisp.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radiusX, radiusY, alpha, tone, wisp.tone + wisp.bob, settings, dpr);
    }
  },
});
