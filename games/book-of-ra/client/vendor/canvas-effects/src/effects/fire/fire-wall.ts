import { defineEffect } from "../../effect.js";
import { fireCount, fireParameters, fireSettings } from "./fire-primitives.js";

export default defineEffect({
  metadata: {
    id: "fire-wall",
    displayName: "Fire Wall",
    description: "A continuous wall of flame tongues blazing upward along the full width of the target's base.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const baseY = y + height;
    const phase = progress * Math.PI * 2;
    const settings = fireSettings(options);
    const tongueCount = fireCount(16, settings);
    const tongues = Array.from({ length: tongueCount }, (_, i) => ({
      xf: (i + 0.5) / tongueCount + (random() - 0.5) * 0.04,
      flick: random() * Math.PI * 2,
      speed: 1 + Math.floor(random() * 3),
      scale: 0.6 + random() * 0.4,
    }));
    ctx.globalCompositeOperation = "lighter";
    const bed = ctx.createLinearGradient(x, baseY, x, y + height * 0.55);
    bed.addColorStop(0, paint.alpha(0.5 * options.intensity * settings.bloom, 1));
    bed.addColorStop(0.6, paint.alpha(0.18 * options.intensity * settings.bloom, 0));
    bed.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = bed;
    ctx.fillRect(x, y + height * 0.55, width, height * 0.45);
    const layers = [
      { reach: 0.62, tone: 1, alpha: 0.4, widthScale: 1.25 },
      { reach: 0.45, tone: 0, alpha: 0.5, widthScale: 0.95 },
      { reach: 0.26, tone: 2, alpha: 0.6, widthScale: 0.6 },
    ];
    for (const layer of layers) {
      for (const tongue of tongues) {
        const wave = tongue.flick + phase * tongue.speed * settings.turbulence;
        const flicker = 0.75 + 0.25 * Math.sin(wave);
        const reach = height * layer.reach * tongue.scale * flicker * settings.flameHeight;
        const cx = x + tongue.xf * width + Math.sin(wave) * width * 0.012 + settings.wind * reach * 0.13;
        const cy = baseY - reach * 0.5;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, reach * 0.7));
        gradient.addColorStop(0, paint.alpha(layer.alpha * options.intensity * settings.bloom, layer.tone));
        gradient.addColorStop(1, paint.alpha(0, layer.tone));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, (width / tongueCount) * layer.widthScale * tongue.scale), Math.max(1, reach * 0.55), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
