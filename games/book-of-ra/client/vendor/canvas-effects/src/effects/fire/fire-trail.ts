import { clamp01, defineEffect } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-trail",
    displayName: "Fire Trail",
    description: "A blazing comet head that streaks across the target leaving a tapering wake of embers.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const midY = y + height / 2;
    const envelope = Math.sin(Math.PI * progress);
    const headX = x + width * progress;
    const headR = Math.max(2, Math.min(width, height) * 0.14);
    const settings = fireSettings(options);
    const wisps = Array.from({ length: fireCount(28, settings) }, () => ({
      lag: 0.03 + random() * 0.42,
      bob: random() * Math.PI * 2,
      size: 0.35 + random() * 0.65,
      tone: random(),
    }));
    ctx.globalCompositeOperation = "lighter";
    const head = ctx.createRadialGradient(headX, midY, 0, headX, midY, headR * 2.2);
    head.addColorStop(0, paint.alpha(0.9 * envelope * options.intensity * settings.bloom, 2));
    head.addColorStop(0.4, paint.alpha(0.55 * envelope * options.intensity * settings.bloom, 0));
    head.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(headX, midY, headR * 2.2, 0, Math.PI * 2);
    ctx.fill();
    for (const wisp of wisps) {
      const px = headX - wisp.lag * width;
      if (px < x) continue;
      const taper = clamp01(1 - wisp.lag / 0.45);
      const py = midY + Math.sin(wisp.bob + progress * Math.PI * 8 * settings.turbulence) * height * 0.16 * wisp.lag;
      const alpha = envelope * taper * (0.3 + 0.5 * wisp.tone) * options.intensity * settings.embers;
      if (alpha <= 0.01) continue;
      ctx.fillStyle = paint.alpha(alpha, wisp.tone > 0.66 ? 2 : wisp.tone > 0.33 ? 0 : 1);
      ctx.beginPath();
      ctx.arc(px + settings.wind * width * wisp.lag * 0.16, py, Math.max(0.5, headR * wisp.size * taper + dpr * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
