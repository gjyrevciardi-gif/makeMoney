import { clamp01, defineEffect, easeOutBack } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-lock",
    displayName: "Reel Lock",
    description: "Heavy corner brackets clamp onto the reel with a locking flash, then hold with a pulsing golden bar and shackle.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const clampT = options.loop ? 1 : easeOutBack(clamp01(progress / 0.28));
    const flash = options.loop ? 0 : clamp01(1 - Math.abs(progress - 0.3) / 0.12);
    const holdPulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 * 2 - Math.PI / 2);
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "square";
    const arm = Math.min(width, height) * 0.2;
    const slide = (1 - clampT) * Math.min(width, height) * 0.3;
    const corners = [
      [x + 4 * dpr, y + 4 * dpr, 1, 1],
      [x + width - 4 * dpr, y + 4 * dpr, -1, 1],
      [x + width - 4 * dpr, y + height - 4 * dpr, -1, -1],
      [x + 4 * dpr, y + height - 4 * dpr, 1, -1],
    ] as const;
    for (const [cornerX, cornerY, sx, sy] of corners) {
      const bx = cornerX - sx * slide;
      const by = cornerY - sy * slide;
      const alpha = (0.55 + 0.35 * holdPulse) * clamp01(clampT) * options.intensity;
      ctx.strokeStyle = paint.alpha(alpha, 0);
      ctx.lineWidth = 4 * dpr;
      ctx.beginPath();
      ctx.moveTo(bx + sx * arm, by);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx, by + sy * arm);
      ctx.stroke();
      ctx.strokeStyle = paint.alpha(alpha * 0.8, 2);
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
    }
    const barAlpha = (0.35 + 0.3 * holdPulse) * clampT * options.intensity;
    const bar = ctx.createLinearGradient(x, cy, x + width, cy);
    bar.addColorStop(0, paint.alpha(0));
    bar.addColorStop(0.5, paint.alpha(barAlpha, 0));
    bar.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = bar;
    ctx.fillRect(x, cy - 3 * dpr, width, 6 * dpr);
    const shackleR = Math.min(width, height) * 0.12;
    ctx.strokeStyle = paint.alpha((0.5 + 0.35 * holdPulse) * clampT * options.intensity, 1);
    ctx.lineWidth = 2.6 * dpr;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy - shackleR * 0.4, shackleR, Math.PI, Math.PI * 2);
    ctx.stroke();
    if (flash > 0.02) {
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.7);
      glow.addColorStop(0, paint.alpha(0.7 * flash * options.intensity, 2));
      glow.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, width, height);
    }
  },
});
