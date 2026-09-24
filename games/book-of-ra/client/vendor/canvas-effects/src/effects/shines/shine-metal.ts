import { defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-metal",
    displayName: "Shine Metal",
    description: "A brushed-metal specular band that passes across, lighting up fine anisotropic streaks.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const diagonal = Math.hypot(width, height);
    const half = diagonal / 2;
    const bandWidth = diagonal * 0.2;
    const bandX = -half - bandWidth + (diagonal + bandWidth * 2) * easeInOutCubic(progress);
    const streaks = Array.from({ length: 10 }, () => ({
      offset: (random() - 0.5) * diagonal * 0.9,
      thickness: Math.max(0.8, (0.6 + random() * 1.2) * dpr),
      tone: Math.floor(random() * 3),
    }));
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 12);
    const specular = ctx.createLinearGradient(bandX - bandWidth, 0, bandX + bandWidth, 0);
    specular.addColorStop(0, paint.alpha(0, 1));
    specular.addColorStop(0.42, paint.alpha(0.28 * options.intensity, 1));
    specular.addColorStop(0.5, paint.alpha(0.6 * options.intensity, 0));
    specular.addColorStop(0.58, paint.alpha(0.28 * options.intensity, 2));
    specular.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = specular;
    ctx.fillRect(-half - bandWidth, -half, (half + bandWidth) * 2, diagonal);
    for (const streak of streaks) {
      const proximity = Math.max(0, 1 - Math.abs(streak.offset - bandX) / (bandWidth * 2.2));
      const alpha = proximity * proximity * 0.5 * options.intensity;
      if (alpha <= 0.02) continue;
      const gradient = ctx.createLinearGradient(streak.offset - bandWidth, 0, streak.offset + bandWidth, 0);
      gradient.addColorStop(0, paint.alpha(0, streak.tone));
      gradient.addColorStop(0.5, paint.alpha(alpha, streak.tone));
      gradient.addColorStop(1, paint.alpha(0, streak.tone));
      ctx.fillStyle = gradient;
      ctx.fillRect(streak.offset - bandWidth, -half, bandWidth * 2, diagonal);
      ctx.fillStyle = paint.alpha(alpha * 0.8, 0);
      ctx.fillRect(streak.offset - bandWidth * 0.6, -streak.thickness / 2, bandWidth * 1.2, streak.thickness);
    }
  },
});
