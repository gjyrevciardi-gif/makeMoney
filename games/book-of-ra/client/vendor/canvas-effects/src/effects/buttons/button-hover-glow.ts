import { defineEffect } from "../../effect.js";

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
    id: "button-hover-glow",
    displayName: "Button Hover Glow",
    description: "A warm halo around the button rim that breathes gently while the pointer hovers.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const a = (0.4 + 0.45 * breath) * options.intensity;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.max(width, height) * (0.62 + 0.08 * breath);
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(centerX, centerY, Math.min(width, height) * 0.2, centerX, centerY, reach);
    halo.addColorStop(0, paint.alpha(0.22 * a, 0));
    halo.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(centerX - reach, centerY - reach, reach * 2, reach * 2);
    const pad = 1.5 * dpr * breath;
    const corner = Math.min(width, height) * 0.22;
    const passes = [
      [9 * dpr, paint.alpha(0.16 * a, 0)],
      [4 * dpr, paint.alpha(0.35 * a, 0)],
      [1.5 * dpr, paint.alpha(0.85 * a, 1)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      roundedRect(ctx, x - pad, y - pad, width + pad * 2, height + pad * 2, corner + pad);
      ctx.stroke();
    }
  },
});
