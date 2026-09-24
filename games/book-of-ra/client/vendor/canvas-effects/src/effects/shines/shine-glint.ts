import { defineEffect, easeInOutCubic, pulse } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-glint",
    displayName: "Shine Glint",
    description: "A single bright diagonal glint that streaks once across the target with a starry peak.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const diagonal = Math.hypot(width, height);
    const travel = easeInOutCubic(progress) * 1.5 - 0.25;
    const glintX = x + width * travel;
    const glintY = y + height * travel;
    const bandWidth = diagonal * 0.09;
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(glintX, glintY);
    ctx.rotate(Math.atan2(height, width));
    const band = ctx.createLinearGradient(-bandWidth, 0, bandWidth, 0);
    band.addColorStop(0, paint.alpha(0, 1));
    band.addColorStop(0.45, paint.alpha(0.45 * options.intensity, 1));
    band.addColorStop(0.5, paint.alpha(0.85 * options.intensity, 0));
    band.addColorStop(0.55, paint.alpha(0.45 * options.intensity, 2));
    band.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = band;
    ctx.fillRect(-bandWidth, -diagonal * 0.7, bandWidth * 2, diagonal * 1.4);
    const flash = pulse(progress);
    const spikeLength = diagonal * 0.22 * flash;
    const spikeWidth = Math.max(1, 1.6 * dpr);
    ctx.fillStyle = paint.alpha(0.9 * flash * options.intensity, 0);
    for (const rotation of [0, Math.PI / 2]) {
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(0, -spikeLength);
      ctx.lineTo(spikeWidth, 0);
      ctx.lineTo(0, spikeLength);
      ctx.lineTo(-spikeWidth, 0);
      ctx.closePath();
      ctx.fill();
    }
  },
});
