import { defineEffect } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-embers",
    displayName: "Fire Embers",
    description: "Glowing embers that drift upward from the base of the target, swaying and winking out near the top.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const settings = fireSettings(options);
    const embers = Array.from({ length: fireCount(36, settings) }, () => ({
      xf: random(),
      phase: random(),
      rise: 0.55 + random() * 0.4,
      sway: random() * Math.PI * 2,
      swayAmp: 0.02 + random() * 0.05,
      size: 1 + random() * 2.4,
      tone: random(),
    }));
    ctx.globalCompositeOperation = "lighter";
    const bed = ctx.createLinearGradient(x, y + height, x, y + height * 0.8);
    bed.addColorStop(0, paint.alpha(0.22 * options.intensity * settings.bloom, 1));
    bed.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = bed;
    ctx.fillRect(x, y + height * 0.8, width, height * 0.2);
    for (const ember of embers) {
      const cycle = (progress + ember.phase) % 1;
      const life = Math.sin(Math.PI * cycle);
      const alpha = life * (0.35 + 0.55 * ember.tone) * options.intensity * settings.embers;
      if (alpha <= 0.01) continue;
      const px = x + ember.xf * width + Math.sin(ember.sway + cycle * Math.PI * 3 * settings.turbulence) * width * ember.swayAmp + settings.wind * width * cycle * 0.22;
      const py = y + height * 0.98 - cycle * height * ember.rise * settings.flameHeight;
      const size = Math.max(0.5, ember.size * dpr * (0.6 + 0.4 * life));
      const glow = ctx.createRadialGradient(px, py, 0, px, py, size * 3);
      glow.addColorStop(0, paint.alpha(alpha * 0.5 * settings.bloom, 0));
      glow.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, size * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = paint.alpha(alpha, ember.tone > 0.7 ? 2 : ember.tone > 0.3 ? 0 : 1);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
