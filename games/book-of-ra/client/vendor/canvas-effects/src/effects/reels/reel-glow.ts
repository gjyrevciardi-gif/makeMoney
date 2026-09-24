import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-glow",
    displayName: "Reel Glow",
    description: "A warm breathing halo hugging the reel border with a soft interior wash that swells and relaxes.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 - Math.PI / 2);
    const level = (0.5 + 0.5 * breath) * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    const cx = x + width / 2;
    const cy = y + height / 2;
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.62);
    wash.addColorStop(0, paint.alpha(0.14 * level, 1));
    wash.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, width, height);
    for (let layer = 0; layer < 4; layer += 1) {
      const inset = (2 + layer * 2.5) * dpr;
      const alpha = (0.42 - layer * 0.09) * level;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, layer === 0 ? 2 : 0);
      ctx.lineWidth = (2 + layer * 1.5) * dpr;
      ctx.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
    }
  },
});
