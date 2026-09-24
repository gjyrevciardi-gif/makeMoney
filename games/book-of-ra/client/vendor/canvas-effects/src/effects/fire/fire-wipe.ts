import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-wipe",
    displayName: "Fire Wipe",
    description: "A vertical curtain of flame that sweeps across the target from left to right, then burns away.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const sweep = easeInOutCubic(clamp01(progress / 0.8));
    const fade = clamp01((1 - progress) / 0.2);
    const frontX = x + width * sweep;
    const band = Math.max(4, width * 0.22);
    const settings = fireSettings(options);
    const tongues = Array.from({ length: fireCount(15, settings) }, () => ({
      yf: random(),
      flick: random() * Math.PI * 2,
      size: 0.5 + random() * 0.7,
      tone: random(),
    }));
    ctx.globalCompositeOperation = "lighter";
    const trail = ctx.createLinearGradient(Math.max(x, frontX - band * 2.4), y, frontX, y);
    trail.addColorStop(0, paint.alpha(0, 1));
    trail.addColorStop(0.65, paint.alpha(0.28 * fade * options.intensity * settings.bloom, 1));
    trail.addColorStop(1, paint.alpha(0.6 * fade * options.intensity * settings.bloom, 0));
    ctx.fillStyle = trail;
    ctx.fillRect(Math.max(x, frontX - band * 2.4), y, Math.min(band * 2.4, frontX - x), height);
    const front = ctx.createLinearGradient(frontX - band * 0.4, y, frontX + band * 0.5, y);
    front.addColorStop(0, paint.alpha(0.5 * fade * options.intensity, 0));
    front.addColorStop(0.45, paint.alpha(0.85 * fade * options.intensity, 2));
    front.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = front;
    ctx.fillRect(frontX - band * 0.4, y, band * 0.9, height);
    for (const tongue of tongues) {
      const flicker = 0.7 + 0.3 * Math.sin(tongue.flick + progress * Math.PI * 6 * settings.turbulence);
      const px = frontX + band * 0.28 * flicker * tongue.size + settings.wind * band * 0.35;
      const py = y + tongue.yf * height;
      const alpha = fade * flicker * (0.35 + 0.45 * tongue.tone) * options.intensity;
      if (alpha <= 0.01) continue;
      const size = Math.max(1, band * 0.4 * tongue.size * settings.flameHeight + dpr);
      const glow = ctx.createRadialGradient(px, py, 0, px, py, size);
      glow.addColorStop(0, paint.alpha(alpha, tongue.tone > 0.6 ? 2 : 0));
      glow.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
