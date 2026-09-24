import { clamp01, defineEffect, easeOutBack, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-wild-reveal",
    displayName: "Symbol Wild Reveal",
    description: "A blinding golden burst with a spinning star flare whose rays sweep round as sparkles shower outward.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.72;
    const reveal = easeOutBack(clamp01(progress * 1.6));
    const fade = clamp01((1 - progress) * 2.5);
    ctx.globalCompositeOperation = "lighter";
    const burst = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, maxR * (0.3 + reveal * 0.7)));
    burst.addColorStop(0, paint.alpha(0.9 * fade * options.intensity, 1));
    burst.addColorStop(0.4, paint.alpha(0.5 * fade * options.intensity, 0));
    burst.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = burst;
    ctx.fillRect(x - maxR * 0.3, y - maxR * 0.3, width + maxR * 0.6, height + maxR * 0.6);
    const spin = easeOutCubic(progress) * Math.PI * 1.5;
    for (let ray = 0; ray < 6; ray += 1) {
      const angle = spin + (ray / 6) * Math.PI * 2;
      const long = maxR * (0.35 + reveal * 0.65) * (ray % 2 === 0 ? 1 : 0.62);
      const wide = long * 0.12;
      const alpha = 0.6 * fade * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, ray % 2 === 0 ? 0 : 1);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * long, cy + Math.sin(angle) * long);
      ctx.lineTo(cx + Math.cos(angle + Math.PI / 2) * wide, cy + Math.sin(angle + Math.PI / 2) * wide);
      ctx.lineTo(cx + Math.cos(angle + Math.PI) * long * 0.12, cy + Math.sin(angle + Math.PI) * long * 0.12);
      ctx.lineTo(cx + Math.cos(angle - Math.PI / 2) * wide, cy + Math.sin(angle - Math.PI / 2) * wide);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 14; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 0.4 + random() * 0.6;
      const twinklePhase = random() * Math.PI * 2;
      const travel = easeOutCubic(clamp01(progress * 1.2)) * speed;
      const alpha = fade * (0.55 + 0.45 * Math.sin(progress * 14 + twinklePhase)) * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, i % 2 === 0 ? 1 : 2);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * maxR * travel, cy + Math.sin(angle) * maxR * travel, Math.max(0.6, (1 + random() * 1.8) * dpr), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
