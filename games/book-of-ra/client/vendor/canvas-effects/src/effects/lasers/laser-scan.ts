import { defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-scan",
    displayName: "Laser Scan",
    description: "A bright horizontal scan line that sweeps from top to bottom trailing a soft afterglow.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const scanY = y + height * easeInOutCubic(progress);
    const a = Math.min(1, progress * 10, (1 - progress) * 10) * options.intensity;
    const trail = Math.max(6 * dpr, height * 0.28);
    ctx.globalCompositeOperation = "lighter";
    const wake = ctx.createLinearGradient(x, scanY - trail, x, scanY);
    wake.addColorStop(0, paint.alpha(0, 1));
    wake.addColorStop(1, paint.alpha(0.22 * a, 0));
    ctx.fillStyle = wake;
    ctx.fillRect(x, scanY - trail, width, trail);
    ctx.lineCap = "round";
    const passes = [
      [10 * dpr, paint.alpha(0.18 * a, 1)],
      [4 * dpr, paint.alpha(0.45 * a, 0)],
      [1.5 * dpr, paint.alpha(0.95 * a, 2)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x, scanY);
      ctx.lineTo(x + width, scanY);
      ctx.stroke();
    }
  },
});
