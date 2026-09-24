import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-transform",
    displayName: "Symbol Transform",
    description: "Motes of light spiral inward and compress into a brilliant flash that blooms outward as the new symbol is revealed.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.65;
    const gatherT = clamp01(progress / 0.55);
    const bloomT = clamp01((progress - 0.55) / 0.45);
    ctx.globalCompositeOperation = "lighter";
    if (gatherT < 1) {
      for (let i = 0; i < 20; i += 1) {
        const baseAngle = random() * Math.PI * 2;
        const startR = 0.6 + random() * 0.4;
        const swirl = 2.2 + random() * 1.4;
        const tone = i % 3;
        const pull = easeInCubic(gatherT);
        const r = maxR * startR * (1 - pull);
        const angle = baseAngle + swirl * gatherT;
        const alpha = (0.35 + 0.55 * gatherT) * options.intensity;
        ctx.fillStyle = paint.alpha(alpha, tone);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * 0.9, Math.max(0.6, (1.2 + random() * 1.6) * dpr), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const charge = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, maxR * (0.12 + gatherT * 0.25)));
    charge.addColorStop(0, paint.alpha(0.85 * gatherT * (1 - bloomT) * options.intensity, 1));
    charge.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = charge;
    ctx.fillRect(x, y, width, height);
    if (bloomT > 0) {
      const bloom = easeOutCubic(bloomT);
      const fade = 1 - bloomT;
      const flare = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, maxR * (0.2 + bloom * 0.9)));
      flare.addColorStop(0, paint.alpha(0.95 * fade * options.intensity, 1));
      flare.addColorStop(0.5, paint.alpha(0.45 * fade * options.intensity, 0));
      flare.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = flare;
      ctx.fillRect(x - maxR * 0.3, y - maxR * 0.3, width + maxR * 0.6, height + maxR * 0.6);
      ctx.strokeStyle = paint.alpha(0.7 * fade * options.intensity, 2);
      ctx.lineWidth = Math.max(1, (4 - bloom * 3) * dpr);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, maxR * bloom), 0, Math.PI * 2);
      ctx.stroke();
    }
  },
});
