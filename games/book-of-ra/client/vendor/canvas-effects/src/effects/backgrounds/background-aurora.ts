import { defineEffect } from "../../effect.js";

const PASSES = [
  { widthScale: 1, alpha: 0.05 },
  { widthScale: 0.55, alpha: 0.09 },
  { widthScale: 0.22, alpha: 0.16 },
] as const;

export default defineEffect({
  metadata: {
    id: "background-aurora",
    displayName: "Background Aurora",
    description: "Flowing curtain ribbons of layered colour that undulate slowly across the sky.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const phase = progress * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const steps = Math.max(24, Math.floor(width / 18));
    for (let r = 0; r < 3; r += 1) {
      const baseY = 0.22 + r * 0.18 + random() * 0.08;
      const amp = 0.05 + random() * 0.05;
      const freq = 1 + Math.floor(random() * 2);
      const drift = 1 + Math.floor(random() * 2);
      const off = random() * Math.PI * 2;
      const thickness = height * (0.1 + random() * 0.08);
      for (const pass of PASSES) {
        ctx.strokeStyle = paint.alpha(pass.alpha * options.intensity, r);
        ctx.lineWidth = Math.max(1, thickness * pass.widthScale);
        ctx.beginPath();
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          const wave =
            Math.sin(t * Math.PI * 2 * freq + phase * drift + off) +
            0.5 * Math.sin(t * Math.PI * 2 * (freq + 2) - phase * drift + off * 2);
          const px = x + t * width;
          const py = y + (baseY + wave * amp) * height;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
});
