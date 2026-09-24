import { defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-ring",
    displayName: "Fire Ring",
    description: "An expanding circular wall of flame that races outward, licking upward before it burns out.",
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
    const maxR = Math.max(width, height) * 0.55;
    const radius = maxR * (0.12 + 0.88 * easeOutCubic(progress));
    const fade = 1 - easeInCubic(progress);
    const thickness = Math.max(2, maxR * (0.2 - 0.1 * progress));
    const settings = fireSettings(options);
    const licks = Array.from({ length: fireCount(26, settings) }, () => ({
      angle: random() * Math.PI * 2,
      flick: random() * Math.PI * 2,
      speed: 1 + Math.floor(random() * 3),
      size: 0.5 + random() * 0.6,
      tone: random(),
    }));
    ctx.globalCompositeOperation = "lighter";
    const inner = Math.max(0, radius - thickness);
    const band = ctx.createRadialGradient(centerX, centerY, inner, centerX, centerY, radius + thickness);
    band.addColorStop(0, paint.alpha(0, 1));
    band.addColorStop(0.5, paint.alpha(0.7 * fade * options.intensity * settings.bloom, 0));
    band.addColorStop(0.72, paint.alpha(0.4 * fade * options.intensity * settings.bloom, 2));
    band.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + thickness, 0, Math.PI * 2);
    ctx.fill();
    for (const lick of licks) {
      const flare = 0.7 + 0.3 * Math.sin(lick.flick + progress * Math.PI * 2 * lick.speed * settings.turbulence);
      const lickX = centerX + Math.cos(lick.angle) * radius + settings.wind * thickness * flare;
      const lickY = centerY + Math.sin(lick.angle) * radius - thickness * 0.6 * flare * settings.flameHeight;
      const alpha = fade * (0.35 + 0.45 * lick.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const size = Math.max(1, thickness * 0.55 * lick.size * flare + dpr);
      const glow = ctx.createRadialGradient(lickX, lickY, 0, lickX, lickY, size);
      glow.addColorStop(0, paint.alpha(alpha, lick.tone > 0.6 ? 2 : 0));
      glow.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lickX, lickY, size, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
