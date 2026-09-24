import { defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-burst",
    displayName: "Laser Burst",
    description: "A radial volley of laser bolts firing outward from the centre with a bright ignition flash.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.max(width, height) * 0.62;
    const beams = Array.from({ length: 10 }, (_, i) => ({
      angle: (i / 10) * Math.PI * 2 + (random() - 0.5) * 0.5,
      reach: 0.7 + random() * 0.3,
      tone: random(),
    }));
    const decay = 1 - easeInCubic(progress);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const flash = 1 - easeOutCubic(Math.min(1, progress * 3));
    if (flash > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach * 0.4);
      core.addColorStop(0, paint.alpha(0.85 * flash * options.intensity, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
    for (const beam of beams) {
      const outer = reach * beam.reach * easeOutCubic(progress);
      const inner = reach * beam.reach * easeInCubic(progress);
      const a = decay * (0.6 + 0.4 * beam.tone) * options.intensity;
      if (a <= 0.01 || outer - inner < 1) continue;
      const dirX = Math.cos(beam.angle);
      const dirY = Math.sin(beam.angle);
      const passes = [
        [6 * dpr, paint.alpha(0.2 * a, 1)],
        [1.4 * dpr, paint.alpha(0.9 * a, beam.tone > 0.6 ? 2 : 0)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(centerX + dirX * inner, centerY + dirY * inner);
        ctx.lineTo(centerX + dirX * outer, centerY + dirY * outer);
        ctx.stroke();
      }
    }
  },
});
