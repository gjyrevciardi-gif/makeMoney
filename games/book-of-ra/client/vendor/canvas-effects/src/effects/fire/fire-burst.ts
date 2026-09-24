import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-burst",
    displayName: "Fire Burst",
    description: "A radial burst of embers and flame licks that flares fast and decays into drifting sparks.",
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
    const radius = Math.max(width, height) * 0.55;
    const settings = fireSettings(options);
    const sparks = Array.from({ length: fireCount(30, settings) }, () => ({
      angle: random() * Math.PI * 2,
      speed: 0.45 + random() * 0.55,
      size: 1.5 + random() * 3,
      wobble: random() * Math.PI * 2,
      tone: random(),
    }));
    const flare = easeOutCubic(clamp01(progress * 2.4));
    const decay = clamp01(1 - progress);
    ctx.globalCompositeOperation = "lighter";
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(1, radius * (0.25 + flare * 0.35)));
    core.addColorStop(0, paint.alpha(0.85 * decay * options.intensity * settings.bloom, 2));
    core.addColorStop(0.5, paint.alpha(0.5 * decay * options.intensity * settings.bloom, 0));
    core.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    for (const spark of sparks) {
      const travel = easeOutCubic(progress) * spark.speed;
      const drift = Math.sin(spark.wobble + progress * 6 * settings.turbulence) * radius * 0.06;
      const sparkX = centerX + Math.cos(spark.angle) * radius * travel + drift + settings.wind * radius * progress * 0.2;
      const sparkY = centerY + Math.sin(spark.angle) * radius * travel - progress * height * 0.18;
      const alpha = decay * (0.5 + 0.5 * spark.tone) * options.intensity * settings.embers;
      if (alpha <= 0.01) continue;
      const size = spark.size * (1 - progress * 0.6) * dpr;
      ctx.fillStyle = paint.alpha(alpha, spark.tone > 0.7 ? 2 : spark.tone > 0.35 ? 0 : 1);
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, Math.max(0.5, size), 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
