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

function drawVeil(frame: import("../../types.js").EffectFrame, paint: { alpha(a: number, i?: number): string }, shakeX: number): void {
  const { ctx, options, dpr } = frame;
  const { x, y, width, height } = frame.target.bounds();
  const corner = Math.min(width, height) * 0.22;
  // The neutral grey fill under "saturation" compositing drains colour from the button beneath the veil.
  ctx.globalCompositeOperation = "saturation";
  roundedRect(ctx, x + shakeX, y, width, height, corner);
  ctx.fillStyle = "rgba(128,128,128,0.8)";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  roundedRect(ctx, x + shakeX, y, width, height, corner);
  ctx.fillStyle = paint.alpha(0.3 * options.intensity, 1);
  ctx.fill();
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeStyle = paint.alpha(0.4 * options.intensity, 0);
  ctx.stroke();
}

export default defineEffect({
  metadata: {
    id: "button-disabled",
    displayName: "Button Disabled",
    description: "A muted grey veil that desaturates the button, announced by a brief refusal shake.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#8a93a4", "#2c313c", "#b8bfcc"],
  render({ frame, paint }) {
    const { progress, dpr } = frame;
    const damp = 1 - easeOutCubic(clamp01(progress / 0.25));
    const shakeX = Math.sin(progress * 60) * 3 * dpr * damp;
    drawVeil(frame, paint, shakeX);
  },
  renderReducedMotion({ frame, paint }) {
    drawVeil(frame, paint, 0);
  },
});
