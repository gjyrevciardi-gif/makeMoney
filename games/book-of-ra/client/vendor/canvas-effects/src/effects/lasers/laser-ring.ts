import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-ring",
    displayName: "Laser Ring",
    description: "Concentric neon shockwave rings that expand from the centre and dissolve at the edges.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const maxRadius = Math.hypot(width, height) / 2;
    ctx.globalCompositeOperation = "lighter";
    const flash = 1 - easeOutCubic(Math.min(1, progress * 2.6));
    if (flash > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius * 0.35);
      core.addColorStop(0, paint.alpha(0.7 * flash * options.intensity, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    for (const delay of [0, 0.28]) {
      const t = clamp01((progress - delay) / (1 - delay));
      if (t <= 0) continue;
      const radius = Math.max(1, maxRadius * easeOutCubic(t));
      const a = (1 - t) * (1 - t) * options.intensity;
      const passes = [
        [10 * dpr, paint.alpha(0.18 * a, 1)],
        [4 * dpr, paint.alpha(0.4 * a, 0)],
        [1.5 * dpr, paint.alpha(0.95 * a, 2)],
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
