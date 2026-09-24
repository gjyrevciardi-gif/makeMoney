import { defineEffect } from "../../effect.js";
import { drawSmokeVolume, smokeCount, smokeParameters, smokeSettings } from "./smoke-primitives.js";

export default defineEffect({
  metadata: {
    id: "smoke-vortex",
    displayName: "Smoke Vortex",
    description: "A slow whirlpool of smoke spiralling around the target's centre with a hazy core.",
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
    const streams = Array.from({ length: smokeCount(24, settings) }, () => ({
      angle: random() * Math.PI * 2,
      orbit: 0.12 + random() * 0.34,
      turns: 1 + Math.floor(random() * 2),
      wobble: random() * Math.PI * 2,
      size: 0.4 + random() * 0.6,
      tone: random(),
    }));
    const haze = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, minDim * 0.4);
    haze.addColorStop(0, paint.alpha(0.2 * options.intensity, 1));
    haze.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = haze;
    ctx.fillRect(x, y, width, height);
    ctx.save();
    try {
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = `blur(${Math.max(4, minDim * 0.025 * settings.softness)}px)`;
      ctx.lineCap = "round";
      for (let band = 0; band < 3; band += 1) {
        const radius = minDim * (0.18 + band * 0.105);
        ctx.strokeStyle = paint.alpha((0.055 + band * 0.025) * options.intensity * settings.volume, band === 1 ? 2 : 0);
        ctx.lineWidth = minDim * (0.075 + band * 0.018);
        ctx.beginPath();
        ctx.ellipse(centerX + settings.wind * minDim * 0.05, centerY, radius * 1.18, radius * 0.82, progress * 0.35 + band * 0.22, 0, Math.PI * 2);
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
    for (const stream of streams) {
      const angle = stream.angle + progress * Math.PI * 2 * stream.turns * Math.max(0.15, settings.turbulence);
      const orbit = minDim * stream.orbit * (1 + 0.1 * Math.sin(stream.wobble + progress * Math.PI * 2));
      const px = centerX + Math.cos(angle) * orbit + settings.wind * minDim * 0.1 * Math.sin(Math.PI * progress);
      const py = centerY + Math.sin(angle) * orbit * 0.82;
      const alpha = (0.1 + 0.14 * stream.tone) * options.intensity;
      const radius = Math.max(1, minDim * 0.165 * stream.size * (0.72 + stream.orbit));
      const tone = stream.tone > 0.72 ? 2 : stream.tone > 0.3 ? 0 : 1;
      drawSmokeVolume(ctx, paint, px, py, radius * 1.4, radius, alpha, tone, stream.tone + stream.wobble, settings, dpr);
    }
  },
});
