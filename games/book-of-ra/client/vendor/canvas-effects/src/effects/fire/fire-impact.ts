import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-impact",
    displayName: "Fire Impact",
    description: "A hard fiery hit: a hot flash, a fast expanding shockwave ring, and straight radiating sparks.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const maxR = Math.max(width, height) * 0.6;
    const settings = fireSettings(options);
    const sparks = Array.from({ length: fireCount(22, settings) }, () => ({
      angle: random() * Math.PI * 2,
      reach: 0.5 + random() * 0.5,
      thickness: 0.6 + random() * 0.9,
      tone: random(),
    }));
    const decay = clamp01(1 - progress);
    ctx.globalCompositeOperation = "lighter";
    const flashAlpha = clamp01(1 - progress * 2.6) * options.intensity;
    if (flashAlpha > 0.01) {
      const flash = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR * 0.55);
      flash.addColorStop(0, paint.alpha(flashAlpha * settings.bloom, 2));
      flash.addColorStop(0.5, paint.alpha(flashAlpha * 0.6 * settings.bloom, 0));
      flash.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = flash;
      ctx.fillRect(x, y, width, height);
    }
    const waveR = maxR * easeOutCubic(progress);
    const waveAlpha = decay * 0.8 * options.intensity;
    if (waveAlpha > 0.01 && waveR > 1) {
      ctx.strokeStyle = paint.alpha(waveAlpha, 0);
      ctx.lineWidth = Math.max(1, maxR * 0.05 * decay + dpr);
      ctx.beginPath();
      ctx.arc(centerX, centerY, waveR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineCap = "round";
    const travel = easeOutCubic(progress);
    for (const spark of sparks) {
      const alpha = decay * (0.4 + 0.5 * spark.tone) * options.intensity * settings.embers;
      if (alpha <= 0.01) continue;
      const r0 = maxR * spark.reach * travel * 0.55;
      const r1 = maxR * spark.reach * (0.15 + travel * 0.85);
      ctx.strokeStyle = paint.alpha(alpha, spark.tone > 0.6 ? 2 : 1);
      ctx.lineWidth = Math.max(0.6, spark.thickness * dpr * (1.4 - travel));
      ctx.beginPath();
      const wind = settings.wind * maxR * progress * 0.14;
      ctx.moveTo(centerX + Math.cos(spark.angle) * r0 + wind * 0.4, centerY + Math.sin(spark.angle) * r0);
      ctx.lineTo(centerX + Math.cos(spark.angle) * r1 + wind, centerY + Math.sin(spark.angle) * r1);
      ctx.stroke();
    }
  },
});
