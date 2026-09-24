import { clamp01, defineEffect, easeInCubic, easeOutCubic, pulse } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-target",
    displayName: "Laser Target",
    description: "A rotating lock-on reticle that spins in, tightens onto the centre, and flashes on lock.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const lock = easeOutCubic(clamp01(progress * 1.4));
    const radius = Math.min(width, height) * (0.46 - 0.24 * lock);
    const rotation = (1 - lock) * Math.PI * 1.5;
    const fade = 1 - easeInCubic(clamp01((progress - 0.85) / 0.15));
    const a = Math.min(1, progress * 8) * fade * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const arcs = 4;
    const sweep = 0.9;
    const passes = [
      [7 * dpr, paint.alpha(0.18 * a, 1)],
      [1.6 * dpr, paint.alpha(0.9 * a, 0)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      for (let i = 0; i < arcs; i++) {
        const start = rotation + (i / arcs) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, start, start + sweep);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = paint.alpha(0.7 * a, 2);
    for (let i = 0; i < 4; i++) {
      const angle = rotation * 0.5 + (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * radius * 0.55, centerY + Math.sin(angle) * radius * 0.55);
      ctx.lineTo(centerX + Math.cos(angle) * radius * 0.8, centerY + Math.sin(angle) * radius * 0.8);
      ctx.stroke();
    }
    const flash = pulse(clamp01((progress - 0.65) / 0.3)) * fade;
    if (flash > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.4);
      core.addColorStop(0, paint.alpha(0.8 * flash * options.intensity, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
  },
});
