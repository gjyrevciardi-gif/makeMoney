import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-line",
    displayName: "Laser Line",
    description: "A crisp horizontal laser that draws itself across the target and flares out at the tip.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const midY = y + height / 2;
    const head = x + width * easeOutCubic(clamp01(progress * 1.5));
    const fade = 1 - easeInCubic(clamp01((progress - 0.65) / 0.35));
    const flicker = 0.85 + 0.15 * Math.sin(progress * 34);
    const a = fade * flicker * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const passes = [
      [11 * dpr, paint.alpha(0.16 * a, 1)],
      [4.5 * dpr, paint.alpha(0.42 * a, 0)],
      [1.5 * dpr, paint.alpha(0.95 * a, 2)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x, midY);
      ctx.lineTo(head, midY);
      ctx.stroke();
    }
    ctx.fillStyle = paint.alpha(0.9 * a, 2);
    ctx.beginPath();
    ctx.arc(head, midY, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  },
});
