import { defineEffect } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-aura",
    displayName: "Fire Aura",
    description: "A breathing rim of fiery glow hugging the target's edge with small wisps orbiting the border.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const rimX = width * 0.46;
    const rimY = height * 0.46;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const settings = fireSettings(options);
    const wisps = Array.from({ length: fireCount(18, settings) }, () => ({
      angle: random() * Math.PI * 2,
      turns: 1 + Math.floor(random() * 2),
      flick: random() * Math.PI * 2,
      size: 0.5 + random() * 0.7,
      tone: random(),
    }));
    ctx.globalCompositeOperation = "lighter";
    const outer = Math.max(rimX, rimY) * (1.02 + 0.06 * breath);
    const rim = ctx.createRadialGradient(centerX, centerY, outer * 0.55, centerX, centerY, outer);
    rim.addColorStop(0, paint.alpha(0, 1));
    rim.addColorStop(0.7, paint.alpha((0.3 + 0.2 * breath) * options.intensity * settings.bloom, 0));
    rim.addColorStop(0.88, paint.alpha((0.2 + 0.15 * breath) * options.intensity * settings.bloom, 2));
    rim.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = rim;
    ctx.fillRect(x, y, width, height);
    for (const wisp of wisps) {
      const angle = wisp.angle + progress * Math.PI * 2 * wisp.turns * settings.turbulence;
      const flicker = 0.65 + 0.35 * Math.sin(wisp.flick + progress * Math.PI * 4 * settings.turbulence);
      const px = centerX + Math.cos(angle) * rimX * 0.94 + settings.wind * width * 0.04 * Math.sin(Math.PI * progress);
      const py = centerY + Math.sin(angle) * rimY * 0.94;
      const alpha = flicker * (0.25 + 0.35 * wisp.tone) * options.intensity;
      const size = Math.max(1, Math.min(width, height) * 0.06 * wisp.size * flicker + dpr);
      const glow = ctx.createRadialGradient(px, py, 0, px, py, size);
      glow.addColorStop(0, paint.alpha(alpha, wisp.tone > 0.6 ? 2 : 0));
      glow.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
