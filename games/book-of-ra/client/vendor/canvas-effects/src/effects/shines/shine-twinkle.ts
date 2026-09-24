import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-twinkle",
    displayName: "Shine Twinkle",
    description: "A constellation of tiny cross-shaped stars that twinkle softly in place.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const base = Math.min(width, height);
    const stars = Array.from({ length: 14 }, () => ({
      sx: x + width * (0.06 + random() * 0.88),
      sy: y + height * (0.06 + random() * 0.88),
      size: base * (0.03 + random() * 0.05),
      phase: random() * Math.PI * 2,
      rate: 1 + Math.floor(random() * 3),
      tone: Math.floor(random() * 3),
    }));
    ctx.globalCompositeOperation = "lighter";
    for (const star of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 * star.rate + star.phase);
      const alpha = twinkle * twinkle * options.intensity;
      if (alpha <= 0.02) continue;
      const armLength = star.size * (0.6 + 0.5 * twinkle);
      const armWidth = Math.max(0.7, armLength * 0.18 * dpr);
      ctx.fillStyle = paint.alpha(0.9 * alpha, star.tone);
      ctx.beginPath();
      ctx.moveTo(star.sx, star.sy - armLength);
      ctx.lineTo(star.sx + armWidth, star.sy);
      ctx.lineTo(star.sx, star.sy + armLength);
      ctx.lineTo(star.sx - armWidth, star.sy);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(star.sx - armLength, star.sy);
      ctx.lineTo(star.sx, star.sy + armWidth);
      ctx.lineTo(star.sx + armLength, star.sy);
      ctx.lineTo(star.sx, star.sy - armWidth);
      ctx.closePath();
      ctx.fill();
      const glow = ctx.createRadialGradient(star.sx, star.sy, 0, star.sx, star.sy, armLength * 1.4);
      glow.addColorStop(0, paint.alpha(0.4 * alpha, 0));
      glow.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = glow;
      const extent = armLength * 1.4;
      ctx.fillRect(star.sx - extent, star.sy - extent, extent * 2, extent * 2);
    }
  },
});
