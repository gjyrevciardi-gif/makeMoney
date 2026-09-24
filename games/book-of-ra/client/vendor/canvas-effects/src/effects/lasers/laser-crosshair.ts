import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-crosshair",
    displayName: "Laser Crosshair",
    description: "Full-span horizontal and vertical laser lines that home in on the centre and lock with a flash.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const startX = (random() - 0.5) * width * 0.7;
    const startY = (random() - 0.5) * height * 0.7;
    const home = easeOutCubic(clamp01(progress * 1.4));
    const px = centerX + startX * (1 - home);
    const py = centerY + startY * (1 - home);
    const fade = 1 - easeInCubic(clamp01((progress - 0.78) / 0.22));
    const a = fade * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const passes = [
      [8 * dpr, paint.alpha(0.16 * a, 1)],
      [3 * dpr, paint.alpha(0.4 * a, 0)],
      [1.2 * dpr, paint.alpha(0.9 * a, 2)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + width, py);
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + height);
      ctx.stroke();
    }
    const ringRadius = Math.min(width, height) * (0.32 - 0.22 * home);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = paint.alpha(0.75 * a, 0);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2 * dpr, ringRadius), 0, Math.PI * 2);
    ctx.stroke();
    const lock = clamp01((progress - 0.55) / 0.15);
    if (lock > 0) {
      const flash = ctx.createRadialGradient(px, py, 0, px, py, ringRadius * 2.2);
      flash.addColorStop(0, paint.alpha(0.7 * lock * a, 2));
      flash.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = flash;
      ctx.fillRect(x, y, width, height);
    }
  },
});
