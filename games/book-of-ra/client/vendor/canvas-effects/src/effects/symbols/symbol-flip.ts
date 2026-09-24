import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-flip",
    displayName: "Symbol Flip",
    description: "A card-flip illusion: the outline collapses about its horizontal axis with a sweeping glint and mid-flip flash.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cy = y + height / 2;
    const angle = easeInOutCubic(progress) * Math.PI;
    const fold = Math.abs(Math.cos(angle));
    const fade = options.loop ? 1 : clamp01((1 - progress) * 5);
    const radius = Math.min(width, height) * 0.12;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let ghost = 2; ghost >= 0; ghost -= 1) {
      const ghostFold = Math.abs(Math.cos(angle - ghost * 0.3));
      const halfH = Math.max(2 * dpr, (height / 2 - 3 * dpr) * ghostFold);
      const alpha = (ghost === 0 ? 0.8 : 0.24 / ghost) * fade * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 2);
      ctx.lineWidth = (ghost === 0 ? 2.4 : 1.4) * dpr;
      ctx.beginPath();
      ctx.roundRect(x + 3 * dpr, cy - halfH, width - 6 * dpr, halfH * 2, radius * ghostFold + 1);
      ctx.stroke();
    }
    const glintY = y + easeInOutCubic(progress) * height;
    const glint = ctx.createLinearGradient(x, glintY - height * 0.14, x, glintY + height * 0.14);
    glint.addColorStop(0, paint.alpha(0));
    glint.addColorStop(0.5, paint.alpha(0.4 * fade * options.intensity, 1));
    glint.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = glint;
    ctx.fillRect(x + width * 0.06, glintY - height * 0.14, width * 0.88, height * 0.28);
    const midFlash = clamp01(1 - fold * 4) * fade;
    if (midFlash > 0.02) {
      ctx.fillStyle = paint.alpha(0.85 * midFlash * options.intensity, 1);
      ctx.fillRect(x + width * 0.08, cy - 1.5 * dpr, width * 0.84, 3 * dpr);
    }
  },
});
