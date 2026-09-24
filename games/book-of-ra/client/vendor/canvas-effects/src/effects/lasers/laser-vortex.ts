import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-vortex",
    displayName: "Laser Vortex",
    description: "Spiralling laser arms that rotate around the centre while converging into a glowing core.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const outer = Math.hypot(width, height) / 2;
    const arms = 6;
    const rotation = progress * Math.PI * 2;
    const twist = 2.4;
    const samples = 28;
    const a = options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const atmosphere = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outer * 0.52);
    atmosphere.addColorStop(0, paint.alpha(0.16 * a, 2));
    atmosphere.addColorStop(0.32, paint.alpha(0.09 * a, 0));
    atmosphere.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = atmosphere;
    ctx.fillRect(x, y, width, height);
    for (let i = 0; i < arms; i++) {
      const base = rotation + (i / arms) * Math.PI * 2;
      const passes = [
        [11 * dpr, paint.alpha(0.08 * a, 1), 9 * dpr],
        [3.2 * dpr, paint.alpha(0.42 * a, 0), 4 * dpr],
        [1.1 * dpr, paint.alpha(0.95 * a, 2), 1.5 * dpr],
      ] as const;
      for (const [lineWidth, style, blur] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.shadowBlur = blur;
        ctx.shadowColor = paint.alpha(0.8 * a, 0);
        ctx.beginPath();
        for (let k = 0; k <= samples; k++) {
          const s = k / samples;
          const angle = base + s * twist;
          const radius = outer * (1 - s * 0.92);
          const px = centerX + Math.cos(angle) * radius;
          const py = centerY + Math.sin(angle) * radius;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    const coreGlow = (0.45 + 0.25 * Math.sin(progress * Math.PI * 4)) * a;
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outer * 0.22);
    core.addColorStop(0, paint.alpha(coreGlow, 2));
    core.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = paint.alpha(0.65 * a, 2);
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outer * (0.075 + 0.012 * Math.sin(progress * Math.PI * 4)), 0, Math.PI * 2);
    ctx.stroke();
  },
});
