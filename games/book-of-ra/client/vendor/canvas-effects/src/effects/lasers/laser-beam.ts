import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-beam",
    displayName: "Laser Beam",
    description: "A sustained full-width energy beam that snaps on, shimmers with a hot core, and powers down.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const midY = y + height / 2;
    const ramp = easeOutCubic(clamp01(progress * 3));
    const decay = 1 - easeInCubic(clamp01((progress - 0.7) / 0.3));
    const flicker = 0.9 + 0.1 * Math.sin(progress * 52);
    const a = ramp * decay * flicker * options.intensity;
    const halo = Math.max(4 * dpr, height * 0.3 * ramp);
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createLinearGradient(x, midY - halo, x, midY + halo);
    glow.addColorStop(0, paint.alpha(0, 1));
    glow.addColorStop(0.5, paint.alpha(0.34 * a, 0));
    glow.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = glow;
    ctx.fillRect(x, midY - halo, width, halo * 2);
    ctx.lineCap = "round";
    const passes = [
      [9 * dpr * (0.5 + 0.5 * ramp), paint.alpha(0.3 * a, 1)],
      [4 * dpr * (0.5 + 0.5 * ramp), paint.alpha(0.55 * a, 0)],
      [1.8 * dpr, paint.alpha(a, 2)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x, midY);
      ctx.lineTo(x + width, midY);
      ctx.stroke();
    }
  },
});
