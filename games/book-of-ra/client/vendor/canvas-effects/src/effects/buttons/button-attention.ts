import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default defineEffect({
  metadata: {
    id: "button-attention",
    displayName: "Button Attention",
    description: "A double heartbeat of flash-and-ring pulses each cycle that nags the player to press the button.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const corner = Math.min(width, height) * 0.22;
    ctx.globalCompositeOperation = "lighter";
    for (const start of [0, 0.16]) {
      const t = clamp01((progress - start) / 0.45);
      if (t <= 0 || t >= 1) continue;
      const grow = easeOutCubic(t) * Math.min(width, height) * 0.4 + 2 * dpr;
      const a = (1 - t) * (1 - t) * options.intensity;
      const passes = [
        [7 * dpr, paint.alpha(0.2 * a, 0)],
        [1.5 * dpr, paint.alpha(0.9 * a, 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        roundedRect(ctx, x - grow, y - grow, width + grow * 2, height + grow * 2, corner + grow);
        ctx.stroke();
      }
    }
    const beat = (center: number): number => Math.exp(-Math.pow((progress - center) * 16, 2));
    const flash = Math.max(beat(0.05), beat(0.21)) * options.intensity;
    if (flash > 0.01) {
      roundedRect(ctx, x, y, width, height, corner);
      ctx.fillStyle = paint.alpha(0.35 * flash, 2);
      ctx.fill();
      ctx.lineWidth = 1.8 * dpr;
      ctx.strokeStyle = paint.alpha(0.8 * flash, 0);
      ctx.stroke();
    }
  },
});
