import { clamp01, defineEffect, easeOutBack, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-pop",
    displayName: "Symbol Pop",
    description: "A snappy overshooting burst ring and bright central flash that pops outward and dissolves into sparkles.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.58;
    const fade = clamp01(1 - progress);
    ctx.globalCompositeOperation = "lighter";
    const flash = clamp01(1 - progress * 2.2);
    if (flash > 0) {
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.7);
      core.addColorStop(0, paint.alpha(0.9 * flash * options.intensity, 1));
      core.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    const pop = easeOutBack(clamp01(progress * 1.4));
    const ringR = Math.max(1, maxR * 0.28 + maxR * 0.62 * pop);
    ctx.strokeStyle = paint.alpha(0.8 * fade * options.intensity, 0);
    ctx.lineWidth = Math.max(0.8, (4 - progress * 3) * dpr);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = paint.alpha(0.45 * fade * options.intensity, 2);
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 10; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 0.55 + random() * 0.45;
      const size = 1.2 + random() * 2;
      const tone = random() > 0.6 ? 2 : 0;
      const travel = easeOutCubic(progress) * speed;
      const px = cx + Math.cos(angle) * maxR * travel;
      const py = cy + Math.sin(angle) * maxR * travel;
      const alpha = fade * 0.8 * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, tone);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, size * (1 - progress * 0.5) * dpr), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
