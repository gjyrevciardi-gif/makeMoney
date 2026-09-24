import { defineEffect } from "../../effect.js";

const LAYERS = [
  { speed: 1, base: 0.55, amp: 0.1, freq: 2, alpha: 0.1 },
  { speed: 2, base: 0.68, amp: 0.12, freq: 3, alpha: 0.16 },
  { speed: 3, base: 0.8, amp: 0.14, freq: 4, alpha: 0.24 },
] as const;

export default defineEffect({
  metadata: {
    id: "background-parallax",
    displayName: "Background Parallax",
    description: "Layered silhouette ridge bands drifting sideways at different speeds for a depth-scrolling horizon.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#2b1762", "#35d6ed", "#f6ca55"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const sky = ctx.createLinearGradient(x, y, x, y + height);
    sky.addColorStop(0, paint.alpha(0.06 * options.intensity, 1));
    sky.addColorStop(1, paint.alpha(0.03 * options.intensity, 0));
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, width, height);
    const steps = Math.max(24, Math.floor(width / 14));
    for (const layer of LAYERS) {
      const off1 = random() * Math.PI * 2;
      const off2 = random() * Math.PI * 2;
      ctx.fillStyle = paint.alpha(layer.alpha * options.intensity, 0);
      ctx.beginPath();
      ctx.moveTo(x, y + height);
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const u = t + progress * layer.speed;
        const ridge = 0.6 * Math.sin(u * Math.PI * 2 * layer.freq + off1) + 0.4 * Math.sin(u * Math.PI * 2 * (layer.freq * 2 + 1) + off2);
        const top = layer.base - layer.amp * (0.5 + 0.5 * ridge);
        ctx.lineTo(x + t * width, y + top * height);
      }
      ctx.lineTo(x + width, y + height);
      ctx.closePath();
      ctx.fill();
    }
  },
});
