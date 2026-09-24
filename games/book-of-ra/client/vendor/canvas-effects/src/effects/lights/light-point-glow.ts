import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-point-glow",
    displayName: "Light Point Glow",
    description: "A scattering of soft light points that gently breathe brighter and dimmer across the target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const base = Math.min(width, height);
    const points = Array.from({ length: 9 }, () => ({
      px: x + width * (0.1 + random() * 0.8),
      py: y + height * (0.1 + random() * 0.8),
      size: base * (0.09 + random() * 0.13),
      phase: random() * Math.PI * 2,
      rate: 1 + Math.floor(random() * 2),
      tone: Math.floor(random() * 3),
    }));
    ctx.globalCompositeOperation = "lighter";
    for (const point of points) {
      const breath = 0.55 + 0.45 * Math.sin(progress * Math.PI * 2 * point.rate + point.phase);
      const alpha = breath * 0.7 * options.intensity;
      if (alpha <= 0.01) continue;
      const radius = Math.max(1, point.size * (0.75 + breath * 0.35) + dpr);
      const glow = ctx.createRadialGradient(point.px, point.py, 0, point.px, point.py, radius);
      glow.addColorStop(0, paint.alpha(alpha, 2));
      glow.addColorStop(0.35, paint.alpha(alpha * 0.55, point.tone));
      glow.addColorStop(1, paint.alpha(0, point.tone));
      ctx.fillStyle = glow;
      ctx.fillRect(point.px - radius, point.py - radius, radius * 2, radius * 2);
    }
  },
});
