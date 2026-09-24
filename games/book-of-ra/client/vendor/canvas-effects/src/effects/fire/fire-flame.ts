import { defineEffect } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-flame",
    displayName: "Fire Flame",
    description: "A cluster of licking flame tongues that sway and flicker upward from the base of the target.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const baseX = x + width / 2;
    const baseY = y + height * 0.98;
    const phase = progress * Math.PI * 2;
    const settings = fireSettings(options);
    const tongueCount = fireCount(9, settings);
    const tongues = Array.from({ length: tongueCount }, (_, i) => ({
      offset: (i - (tongueCount - 1) / 2) / Math.max(1, (tongueCount - 1) / 2),
      sway: random() * Math.PI * 2,
      speed: 1 + Math.floor(random() * 3),
      scale: 0.55 + random() * 0.45,
    }));
    const layers = [
      { reach: 1, spread: 1, tone: 1, alpha: 0.38 },
      { reach: 0.72, spread: 0.7, tone: 0, alpha: 0.5 },
      { reach: 0.42, spread: 0.42, tone: 2, alpha: 0.62 },
    ];
    ctx.globalCompositeOperation = "lighter";
    for (const layer of layers) {
      for (const tongue of tongues) {
        const wave = phase * tongue.speed * settings.turbulence + tongue.sway;
        const flicker = 0.78 + 0.22 * Math.sin(wave);
        const reach = height * 0.8 * layer.reach * tongue.scale * flicker * settings.flameHeight;
        const cx = baseX + tongue.offset * width * 0.24 * layer.spread + Math.sin(wave) * width * 0.04 + settings.wind * reach * 0.13;
        const cy = baseY - reach * 0.45;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, reach * 0.62));
        gradient.addColorStop(0, paint.alpha(layer.alpha * options.intensity * settings.bloom, layer.tone));
        gradient.addColorStop(1, paint.alpha(0, layer.tone));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, width * 0.17 * layer.spread * tongue.scale), Math.max(1, reach * 0.55), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
