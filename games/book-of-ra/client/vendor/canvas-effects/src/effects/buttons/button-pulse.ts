import { defineEffect, easeOutCubic } from "../../effect.js";

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
    id: "button-pulse",
    displayName: "Button Pulse",
    description: "A steady heartbeat: an outline ring emitted from the button edge that expands and fades every cycle.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const corner = Math.min(width, height) * 0.22;
    ctx.globalCompositeOperation = "lighter";
    const rim = (0.3 + 0.2 * Math.sin(progress * Math.PI * 2)) * options.intensity;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = paint.alpha(rim, 0);
    roundedRect(ctx, x, y, width, height, corner);
    ctx.stroke();
    const grow = easeOutCubic(progress) * Math.min(width, height) * 0.45 + 2 * dpr;
    const a = Math.pow(1 - progress, 1.6) * options.intensity;
    const passes = [
      [8 * dpr, paint.alpha(0.18 * a, 0)],
      [3 * dpr, paint.alpha(0.4 * a, 0)],
      [1.4 * dpr, paint.alpha(0.85 * a, 1)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      roundedRect(ctx, x - grow, y - grow, width + grow * 2, height + grow * 2, corner + grow);
      ctx.stroke();
    }
  },
});
