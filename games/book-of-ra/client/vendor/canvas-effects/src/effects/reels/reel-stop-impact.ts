import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-stop-impact",
    displayName: "Reel Stop Impact",
    description: "A slamming flash bar hits the reel base, kicking up a horizontal shockwave and a spray of dust sparks.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const slamT = clamp01(progress / 0.3);
    const impactT = clamp01((progress - 0.3) / 0.7);
    const baseY = y + height * 0.92;
    ctx.globalCompositeOperation = "lighter";
    if (slamT < 1) {
      const barY = y + easeInCubic(slamT) * height * 0.92;
      const trail = ctx.createLinearGradient(x, barY - height * 0.3, x, barY);
      trail.addColorStop(0, paint.alpha(0));
      trail.addColorStop(1, paint.alpha(0.5 * options.intensity, 2));
      ctx.fillStyle = trail;
      ctx.fillRect(x, barY - height * 0.3, width, height * 0.3);
      ctx.fillStyle = paint.alpha(0.85 * options.intensity, 0);
      ctx.fillRect(x, barY - 2 * dpr, width, 4 * dpr);
      return;
    }
    const fade = 1 - impactT;
    const flash = clamp01(1 - impactT * 2.5);
    if (flash > 0) {
      const glow = ctx.createRadialGradient(x + width / 2, baseY, 0, x + width / 2, baseY, width * 0.8);
      glow.addColorStop(0, paint.alpha(0.85 * flash * options.intensity, 2));
      glow.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, width, height);
    }
    const wave = easeOutCubic(impactT);
    ctx.strokeStyle = paint.alpha(0.7 * fade * options.intensity, 0);
    ctx.lineWidth = Math.max(1, (4 - wave * 3) * dpr);
    ctx.beginPath();
    ctx.ellipse(x + width / 2, baseY, Math.max(1, width * 0.6 * wave), Math.max(1, 8 * dpr * (1 - wave * 0.5)), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = paint.alpha(0.8 * fade * options.intensity, 0);
    ctx.fillRect(x, baseY - 1.5 * dpr, width, 3 * dpr);
    for (let i = 0; i < 14; i += 1) {
      const angle = -Math.PI * (0.15 + random() * 0.7);
      const speed = 0.3 + random() * 0.7;
      const size = 1 + random() * 2;
      const travel = easeOutCubic(impactT) * speed;
      const px = x + width / 2 + Math.cos(angle) * width * 0.7 * travel;
      const py = baseY + Math.sin(angle) * height * 0.35 * travel + impactT * impactT * height * 0.12;
      const alpha = fade * (0.4 + 0.5 * random()) * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, i % 2 === 0 ? 0 : 2);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, size * dpr * (1 - impactT * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
