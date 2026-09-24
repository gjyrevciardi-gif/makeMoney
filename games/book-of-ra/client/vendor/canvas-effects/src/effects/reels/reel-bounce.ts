import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-bounce",
    displayName: "Reel Bounce",
    description: "The reel frame visibly recoils: outline echoes and edge bands oscillate vertically with a damped settle.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const damp = Math.exp(-3.2 * progress);
    const offset = Math.sin(progress * Math.PI * 5) * height * 0.05 * damp;
    const energy = Math.abs(offset) / Math.max(1, height * 0.05);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const lag = Math.max(0, progress - ghost * 0.04);
      const ghostOffset = Math.sin(lag * Math.PI * 5) * height * 0.05 * Math.exp(-3.2 * lag);
      const alpha = (ghost === 0 ? 0.7 : 0.24 / ghost) * damp * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 1);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.strokeRect(x + 2 * dpr, y + ghostOffset + 2 * dpr, width - 4 * dpr, height - 4 * dpr);
    }
    const topBand = ctx.createLinearGradient(x, y + offset, x, y + offset + height * 0.14);
    topBand.addColorStop(0, paint.alpha(0.5 * energy * damp * options.intensity, 2));
    topBand.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = topBand;
    ctx.fillRect(x, y + offset, width, height * 0.14);
    const bottomBand = ctx.createLinearGradient(x, y + height + offset, x, y + height + offset - height * 0.14);
    bottomBand.addColorStop(0, paint.alpha(0.5 * energy * damp * options.intensity, 2));
    bottomBand.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = bottomBand;
    ctx.fillRect(x, y + height + offset - height * 0.14, width, height * 0.14);
  },
});
