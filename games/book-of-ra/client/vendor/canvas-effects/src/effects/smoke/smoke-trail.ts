import { clamp01, defineEffect } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-trail",
    displayName: "Smoke Trail",
    description: "A wisp of smoke gliding across the target, leaving a widening, softly fading wake behind it.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const midY = y + height / 2;
    const envelope = Math.sin(Math.PI * progress);
    const headX = x + width * progress;
    const baseR = Math.max(2, Math.min(width, height) * 0.12);
    const settings = smokeSettings(options);
    const wake = Array.from({ length: smokeCount(20, settings) }, () => ({
      lag: 0.03 + random() * 0.45,
      bob: random() * Math.PI * 2,
      size: 0.5 + random() * 0.7,
      tone: random(),
    }));
    drawSmokeVolume(ctx, paint, headX, midY, baseR * 1.7, baseR * 1.35, 0.5 * envelope * options.intensity, 2, progress, settings, dpr);
    for (const wisp of wake) {
      const px = headX - wisp.lag * width;
      if (px < x) continue;
      const spread = clamp01(wisp.lag / 0.45);
      const py = midY + Math.sin(wisp.bob + progress * Math.PI * 6 * settings.turbulence) * height * 0.2 * spread;
      const alpha = envelope * (1 - spread * 0.8) * (0.18 + 0.2 * wisp.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const radius = Math.max(1, baseR * wisp.size * (0.7 + spread * 1.5));
      const tone = wisp.tone > 0.66 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px + settings.wind * width * spread * 0.12, py, radius * (1.25 + spread * 0.35), radius, alpha, tone, wisp.tone + wisp.bob, settings, dpr);
    }
  },
});
