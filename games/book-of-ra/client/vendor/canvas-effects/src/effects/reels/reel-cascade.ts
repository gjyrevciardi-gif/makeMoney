import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-cascade",
    displayName: "Reel Cascade",
    description: "A glittering trail of sparkles tumbles down the reel, each mote trailing a soft luminous streak as it falls.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i += 1) {
      const sx = x + width * (0.06 + random() * 0.88);
      const offset = random();
      const speed = 1 + Math.floor(random() * 2);
      const size = 1 + random() * 2;
      const swayPhase = random() * Math.PI * 2;
      const twinklePhase = random() * Math.PI * 2;
      const tone = random();
      const t = (offset + progress * speed) % 1;
      const trail = height * (0.08 + random() * 0.08);
      const py = y + t * (height + trail) - trail;
      const px = sx + Math.sin(t * Math.PI * 4 + swayPhase) * width * 0.04;
      const edgeFade = Math.min(1, Math.min((py - y + trail) / (height * 0.15), (y + height - py + trail) / (height * 0.15)));
      const twinkle = 0.55 + 0.45 * Math.sin(progress * Math.PI * 2 * 5 + twinklePhase);
      const alpha = Math.max(0, edgeFade) * twinkle * 0.8 * options.intensity;
      if (alpha <= 0.02) continue;
      const paletteIndex = tone > 0.7 ? 2 : tone > 0.35 ? 0 : 1;
      const streak = ctx.createLinearGradient(px, py - trail, px, py);
      streak.addColorStop(0, paint.alpha(0, paletteIndex));
      streak.addColorStop(1, paint.alpha(alpha * 0.5, paletteIndex));
      ctx.strokeStyle = streak;
      ctx.lineWidth = size * dpr * 0.8;
      ctx.beginPath();
      ctx.moveTo(px, Math.max(y, py - trail));
      ctx.lineTo(px, Math.min(y + height, Math.max(y, py)));
      ctx.stroke();
      if (py >= y && py <= y + height) {
        ctx.fillStyle = paint.alpha(alpha, paletteIndex);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.6, size * dpr), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
