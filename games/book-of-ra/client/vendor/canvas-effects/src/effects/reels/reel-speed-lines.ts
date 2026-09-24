import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-speed-lines",
    displayName: "Reel Speed Lines",
    description: "Thin high-velocity streaks with bright heads and tapering tails whip down the reel in staggered lanes.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < 10; i += 1) {
      const sx = x + width * (0.1 + random() * 0.8);
      const length = height * (0.12 + random() * 0.18);
      const offset = random();
      const speed = 3 + Math.floor(random() * 3);
      const tone = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
      const alpha = (0.35 + random() * 0.4) * options.intensity;
      const headY = y + ((offset + progress * speed) % 1) * (height + length) - length;
      const tailY = headY - length;
      const clampedHead = Math.min(y + height, Math.max(y, headY));
      const clampedTail = Math.min(y + height, Math.max(y, tailY));
      if (clampedHead - clampedTail < 1) continue;
      const grad = ctx.createLinearGradient(sx, clampedTail, sx, clampedHead);
      grad.addColorStop(0, paint.alpha(0, tone));
      grad.addColorStop(1, paint.alpha(alpha, tone));
      ctx.strokeStyle = grad;
      ctx.lineWidth = (0.8 + random() * 1.4) * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, clampedTail);
      ctx.lineTo(sx, clampedHead);
      ctx.stroke();
      if (headY > y && headY < y + height) {
        ctx.fillStyle = paint.alpha(alpha, 2);
        ctx.beginPath();
        ctx.arc(sx, headY, 1.3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
