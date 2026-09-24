import { defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "button-spark",
    displayName: "Button Spark",
    description: "A crackle of tiny spark streaks that fly off the button and die out under gravity.",
    category: "buttons",
    targets: ["button"],
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.max(width, height) * 0.7;
    const sparks = Array.from({ length: 14 }, () => ({
      angle: random() * Math.PI * 2,
      speed: 0.4 + random() * 0.6,
      tone: random(),
      size: 0.8 + random() * 1.4,
    }));
    const decay = Math.pow(1 - progress, 1.4);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const posAt = (spark: (typeof sparks)[number], t: number): [number, number] => {
      const travel = easeOutCubic(t) * spark.speed * reach;
      return [
        centerX + Math.cos(spark.angle) * travel,
        centerY + Math.sin(spark.angle) * travel + t * t * height * 0.35,
      ];
    };
    for (const spark of sparks) {
      const a = decay * (0.5 + 0.5 * spark.tone) * options.intensity;
      if (a <= 0.01) continue;
      const [headX, headY] = posAt(spark, progress);
      const [tailX, tailY] = posAt(spark, Math.max(0, progress - 0.08));
      const passes = [
        [4 * dpr * spark.size, paint.alpha(0.2 * a, 0)],
        [1.3 * dpr * spark.size, paint.alpha(0.9 * a, spark.tone > 0.6 ? 2 : 1)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(headX, headY);
        ctx.stroke();
      }
    }
    const flash = 1 - easeOutCubic(Math.min(1, progress * 3.2));
    if (flash > 0.01) {
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach * 0.3);
      core.addColorStop(0, paint.alpha(0.7 * flash * options.intensity, 2));
      core.addColorStop(1, paint.alpha(0, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x, y, width, height);
    }
  },
});
