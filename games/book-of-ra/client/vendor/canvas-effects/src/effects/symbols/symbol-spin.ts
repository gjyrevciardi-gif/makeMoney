import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-spin",
    displayName: "Symbol Spin",
    description: "A vertical-axis spin illusion: the outline narrows edge-on with horizontal glow smears and an edge flash.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const angle = easeInOutCubic(progress) * Math.PI * 2;
    const squeeze = Math.abs(Math.cos(angle));
    const fade = options.loop ? 1 : clamp01((1 - progress) * 6);
    const radius = Math.min(width, height) * 0.12;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const ghostAngle = angle - ghost * 0.35;
      const ghostSqueeze = Math.abs(Math.cos(ghostAngle));
      const halfW = Math.max(2 * dpr, (width / 2 - 3 * dpr) * ghostSqueeze);
      const alpha = (ghost === 0 ? 0.8 : 0.24 / ghost) * fade * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 2);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.beginPath();
      ctx.roundRect(cx - halfW, y + 3 * dpr, halfW * 2, height - 6 * dpr, radius * ghostSqueeze + 1);
      ctx.stroke();
    }
    const smear = ctx.createLinearGradient(x, cy, x + width, cy);
    const smearAlpha = 0.35 * (1 - squeeze) * fade * options.intensity;
    smear.addColorStop(0, paint.alpha(0));
    smear.addColorStop(0.5, paint.alpha(smearAlpha, 1));
    smear.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = smear;
    ctx.fillRect(x, y + height * 0.12, width, height * 0.76);
    const edgeFlash = clamp01(1 - squeeze * 4) * fade;
    if (edgeFlash > 0.02) {
      ctx.fillStyle = paint.alpha(0.8 * edgeFlash * options.intensity, 1);
      ctx.fillRect(cx - 1.5 * dpr, y + height * 0.08, 3 * dpr, height * 0.84);
    }
  },
});
