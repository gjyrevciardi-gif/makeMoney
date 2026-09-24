import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-wipe",
    displayName: "Reel Wipe",
    description: "A brilliant light band sweeps down the reel leaving a fading luminous wake and trailing sparkles.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const bandH = height * 0.22;
    const sweep = easeInOutCubic(progress);
    const bandY = y - bandH + sweep * (height + bandH * 2);
    const fade = clamp01((1 - progress) * 4);
    ctx.globalCompositeOperation = "lighter";
    const wakeTop = Math.max(y, bandY - height * 0.45);
    if (bandY > wakeTop) {
      const wake = ctx.createLinearGradient(x, wakeTop, x, bandY);
      wake.addColorStop(0, paint.alpha(0));
      wake.addColorStop(1, paint.alpha(0.22 * fade * options.intensity, 1));
      ctx.fillStyle = wake;
      ctx.fillRect(x, wakeTop, width, bandY - wakeTop);
    }
    const band = ctx.createLinearGradient(x, bandY - bandH / 2, x, bandY + bandH / 2);
    band.addColorStop(0, paint.alpha(0));
    band.addColorStop(0.5, paint.alpha(0.75 * fade * options.intensity, 2));
    band.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = band;
    ctx.fillRect(x, bandY - bandH / 2, width, bandH);
    ctx.fillStyle = paint.alpha(0.85 * fade * options.intensity, 0);
    const coreY = Math.min(y + height, Math.max(y, bandY));
    ctx.fillRect(x, coreY - 1.5 * dpr, width, 3 * dpr);
    for (let i = 0; i < 12; i += 1) {
      const sx = x + random() * width;
      const lagBase = random() * 0.3;
      const twinklePhase = random() * Math.PI * 2;
      const sy = bandY - lagBase * height;
      if (sy < y || sy > y + height) continue;
      const twinkle = 0.5 + 0.5 * Math.sin(progress * 20 + twinklePhase);
      const alpha = fade * twinkle * (1 - lagBase * 2.5) * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = paint.alpha(alpha, i % 2 === 0 ? 0 : 2);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.6, (1 + random() * 1.6) * dpr), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
