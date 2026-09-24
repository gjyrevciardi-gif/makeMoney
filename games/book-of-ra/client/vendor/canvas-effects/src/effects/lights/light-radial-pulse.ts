import { clamp01, defineEffect, easeOutCubic, pulse } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-radial-pulse",
    displayName: "Light Radial Pulse",
    description: "Concentric rings of light that expand from the center and fade as they reach the edges.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const maxRadius = Math.hypot(width, height) / 2;
    ctx.globalCompositeOperation = "lighter";
    const coreAlpha = 0.45 * pulse(progress) * options.intensity;
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius * 0.4);
    core.addColorStop(0, paint.alpha(coreAlpha, 2));
    core.addColorStop(0.6, paint.alpha(coreAlpha * 0.45, 0));
    core.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    const band = maxRadius * 0.14;
    for (let ring = 0; ring < 3; ring += 1) {
      const local = clamp01(progress * 1.3 - ring * 0.15);
      if (local <= 0 || local >= 1) continue;
      const eased = easeOutCubic(local);
      const radius = maxRadius * (0.1 + eased * 0.9);
      const fade = (1 - eased) * options.intensity;
      const gradient = ctx.createRadialGradient(centerX, centerY, Math.max(0, radius - band), centerX, centerY, radius + band);
      gradient.addColorStop(0, paint.alpha(0, 1));
      gradient.addColorStop(0.5, paint.alpha(0.5 * fade, ring % 3));
      gradient.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - band, y - band, width + band * 2, height + band * 2);
    }
  },
});
