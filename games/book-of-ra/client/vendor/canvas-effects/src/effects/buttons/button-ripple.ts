import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "button-ripple",
    displayName: "Button Ripple",
    description: "Touch-style ripple rings that expand from the button centre and dissolve outward.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const maxRadius = Math.hypot(width, height) / 2;
    ctx.globalCompositeOperation = "lighter";
    const splash = 1 - easeOutCubic(clamp01(progress / 0.35));
    if (splash > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius * 0.3);
      core.addColorStop(0, paint.alpha(0.6 * splash * options.intensity, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    for (const delay of [0, 0.18, 0.34]) {
      const t = clamp01((progress - delay) / (1 - delay));
      if (t <= 0) continue;
      const radius = Math.max(1, maxRadius * easeOutCubic(t));
      const a = (1 - t) * (1 - t) * options.intensity;
      const passes = [
        [7 * dpr, paint.alpha(0.16 * a, 0)],
        [2.5 * dpr, paint.alpha(0.38 * a, 0)],
        [1.2 * dpr, paint.alpha(0.8 * a, 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
});
