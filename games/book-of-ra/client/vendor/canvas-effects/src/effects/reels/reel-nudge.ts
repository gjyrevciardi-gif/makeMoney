import { clamp01, defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-nudge",
    displayName: "Reel Nudge",
    description: "Ghost chevrons and a highlight band step the reel down one position, finishing with a crisp landing flash.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cell = height / 3;
    const step = easeInOutCubic(clamp01(progress / 0.7));
    const fade = clamp01((1 - progress) * 3.5);
    ctx.globalCompositeOperation = "lighter";
    const bandY = y + cell + step * cell;
    const band = ctx.createLinearGradient(x, bandY - cell * 0.5, x, bandY + cell * 0.5);
    band.addColorStop(0, paint.alpha(0));
    band.addColorStop(0.5, paint.alpha(0.35 * fade * options.intensity, 0));
    band.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = band;
    ctx.fillRect(x + width * 0.06, bandY - cell * 0.5, width * 0.88, cell);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let ghost = 0; ghost < 3; ghost += 1) {
      const lag = clamp01(step - ghost * 0.12);
      const gy = y + cell + lag * cell;
      const alpha = (ghost === 0 ? 0.8 : 0.3 / ghost) * fade * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, ghost === 0 ? 0 : 1);
      ctx.lineWidth = (ghost === 0 ? 2.6 : 1.6) * dpr;
      const chevronW = width * 0.24;
      const chevronH = cell * 0.16;
      ctx.beginPath();
      ctx.moveTo(x + width / 2 - chevronW, gy - chevronH);
      ctx.lineTo(x + width / 2, gy + chevronH);
      ctx.lineTo(x + width / 2 + chevronW, gy - chevronH);
      ctx.stroke();
    }
    const landed = clamp01((progress - 0.7) / 0.12);
    const landFlash = landed > 0 ? clamp01(1 - (progress - 0.7) / 0.3) : 0;
    if (landFlash > 0.02) {
      ctx.fillStyle = paint.alpha(0.75 * landFlash * options.intensity, 2);
      ctx.fillRect(x + width * 0.08, y + cell * 2 - 1.5 * dpr, width * 0.84, 3 * dpr);
      const glow = ctx.createRadialGradient(x + width / 2, y + cell * 2, 0, x + width / 2, y + cell * 2, width * 0.5);
      glow.addColorStop(0, paint.alpha(0.4 * landFlash * options.intensity, 0));
      glow.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = glow;
      ctx.fillRect(x, y + cell, width, cell * 2);
    }
  },
});
