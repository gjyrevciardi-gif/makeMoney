import { clamp01, defineEffect, easeInCubic, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-starburst",
    displayName: "Shine Starburst",
    description: "An explosive burst of tapered light spokes and a core flash that flares out and fades.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.hypot(width, height) * 0.55;
    const spokes = Array.from({ length: 10 }, (_, index) => ({
      angle: (index / 10) * Math.PI * 2 + random() * 0.3,
      length: reach * (0.55 + random() * 0.45),
      tone: Math.floor(random() * 3),
    }));
    const flare = easeOutCubic(clamp01(progress * 1.5));
    const fade = 1 - easeInCubic(progress);
    ctx.globalCompositeOperation = "lighter";
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach * (0.15 + flare * 0.25));
    core.addColorStop(0, paint.alpha(0.9 * fade * options.intensity, 0));
    core.addColorStop(0.5, paint.alpha(0.4 * fade * options.intensity, 1));
    core.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    for (const spoke of spokes) {
      const length = spoke.length * flare;
      const alpha = 0.75 * fade * options.intensity;
      if (alpha <= 0.02 || length <= 1) continue;
      const baseWidth = Math.max(1, (2.4 - progress * 1.6) * dpr);
      ctx.fillStyle = paint.alpha(alpha, spoke.tone);
      ctx.translate(centerX, centerY);
      ctx.rotate(spoke.angle);
      ctx.beginPath();
      ctx.moveTo(0, -baseWidth);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, baseWidth);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-spoke.angle);
      ctx.translate(-centerX, -centerY);
    }
    const ring = clamp01(progress * 1.2);
    const ringRadius = reach * easeOutCubic(ring);
    const ringBand = reach * 0.1;
    const wave = ctx.createRadialGradient(centerX, centerY, Math.max(0, ringRadius - ringBand), centerX, centerY, ringRadius + ringBand);
    wave.addColorStop(0, paint.alpha(0, 2));
    wave.addColorStop(0.5, paint.alpha(0.4 * fade * options.intensity, 2));
    wave.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = wave;
    ctx.fillRect(x, y, width, height);
  },
});
