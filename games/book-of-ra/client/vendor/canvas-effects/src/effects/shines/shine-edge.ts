import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-edge",
    displayName: "Shine Edge",
    description: "A bright highlight that races along the border of the target, trailing a soft glow.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const inset = Math.max(2 * dpr, Math.min(width, height) * 0.03);
    const left = x + inset;
    const top = y + inset;
    const innerWidth = width - inset * 2;
    const innerHeight = height - inset * 2;
    const perimeter = 2 * (innerWidth + innerHeight);
    const envelope = options.loop ? 1 : Math.pow(Math.sin(Math.PI * progress), 0.5);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = paint.alpha(0.14 * envelope * options.intensity, 1);
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.strokeRect(left, top, innerWidth, innerHeight);
    const samples = 56;
    const dotRadius = Math.max(2 * dpr, Math.min(innerWidth, innerHeight) * 0.06);
    for (let index = 0; index < samples; index += 1) {
      const along = index / samples;
      const gap = Math.abs(along - progress);
      const distance = Math.min(gap, 1 - gap);
      const falloff = Math.pow(Math.max(0, 1 - distance / 0.11), 2);
      if (falloff <= 0.02) continue;
      const travel = along * perimeter;
      let dotX: number;
      let dotY: number;
      if (travel < innerWidth) {
        dotX = left + travel;
        dotY = top;
      } else if (travel < innerWidth + innerHeight) {
        dotX = left + innerWidth;
        dotY = top + (travel - innerWidth);
      } else if (travel < innerWidth * 2 + innerHeight) {
        dotX = left + innerWidth - (travel - innerWidth - innerHeight);
        dotY = top + innerHeight;
      } else {
        dotX = left;
        dotY = top + innerHeight - (travel - innerWidth * 2 - innerHeight);
      }
      const alpha = falloff * envelope * options.intensity;
      const radius = dotRadius * (0.6 + falloff);
      const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, radius);
      glow.addColorStop(0, paint.alpha(alpha, 0));
      glow.addColorStop(0.5, paint.alpha(alpha * 0.5, 2));
      glow.addColorStop(1, paint.alpha(0, 2));
      ctx.fillStyle = glow;
      ctx.fillRect(dotX - radius, dotY - radius, radius * 2, radius * 2);
    }
  },
});
