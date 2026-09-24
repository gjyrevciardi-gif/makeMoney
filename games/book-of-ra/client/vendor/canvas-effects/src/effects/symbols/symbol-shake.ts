import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-shake",
    displayName: "Symbol Shake",
    description: "Rapid side-to-side outline echoes with directional glow smears that rattle the cell and settle.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const decay = Math.pow(1 - progress, 1.4);
    const amp = width * 0.09 * decay * options.intensity;
    const radius = Math.min(width, height) * 0.12;
    const offsetAt = (t: number, phase: number): number => Math.sin(t * Math.PI * 14 + phase) * amp;
    const phase = random() * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const lagT = clamp01(progress - ghost * 0.03);
      const dx = offsetAt(lagT, phase);
      const alpha = (ghost === 0 ? 0.8 : 0.26 / ghost) * decay * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 2);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.beginPath();
      ctx.roundRect(x + dx + 2 * dpr, y + 2 * dpr, width - 4 * dpr, height - 4 * dpr, radius);
      ctx.stroke();
    }
    const smear = Math.abs(offsetAt(progress, phase)) / Math.max(1, width * 0.09);
    const side = offsetAt(progress, phase) > 0 ? 1 : -1;
    const grad = ctx.createLinearGradient(x + width / 2, y, x + width / 2 + side * width * 0.5, y);
    grad.addColorStop(0, paint.alpha(0));
    grad.addColorStop(1, paint.alpha(0.3 * smear * decay * options.intensity, 1));
    ctx.fillStyle = grad;
    ctx.fillRect(side > 0 ? x + width / 2 : x, y + height * 0.1, width / 2, height * 0.8);
  },
});
