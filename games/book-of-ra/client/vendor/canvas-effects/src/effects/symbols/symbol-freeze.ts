import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-freeze",
    displayName: "Symbol Freeze",
    description: "Branching frost crystals creep inward from the cell edges beneath a cold translucent veil and glinting ice sparkles.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#dff6ff", "#9fd9ff", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const grow = easeOutCubic(clamp01(progress * 1.25));
    const veil = ctx.createLinearGradient(x, y, x, y + height);
    veil.addColorStop(0, paint.alpha(0.22 * grow * options.intensity, 1));
    veil.addColorStop(0.5, paint.alpha(0.1 * grow * options.intensity, 0));
    veil.addColorStop(1, paint.alpha(0.22 * grow * options.intensity, 1));
    ctx.fillStyle = veil;
    ctx.fillRect(x, y, width, height);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i += 1) {
      const side = i % 4;
      const along = 0.12 + random() * 0.76;
      const length = (0.2 + random() * 0.24) * Math.min(width, height);
      const lean = (random() - 0.5) * 0.9;
      const branchAt = 0.35 + random() * 0.35;
      const startX = side === 0 ? x + width * along : side === 1 ? x + width : side === 2 ? x + width * along : x;
      const startY = side === 0 ? y : side === 1 ? y + height * along : side === 2 ? y + height : y + height * along;
      const inward = side === 0 ? Math.PI / 2 : side === 1 ? Math.PI : side === 2 ? -Math.PI / 2 : 0;
      const dir = inward + lean;
      const localGrow = easeOutCubic(clamp01(progress * 1.6 - i * 0.035));
      if (localGrow <= 0.01) continue;
      const tipX = startX + Math.cos(dir) * length * localGrow;
      const tipY = startY + Math.sin(dir) * length * localGrow;
      ctx.strokeStyle = paint.alpha(0.7 * localGrow * options.intensity, 1);
      ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const branchGrow = clamp01(localGrow * 1.4 - branchAt);
      if (branchGrow > 0.01) {
        const bx = startX + Math.cos(dir) * length * localGrow * branchAt;
        const by = startY + Math.sin(dir) * length * localGrow * branchAt;
        ctx.strokeStyle = paint.alpha(0.55 * branchGrow * options.intensity, 2);
        ctx.lineWidth = 1.1 * dpr;
        for (const spread of [-0.7, 0.7] as const) {
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(dir + spread) * length * 0.3 * branchGrow, by + Math.sin(dir + spread) * length * 0.3 * branchGrow);
          ctx.stroke();
        }
      }
    }
    for (let i = 0; i < 6; i += 1) {
      const gx = x + random() * width;
      const gy = y + random() * height;
      const glintPhase = random() * Math.PI * 2;
      const glint = Math.max(0, Math.sin(progress * Math.PI * 6 + glintPhase)) * grow;
      if (glint <= 0.05) continue;
      ctx.fillStyle = paint.alpha(0.8 * glint * options.intensity, 2);
      ctx.beginPath();
      ctx.arc(gx, gy, 1.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
