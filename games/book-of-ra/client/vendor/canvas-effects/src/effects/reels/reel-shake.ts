import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-shake",
    displayName: "Reel Shake",
    description: "The reel frame judders side to side with lagging outline ghosts and directional glow smears that die down.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const decay = Math.pow(1 - progress, 1.3);
    const amp = width * 0.06 * decay * options.intensity;
    const phase = random() * Math.PI * 2;
    const offsetAt = (t: number): number => Math.sin(t * Math.PI * 16 + phase) * amp;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const lagT = clamp01(progress - ghost * 0.025);
      const dx = offsetAt(lagT);
      const alpha = (ghost === 0 ? 0.75 : 0.26 / ghost) * decay * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 1);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.strokeRect(x + dx + 2 * dpr, y + 2 * dpr, width - 4 * dpr, height - 4 * dpr);
    }
    const dx = offsetAt(progress);
    const side = dx > 0 ? 1 : -1;
    const smear = Math.abs(dx) / Math.max(1, width * 0.06);
    const grad = ctx.createLinearGradient(side > 0 ? x + width * 0.5 : x + width * 0.5, y, x + width * 0.5 + side * width * 0.5, y);
    grad.addColorStop(0, paint.alpha(0));
    grad.addColorStop(1, paint.alpha(0.28 * smear * decay * options.intensity, 2));
    ctx.fillStyle = grad;
    ctx.fillRect(side > 0 ? x + width * 0.5 : x, y + height * 0.06, width * 0.5, height * 0.88);
  },
});
