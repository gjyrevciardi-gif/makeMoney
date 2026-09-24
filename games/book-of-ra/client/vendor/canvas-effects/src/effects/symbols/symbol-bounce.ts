import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-bounce",
    displayName: "Symbol Bounce",
    description: "Outline ghosts hop along a damped bounce arc while a squash highlight flashes at each landing.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const decay = 1 - progress;
    const hop = Math.abs(Math.sin(progress * Math.PI * 3));
    const lift = hop * height * 0.22 * decay;
    const radius = Math.min(width, height) * 0.12;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const lagT = clamp01(progress - ghost * 0.045);
      const ghostLift = Math.abs(Math.sin(lagT * Math.PI * 3)) * height * 0.22 * (1 - lagT);
      const alpha = (ghost === 0 ? 0.75 : 0.28 / ghost) * decay * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 1);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.beginPath();
      ctx.roundRect(x + 2 * dpr, y - ghostLift + 2 * dpr, width - 4 * dpr, height - 4 * dpr, radius);
      ctx.stroke();
    }
    const impact = clamp01(1 - hop * 3) * decay;
    if (impact > 0.02) {
      const band = ctx.createLinearGradient(x, y + height * 0.7, x, y + height);
      band.addColorStop(0, paint.alpha(0));
      band.addColorStop(1, paint.alpha(0.55 * impact * options.intensity, 1));
      ctx.fillStyle = band;
      ctx.fillRect(x, y + height * 0.7, width, height * 0.3);
      ctx.strokeStyle = paint.alpha(0.6 * impact * options.intensity, 2);
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height - 2 * dpr, width * (0.3 + impact * 0.18), 3 * dpr, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
});
