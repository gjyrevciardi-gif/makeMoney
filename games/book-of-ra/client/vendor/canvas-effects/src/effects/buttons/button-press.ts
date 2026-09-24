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
    id: "button-press",
    displayName: "Button Press",
    description: "A quick tactile press: the face dims and sinks inward, then releases with a bright rebound ring.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const corner = Math.min(width, height) * 0.22;
    const down = Math.sin(Math.PI * clamp01(progress / 0.6));
    const inset = down * Math.min(width, height) * 0.07;
    if (down > 0.01) {
      roundedRect(ctx, x + inset, y + inset, width - inset * 2, height - inset * 2, corner);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * down * options.intensity})`;
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = paint.alpha(0.55 * down * options.intensity, 0);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    const release = clamp01((progress - 0.55) / 0.45);
    if (release > 0) {
      const grow = easeOutCubic(release) * Math.min(width, height) * 0.3;
      const a = (1 - release) * options.intensity;
      ctx.globalCompositeOperation = "lighter";
      const passes = [
        [7 * dpr, paint.alpha(0.2 * a, 0)],
        [1.6 * dpr, paint.alpha(0.9 * a, 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        roundedRect(ctx, x - grow, y - grow, width + grow * 2, height + grow * 2, corner + grow);
        ctx.stroke();
      }
    }
  },
});
