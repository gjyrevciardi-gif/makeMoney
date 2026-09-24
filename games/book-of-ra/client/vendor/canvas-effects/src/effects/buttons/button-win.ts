import { defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "button-win",
    displayName: "Button Win",
    description: "A celebratory golden payout: a centre flash, radiating light rays, an expanding ring, and scattering sparks.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.max(width, height) * 0.75;
    const decay = 1 - easeInCubic(progress);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const flash = easeOutCubic(Math.min(1, progress * 2.8)) * decay;
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(1, reach * 0.45 * flash));
    core.addColorStop(0, paint.alpha(0.9 * flash * options.intensity, 2));
    core.addColorStop(0.6, paint.alpha(0.4 * flash * options.intensity, 0));
    core.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2 + progress * 0.7 + random() * 0.2;
      const inner = reach * 0.12;
      const outer = reach * (0.3 + 0.7 * easeOutCubic(progress));
      const a = decay * options.intensity;
      const passes = [
        [6 * dpr, paint.alpha(0.16 * a, 0)],
        [1.5 * dpr, paint.alpha(0.75 * a, 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
        ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
        ctx.stroke();
      }
    }
    const ringRadius = Math.max(1, reach * easeOutCubic(progress));
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = paint.alpha(0.7 * decay * options.intensity, 2);
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 0.4 + random() * 0.6;
      const tone = random();
      const travel = easeOutCubic(progress) * speed * reach;
      const sparkX = centerX + Math.cos(angle) * travel;
      const sparkY = centerY + Math.sin(angle) * travel + progress * progress * height * 0.25;
      const a = decay * (0.4 + 0.6 * tone) * options.intensity;
      if (a <= 0.01) continue;
      ctx.fillStyle = paint.alpha(a, tone > 0.6 ? 2 : 0);
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, Math.max(0.6, (1 + tone * 1.6) * dpr * (1 - progress * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
