import { defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-win-pulse",
    displayName: "Symbol Win Pulse",
    description: "Rhythmic golden pulse rings radiating from the symbol centre with twinkling corner sparkles.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.62;
    const phase = progress * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    const breath = 0.5 + 0.5 * Math.sin(phase - Math.PI / 2);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    glow.addColorStop(0, paint.alpha(0.3 * breath * options.intensity, 1));
    glow.addColorStop(0.6, paint.alpha(0.16 * breath * options.intensity, 0));
    glow.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - maxR * 0.2, y - maxR * 0.2, width + maxR * 0.4, height + maxR * 0.4);
    for (let ring = 0; ring < 2; ring += 1) {
      const t = (progress + ring * 0.5) % 1;
      const eased = easeOutCubic(t);
      const alpha = (1 - eased) * 0.75 * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ring);
      ctx.lineWidth = (3.2 - eased * 2.2) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * (0.34 + eased * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
    const corners = [
      [x + width * 0.1, y + height * 0.1],
      [x + width * 0.9, y + height * 0.1],
      [x + width * 0.9, y + height * 0.9],
      [x + width * 0.1, y + height * 0.9],
    ] as const;
    ctx.lineCap = "round";
    for (const [sx, sy] of corners) {
      const twinklePhase = random() * Math.PI * 2;
      const tw = 0.5 + 0.5 * Math.sin(phase * 2 + twinklePhase);
      const size = (2.5 + tw * 4) * dpr;
      const alpha = (0.25 + 0.75 * tw) * options.intensity;
      ctx.strokeStyle = paint.alpha(alpha, 1);
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx - size, sy);
      ctx.lineTo(sx + size, sy);
      ctx.moveTo(sx, sy - size);
      ctx.lineTo(sx, sy + size);
      ctx.stroke();
    }
  },
});
