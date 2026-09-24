import { clamp01, defineEffect, easeInCubic, easeOutBack } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-sparkle",
    displayName: "Shine Sparkle",
    description: "Little four-point sparkles that pop into life at random spots, swell, and wink out.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const base = Math.min(width, height);
    const sparkles = Array.from({ length: 16 }, () => ({
      sx: x + width * (0.08 + random() * 0.84),
      sy: y + height * (0.08 + random() * 0.84),
      size: base * (0.05 + random() * 0.08),
      delay: random(),
      tone: Math.floor(random() * 3),
    }));
    ctx.globalCompositeOperation = "lighter";
    for (const sparkle of sparkles) {
      const local = (progress - sparkle.delay + 1) % 1;
      const life = local / 0.3;
      if (life > 1) continue;
      const scale = easeOutBack(clamp01(life / 0.5));
      const fade = 1 - easeInCubic(life);
      const alpha = fade * options.intensity;
      if (alpha <= 0.02) continue;
      const armLength = sparkle.size * scale;
      const armWidth = Math.max(0.8, sparkle.size * 0.14 * scale * dpr);
      ctx.fillStyle = paint.alpha(0.9 * alpha, sparkle.tone);
      ctx.beginPath();
      ctx.moveTo(sparkle.sx, sparkle.sy - armLength);
      ctx.lineTo(sparkle.sx + armWidth, sparkle.sy);
      ctx.lineTo(sparkle.sx, sparkle.sy + armLength);
      ctx.lineTo(sparkle.sx - armWidth, sparkle.sy);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sparkle.sx - armLength, sparkle.sy);
      ctx.lineTo(sparkle.sx, sparkle.sy + armWidth);
      ctx.lineTo(sparkle.sx + armLength, sparkle.sy);
      ctx.lineTo(sparkle.sx, sparkle.sy - armWidth);
      ctx.closePath();
      ctx.fill();
      const glow = ctx.createRadialGradient(sparkle.sx, sparkle.sy, 0, sparkle.sx, sparkle.sy, armLength);
      glow.addColorStop(0, paint.alpha(0.5 * alpha, 0));
      glow.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(sparkle.sx - armLength, sparkle.sy - armLength, armLength * 2, armLength * 2);
    }
  },
});
