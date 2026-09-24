import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-explode",
    displayName: "Symbol Explode",
    description: "The cell shatters into spinning shards flung outward behind a shockwave ring and hot central flash.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.75;
    const fade = clamp01(1 - progress);
    ctx.globalCompositeOperation = "lighter";
    const flash = clamp01(1 - progress * 3);
    if (flash > 0) {
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.6);
      core.addColorStop(0, paint.alpha(0.95 * flash * options.intensity, 1));
      core.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = core;
      ctx.fillRect(x - maxR * 0.2, y - maxR * 0.2, width + maxR * 0.4, height + maxR * 0.4);
    }
    const wave = easeOutCubic(clamp01(progress * 1.6));
    ctx.strokeStyle = paint.alpha(0.6 * (1 - wave) * options.intensity, 2);
    ctx.lineWidth = Math.max(1, (5 - wave * 4) * dpr);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, maxR * wave), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 16; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 0.5 + random() * 0.5;
      const size = (4 + random() * 7) * dpr;
      const spin = (random() - 0.5) * 9;
      const tone = i % 3;
      const travel = easeOutCubic(progress) * speed;
      const px = cx + Math.cos(angle) * maxR * travel;
      const py = cy + Math.sin(angle) * maxR * travel + progress * progress * height * 0.22;
      const alpha = fade * (0.55 + 0.35 * random()) * options.intensity;
      if (alpha <= 0.02) continue;
      const rot = angle + progress * spin;
      const shard = size * (1 - progress * 0.45);
      ctx.fillStyle = paint.alpha(alpha, tone);
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(rot) * shard, py + Math.sin(rot) * shard);
      ctx.lineTo(px + Math.cos(rot + 2.3) * shard * 0.6, py + Math.sin(rot + 2.3) * shard * 0.6);
      ctx.lineTo(px + Math.cos(rot + 4.2) * shard * 0.8, py + Math.sin(rot + 4.2) * shard * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  },
});
