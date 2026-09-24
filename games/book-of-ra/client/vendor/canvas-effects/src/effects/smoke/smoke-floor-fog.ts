import { defineEffect } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-floor-fog",
    displayName: "Smoke Floor Fog",
    description: "A low blanket of fog rolling gently along the bottom edge of the target.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: smokeParameters,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const floorY = y + height;
    const bandH = height * 0.32;
    const phase = progress * Math.PI * 2;
    const settings = smokeSettings(options);
    const banks = Array.from({ length: smokeCount(14, settings) }, () => ({
      xf: random(),
      roll: random() * Math.PI * 2,
      speed: 1 + Math.floor(random() * 2),
      size: 0.6 + random() * 0.7,
      lift: random() * 0.5,
      tone: random(),
    }));
    const bed = ctx.createLinearGradient(x, floorY, x, floorY - bandH);
    bed.addColorStop(0, paint.alpha(0.32 * options.intensity, 0));
    bed.addColorStop(0.6, paint.alpha(0.14 * options.intensity, 1));
    bed.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = bed;
    ctx.fillRect(x, floorY - bandH, width, bandH);
    for (const bank of banks) {
      const drift = Math.sin(bank.roll + phase * bank.speed);
      const px = x + bank.xf * width + drift * width * 0.06 * settings.turbulence + settings.wind * width * progress * 0.18;
      const py = floorY - bandH * (0.18 + bank.lift * 0.5 + 0.08 * Math.sin(bank.roll * 2 + phase * bank.speed));
      const alpha = (0.14 + 0.16 * bank.tone) * options.intensity;
      const radiusX = Math.max(2, width * 0.16 * bank.size);
      const radiusY = Math.max(1, bandH * 0.42 * bank.size);
      const tone = bank.tone > 0.7 ? 2 : 0;
      drawSmokeVolume(ctx, paint, px, py, radiusX, radiusY, alpha, tone, bank.tone + bank.roll, settings, dpr);
    }
  },
});
