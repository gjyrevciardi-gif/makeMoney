import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-color-cycle",
    displayName: "Background Color Cycle",
    description: "A slow ambient wash of orbiting colour glows that crossfade through the palette.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const phase = progress * Math.PI * 2;
    const reach = Math.max(width, height) * 0.8;
    const base = ctx.createLinearGradient(x, y, x + width, y + height);
    base.addColorStop(0, paint.alpha(0.05 * options.intensity, 0));
    base.addColorStop(0.5, paint.alpha(0.05 * options.intensity, 1));
    base.addColorStop(1, paint.alpha(0.05 * options.intensity, 2));
    ctx.fillStyle = base;
    ctx.fillRect(x, y, width, height);
    for (let i = 0; i < 3; i += 1) {
      const weight = 0.5 + 0.5 * Math.cos(phase - (i * Math.PI * 2) / 3);
      const angle = phase + (i * Math.PI * 2) / 3;
      const gx = x + width * (0.5 + 0.32 * Math.cos(angle));
      const gy = y + height * (0.5 + 0.32 * Math.sin(angle));
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, reach);
      glow.addColorStop(0, paint.alpha(0.14 * weight * options.intensity, i));
      glow.addColorStop(1, paint.alpha(0, i));
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, width, height);
    }
  },
});
