import { clamp01, defineEffect, easeInCubic, easeInOutCubic } from "../../effect.js";

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
    id: "button-charge",
    displayName: "Button Charge",
    description: "An energy meter that fills the button from the bottom, glows brighter as it rises, and discharges in a flash.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const corner = Math.min(width, height) * 0.22;
    const fill = easeInOutCubic(progress);
    const drain = 1 - easeInCubic(clamp01((progress - 0.88) / 0.12));
    const a = (0.3 + 0.5 * fill) * drain * options.intensity;
    const top = y + height * (1 - fill);
    ctx.globalCompositeOperation = "lighter";
    if (fill > 0.01) {
      const meter = ctx.createLinearGradient(x, y + height, x, top);
      meter.addColorStop(0, paint.alpha(0.5 * a, 0));
      meter.addColorStop(1, paint.alpha(0, 0));
      roundedRect(ctx, x, y, width, height, corner);
      ctx.fillStyle = meter;
      ctx.fill();
      ctx.lineCap = "round";
      const inset = Math.min(corner, height * fill * 0.5);
      const passes = [
        [7 * dpr, paint.alpha(0.25 * a, 0)],
        [1.5 * dpr, paint.alpha(0.9 * a, 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(x + inset, top);
        ctx.lineTo(x + width - inset, top);
        ctx.stroke();
      }
    }
    const flash = clamp01((progress - 0.85) / 0.15);
    if (flash > 0) {
      const burst = Math.sin(Math.PI * flash) * options.intensity;
      roundedRect(ctx, x, y, width, height, corner);
      ctx.fillStyle = paint.alpha(0.55 * burst, 2);
      ctx.fill();
    }
  },
});
