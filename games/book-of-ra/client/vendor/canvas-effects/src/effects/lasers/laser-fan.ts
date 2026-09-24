import { clamp01, defineEffect, easeInOutCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-fan",
    displayName: "Laser Fan",
    description: "A club-style fan of beams that spreads open from a bottom pivot and sweeps side to side.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const pivotX = x + width / 2;
    const pivotY = y + height;
    const reach = Math.hypot(width, height);
    const beams = 6;
    const spread = 1.7 * easeOutCubic(clamp01(progress * 2.2));
    const tilt = (easeInOutCubic(progress) * 2 - 1) * 0.45;
    const a = Math.min(1, progress * 6, (1 - progress) * 4) * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < beams; i++) {
      const jitter = (random() - 0.5) * 0.06;
      const angle = -Math.PI / 2 + (i / (beams - 1) - 0.5) * spread + tilt + jitter;
      const endX = pivotX + Math.cos(angle) * reach;
      const endY = pivotY + Math.sin(angle) * reach;
      const passes = [
        [8 * dpr, paint.alpha(0.14 * a, 1)],
        [3 * dpr, paint.alpha(0.32 * a, 0)],
        [1.2 * dpr, paint.alpha(0.85 * a, 2)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
    const base = ctx.createRadialGradient(pivotX, pivotY, 0, pivotX, pivotY, reach * 0.2);
    base.addColorStop(0, paint.alpha(0.5 * a, 2));
    base.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = base;
    ctx.fillRect(x, y, width, height);
  },
});
