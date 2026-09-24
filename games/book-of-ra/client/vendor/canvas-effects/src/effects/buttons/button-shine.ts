import { defineEffect, easeInOutCubic } from "../../effect.js";

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
    id: "button-shine",
    displayName: "Button Shine",
    description: "A glossy diagonal sheen band that sweeps across the button face from left to right.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const corner = Math.min(width, height) * 0.22;
    const band = width * 0.24;
    const slant = height * 0.6;
    const travel = easeInOutCubic(progress);
    const bandX = x - band - slant + (width + (band + slant) * 2) * travel;
    const a = 0.65 * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    const sheen = ctx.createLinearGradient(bandX - band, y, bandX + band + slant, y + height);
    sheen.addColorStop(0, paint.alpha(0, 2));
    sheen.addColorStop(0.42, paint.alpha(0.25 * a, 1));
    sheen.addColorStop(0.5, paint.alpha(a, 2));
    sheen.addColorStop(0.58, paint.alpha(0.25 * a, 1));
    sheen.addColorStop(1, paint.alpha(0, 2));
    roundedRect(ctx, x, y, width, height, corner);
    ctx.fillStyle = sheen;
    ctx.fill();
  },
});
