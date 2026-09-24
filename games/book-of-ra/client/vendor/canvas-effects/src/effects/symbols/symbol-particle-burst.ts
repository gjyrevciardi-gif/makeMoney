import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-particle-burst",
    displayName: "Symbol Particle Burst",
    description: "A dense fountain of golden and cyan particles that erupts from the centre, arcs under gravity, and twinkles out.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.7;
    const fade = clamp01(1 - progress);
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.5);
    glow.addColorStop(0, paint.alpha(0.5 * clamp01(1 - progress * 1.8) * options.intensity, 1));
    glow.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);
    for (let i = 0; i < 34; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 0.35 + random() * 0.65;
      const size = 1 + random() * 2.6;
      const twinklePhase = random() * Math.PI * 2;
      const tone = random();
      const travel = easeOutCubic(progress) * speed;
      const px = cx + Math.cos(angle) * maxR * travel;
      const py = cy + Math.sin(angle) * maxR * travel * 0.85 + progress * progress * height * 0.4;
      const twinkle = 0.6 + 0.4 * Math.sin(progress * 18 + twinklePhase);
      const alpha = fade * twinkle * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, tone > 0.72 ? 2 : tone > 0.4 ? 0 : 1);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, size * (1 - progress * 0.55) * dpr), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
